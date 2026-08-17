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
  public.scheduled_messages,
  public.broadcast_campaigns,
  public.staff,
  public.patients
restart identity cascade;

update public.clinic_config
   set timezone = 'UTC',
       feature_recalls = true,
       feature_reviews = true,
       recall_threshold_days = 180,
       recall_cooldown_days = 30,
       review_delay_hours = 4,
       review_cooldown_days = 180,
       review_url = 'https://reviews.example.test/clinic';

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000001401', 'v2.staff@example.test')
on conflict (id) do nothing;
insert into public.staff (id, email, full_name, role, active)
values ('00000000-0000-4000-8000-000000001401', 'v2.staff@example.test', 'V2 Staff', 'ADMIN', true);

insert into public.patients (
  id, full_name, phone_number, consent_status, last_visit_date, last_recall_sent_at
) values
  ('00000000-0000-4000-8000-000000001402', 'Recall 180', '+15005550402', 'GRANTED', current_date - 180, null),
  ('00000000-0000-4000-8000-000000001403', 'Recall 181', '+15005550403', 'GRANTED', current_date - 181, null),
  ('00000000-0000-4000-8000-000000001404', 'Recall 194', '+15005550404', 'GRANTED', current_date - 194, null),
  ('00000000-0000-4000-8000-000000001405', 'Too Old', '+15005550405', 'GRANTED', current_date - 195, null),
  ('00000000-0000-4000-8000-000000001406', 'Cooldown', '+15005550406', 'GRANTED', current_date - 185, now() - interval '2 days');

create temporary table recall_cohort as select * from public.reserve_due_recalls();
select pg_temp.assert_true(
  (select count(*) = 3 from recall_cohort),
  'recall range must include threshold through threshold plus 14 days'
);
select pg_temp.assert_true(
  exists (select 1 from recall_cohort where patient_id = '00000000-0000-4000-8000-000000001403'),
  'a patient one day beyond threshold remains eligible after a failed prior run'
);
select pg_temp.assert_true(
  not exists (select 1 from recall_cohort where patient_id in (
    '00000000-0000-4000-8000-000000001405',
    '00000000-0000-4000-8000-000000001406'
  )),
  'recall range and cooldown must exclude ineligible patients'
);

create temporary table recall_replay as select * from public.reserve_due_recalls();
select pg_temp.assert_true(
  (select count(*) = 0 from recall_replay),
  'pending recall reservations must deduplicate daily retries'
);

insert into public.broadcast_campaigns (
  id, appointment_time, clinic_timezone, procedure_type, duration_min,
  status, wave_plan, claimed_by, claimed_at, expires_at
) values (
  '00000000-0000-4000-8000-000000001407', now() - interval '1 hour',
  'UTC', 'HYGIENE', 60, 'FILLED', '[{"size":3,"delay_min":7}]',
  '00000000-0000-4000-8000-000000001402', now() - interval '1 day',
  now() + interval '1 day'
);

select public.mark_appointment_complete(
  '00000000-0000-4000-8000-000000001407',
  '00000000-0000-4000-8000-000000001401'
) as review_message_id \gset
select pg_temp.assert_true(
  :'review_message_id'::uuid is not null,
  'completed appointment must schedule one review request'
);
update public.scheduled_messages set run_after = now() - interval '1 minute'
 where id = :'review_message_id';
create temporary table due_review as
select * from public.get_due_scheduled_messages('REVIEW_REQUEST');
select pg_temp.assert_true(
  (
    select count(*) = 1
       and bool_and(review_url = 'https://reviews.example.test/clinic')
       and bool_and(position('00000000' in review_url) = 0)
      from due_review
  ),
  'review URL must be clinic-generic with no patient identifier'
);

select public.complete_scheduled_message(
  :'review_message_id', 'SM_REVIEW_001',
  'Thank you for visiting. Review us at https://reviews.example.test/clinic',
  'QUEUED', null
);
select pg_temp.assert_true(
  public.mark_appointment_complete(
    '00000000-0000-4000-8000-000000001407',
    '00000000-0000-4000-8000-000000001401'
  ) is null,
  'review cooldown must block another request'
);

update public.clinic_config set feature_recalls = false, feature_reviews = false;
delete from public.scheduled_messages where status = 'PENDING';
select pg_temp.assert_true(
  (select count(*) = 0 from public.reserve_due_recalls()),
  'recalls disabled must reserve nothing'
);
select pg_temp.assert_true(
  public.mark_appointment_complete(
    '00000000-0000-4000-8000-000000001407',
    '00000000-0000-4000-8000-000000001401'
  ) is null,
  'reviews disabled must schedule nothing'
);

select 'PASS: ranged recalls, review delay/cooldown, generic URL, and flags' as result;

rollback;
