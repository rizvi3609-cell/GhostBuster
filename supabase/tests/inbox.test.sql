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
  public.manual_reply_requests,
  public.unhandled_inbox,
  public.sms_logs,
  public.staff,
  public.patients
restart identity cascade;

update public.clinic_config
   set timezone = 'UTC',
       quiet_hours_start = '00:00',
       quiet_hours_end = '23:59',
       max_messages_per_week = 10,
       automation_paused = false;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000001201', 'inbox.one@example.test'),
  ('00000000-0000-4000-8000-000000001202', 'inbox.two@example.test')
on conflict (id) do nothing;
insert into public.staff (id, email, full_name, role, active) values
  ('00000000-0000-4000-8000-000000001201', 'inbox.one@example.test', 'Inbox Staff One', 'FRONT_DESK', true),
  ('00000000-0000-4000-8000-000000001202', 'inbox.two@example.test', 'Inbox Staff Two', 'ADMIN', true);
insert into public.patients (
  id, full_name, phone_number, opted_out, consent_status
) values (
  '00000000-0000-4000-8000-000000001203', 'Inbox Test Patient',
  '+15005550203', false, 'GRANTED'
);

insert into public.unhandled_inbox (
  id, patient_id, message_sid, message_body, status
) values
  ('00000000-0000-4000-8000-000000001204', '00000000-0000-4000-8000-000000001203', 'SM_INBOX_001', 'First question', 'UNREAD'),
  ('00000000-0000-4000-8000-000000001205', '00000000-0000-4000-8000-000000001203', 'SM_INBOX_002', 'Second question', 'UNREAD');

select pg_temp.assert_true(
  public.assign_inbox_message(
    '00000000-0000-4000-8000-000000001205',
    '00000000-0000-4000-8000-000000001202',
    '00000000-0000-4000-8000-000000001201'
  ),
  'staff must assign an open patient conversation'
);
select pg_temp.assert_true(
  (
    select count(*) = 2 from public.unhandled_inbox
     where patient_id = '00000000-0000-4000-8000-000000001203'
       and status = 'OPEN'
       and assigned_to = '00000000-0000-4000-8000-000000001202'
  ),
  'assignment must update every open row in the patient conversation'
);
select pg_temp.assert_true(
  public.resolve_inbox_message(
    '00000000-0000-4000-8000-000000001205',
    '00000000-0000-4000-8000-000000001201'
  ),
  'staff must resolve an open conversation'
);
select pg_temp.assert_true(
  (
    select count(*) = 2 from public.unhandled_inbox
     where patient_id = '00000000-0000-4000-8000-000000001203'
       and status = 'RESOLVED'
  ),
  'resolve must close every open row in the conversation'
);

insert into public.unhandled_inbox (
  id, patient_id, message_sid, message_body, status
) values (
  '00000000-0000-4000-8000-000000001206',
  '00000000-0000-4000-8000-000000001203',
  'SM_INBOX_003', 'Can you call me?', 'UNREAD'
);

create temporary table allowed_reply as
select * from public.reserve_manual_reply(
  '00000000-0000-4000-8000-000000001207',
  '00000000-0000-4000-8000-000000001206',
  '00000000-0000-4000-8000-000000001203',
  '00000000-0000-4000-8000-000000001201',
  'Please call the front desk when convenient.'
);
select pg_temp.assert_true(
  (select should_send and phone_number = '+15005550203' from allowed_reply),
  'eligible manual reply must reserve before Twilio'
);

create temporary table replay_reply as
select * from public.reserve_manual_reply(
  '00000000-0000-4000-8000-000000001207',
  '00000000-0000-4000-8000-000000001206',
  '00000000-0000-4000-8000-000000001203',
  '00000000-0000-4000-8000-000000001201',
  'Please call the front desk when convenient.'
);
select pg_temp.assert_true(
  (select not should_send and request_status = 'PENDING' from replay_reply),
  'replayed manual request must not send twice'
);

select pg_temp.assert_true(
  public.complete_manual_reply(
    '00000000-0000-4000-8000-000000001207',
    'SM_MANUAL_REPLY_001', 'QUEUED', null
  ),
  'successful Twilio reply must complete the reservation'
);
select pg_temp.assert_true(
  not public.complete_manual_reply(
    '00000000-0000-4000-8000-000000001207',
    'SM_MANUAL_REPLY_001', 'QUEUED', null
  ),
  'completion replay must have no side effects'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.sms_logs where message_sid = 'SM_MANUAL_REPLY_001'),
  'manual reply must create one SMS log'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.audit_events where event_type = 'MANUAL_REPLY_SENT'),
  'manual reply must create one staff audit event'
);

update public.clinic_config set automation_paused = true;
update public.patients set opted_out = true, consent_status = 'REVOKED'
 where id = '00000000-0000-4000-8000-000000001203';
create temporary table blocked_kill as
select * from public.reserve_manual_reply(
  '00000000-0000-4000-8000-000000001208',
  '00000000-0000-4000-8000-000000001206',
  '00000000-0000-4000-8000-000000001203',
  '00000000-0000-4000-8000-000000001201', 'Blocked'
);
select pg_temp.assert_true(
  (select blocked_reason = 'AUTOMATION_PAUSED' from blocked_kill),
  'kill switch must be checked before opt-out and consent'
);

update public.clinic_config set automation_paused = false;
create temporary table blocked_optout as
select * from public.reserve_manual_reply(
  '00000000-0000-4000-8000-000000001209',
  '00000000-0000-4000-8000-000000001206',
  '00000000-0000-4000-8000-000000001203',
  '00000000-0000-4000-8000-000000001201', 'Blocked'
);
select pg_temp.assert_true(
  (select blocked_reason = 'OPTED_OUT' from blocked_optout),
  'opt-out must block a staff reply before consent checks'
);

update public.patients set opted_out = false, consent_status = 'REVOKED'
 where id = '00000000-0000-4000-8000-000000001203';
create temporary table blocked_consent as
select * from public.reserve_manual_reply(
  '00000000-0000-4000-8000-000000001210',
  '00000000-0000-4000-8000-000000001206',
  '00000000-0000-4000-8000-000000001203',
  '00000000-0000-4000-8000-000000001201', 'Blocked'
);
select pg_temp.assert_true(
  (select blocked_reason = 'NO_CONSENT' from blocked_consent),
  'revoked consent must block a manual reply'
);

select 'PASS: inbox assignment, resolve, reply idempotency, and send checks' as result;

rollback;
