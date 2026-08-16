\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_true(
  condition boolean,
  failure_message text
) returns void
language plpgsql
as $function$
begin
  if condition is not true then
    raise exception 'Assertion failed: %', failure_message;
  end if;
end
$function$;

truncate table
  public.audit_events,
  public.import_batches,
  public.scheduled_messages,
  public.unhandled_inbox,
  public.sms_logs,
  public.campaign_recipients,
  public.broadcast_campaigns,
  public.patients
restart identity cascade;

select pg_temp.assert_true(
  (select count(*) = 3 from public.slot_templates),
  'seed migration must remain idempotent'
);

insert into public.patients (
  id,
  full_name,
  phone_number,
  consent_status,
  preferred_procedures,
  updated_at
) values
  (
    '00000000-0000-0000-0000-000000000101',
    'Test Patient One',
    '+15005550006',
    'GRANTED',
    array['HYGIENE'],
    '2000-01-01 00:00:00+00'
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    'Test Patient Two',
    '+15005550007',
    'GRANTED',
    array['HYGIENE'],
    '2000-01-01 00:00:00+00'
  );

do $test$
begin
  begin
    insert into public.patients (full_name, phone_number)
    values ('Invalid Phone Test', '555-123-4567');

    raise exception 'non-E.164 phone unexpectedly succeeded';
  exception
    when check_violation then null;
  end;
end
$test$;

insert into auth.users (id, email)
values (
  '00000000-0000-0000-0000-000000000501',
  'active.staff@example.test'
);

insert into public.staff (id, email, full_name, role, active)
values (
  '00000000-0000-0000-0000-000000000501',
  'active.staff@example.test',
  'Active Test Staff',
  'FRONT_DESK',
  true
);

insert into public.broadcast_campaigns (
  id,
  appointment_time,
  clinic_timezone,
  procedure_type,
  duration_min,
  status,
  wave_plan,
  expires_at
) values (
  '00000000-0000-0000-0000-000000000201',
  now() + interval '1 day',
  'America/New_York',
  'HYGIENE',
  60,
  'OPEN',
  '[{"size":3,"delay_min":7}]',
  now() + interval '2 days'
);

do $test$
begin
  begin
    update public.broadcast_campaigns
       set status = 'FILLED'
     where id = '00000000-0000-0000-0000-000000000201';

    raise exception 'FILLED campaign with no claimant unexpectedly succeeded';
  exception
    when check_violation then null;
  end;
end
$test$;

insert into public.campaign_recipients (
  campaign_id,
  patient_id,
  wave_number,
  send_order
) values (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000101',
  1,
  1
);

do $test$
begin
  begin
    insert into public.campaign_recipients (
      campaign_id,
      patient_id,
      wave_number,
      send_order
    ) values (
      '00000000-0000-0000-0000-000000000201',
      '00000000-0000-0000-0000-000000000101',
      2,
      1
    );

    raise exception 'duplicate campaign recipient unexpectedly succeeded';
  exception
    when unique_violation then null;
  end;
end
$test$;

update public.patients
   set full_name = 'Test Patient One Updated'
 where id = '00000000-0000-0000-0000-000000000101';

select pg_temp.assert_true(
  (
    select updated_at > '2000-01-01 00:00:00+00'
      from public.patients
     where id = '00000000-0000-0000-0000-000000000101'
  ),
  'patients updated_at trigger must advance the timestamp'
);

insert into public.broadcast_campaigns (
  id,
  appointment_time,
  clinic_timezone,
  procedure_type,
  duration_min,
  status,
  wave_plan,
  claimed_by,
  claimed_at,
  claim_expires_at,
  expires_at
) values (
  '00000000-0000-0000-0000-000000000202',
  now() + interval '1 day',
  'America/New_York',
  'HYGIENE',
  60,
  'PENDING_PAYMENT',
  '[{"size":3,"delay_min":7}]',
  '00000000-0000-0000-0000-000000000102',
  now() - interval '11 minutes',
  now() - interval '1 minute',
  now() + interval '2 days'
);

select public.release_expired_reservations();

select pg_temp.assert_true(
  (
    select status = 'ESCALATING'
       and claimed_by is null
       and claim_expires_at is null
      from public.broadcast_campaigns
     where id = '00000000-0000-0000-0000-000000000202'
  ),
  'expired payment reservation must be released atomically'
);

select 'PASS: constraints, triggers, and release-function invariants' as result;

rollback;
