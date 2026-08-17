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
  public.slot_templates,
  public.staff,
  public.patients
restart identity cascade;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000001301', 'settings.owner@example.test'),
  ('00000000-0000-4000-8000-000000001302', 'settings.staff@example.test')
on conflict (id) do nothing;
insert into public.staff (id, email, full_name, role, active) values
  ('00000000-0000-4000-8000-000000001301', 'settings.owner@example.test', 'Settings Owner', 'OWNER', true),
  ('00000000-0000-4000-8000-000000001302', 'settings.staff@example.test', 'Settings Staff', 'FRONT_DESK', true);

select pg_temp.assert_true(
  public.save_clinic_settings(
    '00000000-0000-4000-8000-000000001301',
    'Updated Test Dental', 'UTC', '08:00', '20:00', 5, 425.00,
    180, 30, '[{"size":3,"delay_min":7}]', false, true, true
  ),
  'valid clinic settings must save'
);
select pg_temp.assert_true(
  (
    select clinic_name = 'Updated Test Dental'
       and timezone = 'UTC'
       and max_messages_per_week = 5
       and estimated_chair_value = 425.00
       and feature_recalls
       and feature_reviews
      from public.clinic_config
  ),
  'all clinic settings must update together'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.audit_events where event_type = 'CONFIG_CHANGED' and entity_type = 'clinic_config'),
  'settings save must emit one audit event'
);

select pg_temp.assert_true(
  public.set_automation_paused(
    '00000000-0000-4000-8000-000000001301', true
  ),
  'kill switch must pause automation'
);
select pg_temp.assert_true(
  (select automation_paused from public.clinic_config),
  'kill switch state must persist'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.audit_events where event_type = 'KILL_SWITCH_TOGGLED'),
  'kill switch must emit one audit event'
);

insert into public.patients (
  id, full_name, phone_number, consent_status, preferred_procedures
) values (
  '00000000-0000-4000-8000-000000001303', 'Settings Patient',
  '+15005550303', 'GRANTED', array['HYGIENE']
);
insert into public.broadcast_campaigns (
  id, appointment_time, clinic_timezone, procedure_type, duration_min,
  status, wave_plan, expires_at
) values (
  '00000000-0000-4000-8000-000000001304', now() + interval '1 day',
  'UTC', 'HYGIENE', 60, 'OPEN', '[{"size":1,"delay_min":7}]',
  now() + interval '1 day'
);
create temporary table killed_wave as
select * from public.reserve_next_campaign_wave(
  '00000000-0000-4000-8000-000000001304'
);
select pg_temp.assert_true(
  (select count(*) = 0 from killed_wave),
  'paused automation must reserve no wave recipients'
);
select public.record_automation_abort(
  '00000000-0000-4000-8000-000000001304', 'AUTOMATION_PAUSED'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.audit_events where event_type = 'AUTOMATION_ABORTED'),
  'kill-switch wave abort must be logged'
);

select public.upsert_slot_template(
  null, '00000000-0000-4000-8000-000000001301',
  'Hygiene — 60 min', 'HYGIENE', 60, null, false, 1
) as template_id \gset
select pg_temp.assert_true(
  public.set_slot_template_active(
    :'template_id', '00000000-0000-4000-8000-000000001301', false
  ),
  'slot template must support soft deactivation'
);
select pg_temp.assert_true(
  (select active = false from public.slot_templates where id = :'template_id'),
  'deactivated template must remain stored'
);

select pg_temp.assert_true(
  public.upsert_staff_member(
    '00000000-0000-4000-8000-000000001302',
    '00000000-0000-4000-8000-000000001301',
    'settings.staff@example.test', 'Settings Staff', 'ADMIN', true
  ),
  'owner must update another staff role'
);
select pg_temp.assert_true(
  not public.upsert_staff_member(
    '00000000-0000-4000-8000-000000001301',
    '00000000-0000-4000-8000-000000001301',
    'settings.owner@example.test', 'Settings Owner', 'OWNER', false
  ),
  'owner must not deactivate their own account'
);

update public.clinic_config set automation_paused = false;
update public.broadcast_campaigns
   set status = 'FILLED',
       claimed_by = '00000000-0000-4000-8000-000000001303',
       claimed_at = created_at + interval '5 minutes'
 where id = '00000000-0000-4000-8000-000000001304';
insert into public.sms_logs (
  message_sid, patient_id, campaign_id, direction, status
) values
  ('SM_DASH_DELIVERED', '00000000-0000-4000-8000-000000001303', '00000000-0000-4000-8000-000000001304', 'OUTBOUND', 'DELIVERED'),
  ('SM_DASH_FAILED', '00000000-0000-4000-8000-000000001303', '00000000-0000-4000-8000-000000001304', 'OUTBOUND', 'FAILED');

create temporary table dashboard_metrics as select * from public.get_dashboard_metrics();
select pg_temp.assert_true(
  (
    select chairs_filled_month = 1
       and median_fill_seconds = 300
       and estimated_revenue = 425
       and delivered_count = 1
       and failed_count = 1
       and delivery_rate = 50
      from dashboard_metrics
  ),
  'dashboard metrics must aggregate fills, revenue, timing, and delivery'
);

select 'PASS: settings, kill switch, templates, staff, and dashboard invariants' as result;

rollback;
