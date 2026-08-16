\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $function$
begin
  if condition is not true then raise exception 'Assertion failed: %', message; end if;
end
$function$;

truncate table
  public.audit_events,
  public.campaign_wave_runs,
  public.campaign_recipients,
  public.sms_logs,
  public.broadcast_campaigns,
  public.staff,
  public.patients
restart identity cascade;

update public.clinic_config
   set timezone = 'UTC',
       quiet_hours_start = '00:00',
       quiet_hours_end = '23:59',
       max_messages_per_week = 10,
       automation_paused = false;

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000001001', 'campaign.staff@example.test')
on conflict (id) do nothing;

insert into public.staff (id, email, full_name, role, active)
values (
  '00000000-0000-4000-8000-000000001001',
  'campaign.staff@example.test',
  'Campaign Test Staff',
  'FRONT_DESK',
  true
);

insert into public.patients (
  id, full_name, phone_number, consent_status, reliability_score,
  last_visit_date, preferred_procedures
)
select
  ('00000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'Campaign Test Patient ' || value,
  '+15005550' || lpad(value::text, 3, '0'),
  'GRANTED',
  90 - value,
  current_date - value,
  array['HYGIENE']
from generate_series(1, 6) value;

select pg_temp.assert_true(
  public.count_eligible_patients('HYGIENE') = 6,
  'eligible count must use consent, opt-out, procedure, and frequency rules'
);

select public.create_broadcast_campaign(
  now() + interval '1 day',
  'UTC',
  'HYGIENE',
  60,
  '[{"size":3,"delay_min":7},{"size":3,"delay_min":7}]',
  '00000000-0000-4000-8000-000000001001'
) as campaign_id \gset

select pg_temp.assert_true(
  (select status = 'DRAFT' from public.broadcast_campaigns where id = :'campaign_id'),
  'new campaign must start as DRAFT'
);
select pg_temp.assert_true(
  public.activate_campaign(:'campaign_id') = true,
  'signed campaign-start must atomically activate DRAFT'
);

create temporary table first_wave as
select * from public.reserve_next_campaign_wave(:'campaign_id');

select pg_temp.assert_true((select count(*) = 3 from first_wave), 'wave 1 must reserve three patients');
select pg_temp.assert_true(
  (
    select status = 'ESCALATING' and current_wave = 1 and next_wave_at = 'infinity'
      from public.broadcast_campaigns where id = :'campaign_id'
  ),
  'reservation must block duplicate execution until completion'
);
select pg_temp.assert_true(
  (select count(*) = 3 from public.campaign_recipients where campaign_id = :'campaign_id'),
  'recipients must exist before Twilio sends'
);

create temporary table duplicate_reserve as
select * from public.reserve_next_campaign_wave(:'campaign_id');
select pg_temp.assert_true(
  (select count(*) = 0 from duplicate_reserve),
  'duplicate wave execution must not reserve or resend recipients'
);

select patient_id as first_patient_id from first_wave order by send_order limit 1 \gset
select pg_temp.assert_true(
  public.check_campaign_send_eligibility(:'campaign_id', :'first_patient_id') = 'ALLOWED',
  'reserved patient must pass the five send preconditions'
);

select public.record_campaign_sms(
  :'campaign_id', :'first_patient_id', 'SM_CAMPAIGN_TEST_001',
  'Test Clinic: an opening is available. Reply YES. Reply STOP to opt out.',
  'QUEUED', null
);
select public.record_campaign_sms(
  :'campaign_id', :'first_patient_id', 'SM_CAMPAIGN_TEST_001',
  'Test Clinic: an opening is available. Reply YES. Reply STOP to opt out.',
  'QUEUED', null
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.sms_logs where message_sid = 'SM_CAMPAIGN_TEST_001'),
  'replayed Twilio result must create one SMS log'
);

select public.complete_campaign_wave(:'campaign_id', 1);
select pg_temp.assert_true(
  (select status = 'SENT' and next_wave_at is not null from public.campaign_wave_runs where campaign_id = :'campaign_id' and wave_number = 1),
  'completed wave must schedule the next state check'
);

select reliability_score as score_before_manual
from public.patients where id = :'first_patient_id' \gset
select pg_temp.assert_true(
  public.assign_slot_manually(
    :'campaign_id', :'first_patient_id',
    '00000000-0000-4000-8000-000000001001'
  ) = true,
  'manual assignment must fill an active campaign'
);
select pg_temp.assert_true(
  (
    select status = 'FILLED' and claimed_by = :'first_patient_id' and next_wave_at is null
      from public.broadcast_campaigns where id = :'campaign_id'
  ),
  'manual fill must terminate later waves'
);
select pg_temp.assert_true(
  (select reliability_score = :'score_before_manual' from public.patients where id = :'first_patient_id'),
  'manual assignment must not change SMS reliability scoring'
);

create temporary table post_wait_wave as
select * from public.reserve_next_campaign_wave(:'campaign_id');
select pg_temp.assert_true(
  (select count(*) = 0 from post_wait_wave),
  'post-wait re-entry must send nothing after a manual fill'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.audit_events where event_type = 'SLOT_ASSIGNED_MANUALLY' and entity_id = :'campaign_id'),
  'manual assignment must write one staff audit event'
);

select public.create_broadcast_campaign(
  now() + interval '1 day', 'UTC', 'HYGIENE', 60,
  '[{"size":3,"delay_min":7}]',
  '00000000-0000-4000-8000-000000001001'
) as paused_campaign_id \gset
select public.activate_campaign(:'paused_campaign_id');
select pg_temp.assert_true(
  public.pause_campaign(:'paused_campaign_id', '00000000-0000-4000-8000-000000001001'),
  'staff must be able to pause an active campaign'
);
select pg_temp.assert_true(
  public.cancel_campaign(
    :'paused_campaign_id', '00000000-0000-4000-8000-000000001001', 'Slot removed'
  ),
  'staff must be able to cancel a paused draft'
);

select 'PASS: campaign lifecycle, dedupe, manual-fill, and post-wait invariants' as result;

rollback;
