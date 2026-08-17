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
  public.unhandled_inbox,
  public.campaign_wave_runs,
  public.campaign_recipients,
  public.sms_logs,
  public.broadcast_campaigns,
  public.patients
restart identity cascade;

update public.clinic_config
   set timezone = 'UTC',
       quiet_hours_start = '00:00',
       quiet_hours_end = '23:59',
       max_messages_per_week = 10,
       automation_paused = false;

insert into public.patients (
  id, full_name, phone_number, opted_out, consent_status,
  reliability_score, preferred_procedures
) values
  ('00000000-0000-4000-8000-000000001101', 'Inbound Patient One', '+15005550101', false, 'GRANTED', 90, array['HYGIENE']),
  ('00000000-0000-4000-8000-000000001102', 'Inbound Patient Two', '+15005550102', false, 'GRANTED', 80, array['HYGIENE']),
  ('00000000-0000-4000-8000-000000001103', 'Inbound Patient Three', '+15005550103', false, 'GRANTED', 70, array['HYGIENE']);

select pg_temp.assert_true(
  public.ingest_inbound_sms('SM_INBOUND_REPLAY_001', 'STOP') = true,
  'first inbound delivery must insert the replay key'
);
select pg_temp.assert_true(
  public.ingest_inbound_sms('SM_INBOUND_REPLAY_001', 'STOP') = false,
  'replayed MessageSid must short-circuit'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.sms_logs where message_sid = 'SM_INBOUND_REPLAY_001'),
  'replay must leave one inbound log row'
);

select public.link_inbound_sms_patient(
  'SM_INBOUND_REPLAY_001', '00000000-0000-4000-8000-000000001101'
);
select public.process_patient_opt_out(
  '00000000-0000-4000-8000-000000001101', 'SM_INBOUND_REPLAY_001'
);
select pg_temp.assert_true(
  (
    select opted_out and consent_status = 'REVOKED'
      from public.patients where id = '00000000-0000-4000-8000-000000001101'
  ),
  'STOP must revoke consent immediately'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.audit_events where event_type = 'OPT_OUT'),
  'STOP must write one audit event after replay dedupe'
);

insert into public.broadcast_campaigns (
  id, appointment_time, clinic_timezone, procedure_type, duration_min,
  status, wave_plan, expires_at
) values (
  '00000000-0000-4000-8000-000000001104', now() + interval '1 day',
  'UTC', 'HYGIENE', 60, 'OPEN', '[{"size":2,"delay_min":7}]',
  now() + interval '1 day'
);

create temporary table stop_wave as
select * from public.reserve_next_campaign_wave(
  '00000000-0000-4000-8000-000000001104'
);
select pg_temp.assert_true(
  (select count(*) = 2 from stop_wave),
  'wave must still fill from remaining eligible patients'
);
select pg_temp.assert_true(
  not exists (
    select 1 from stop_wave where patient_id = '00000000-0000-4000-8000-000000001101'
  ),
  'STOP patient must be excluded from the very next wave'
);

select pg_temp.assert_true(
  public.process_patient_opt_in(
    '00000000-0000-4000-8000-000000001101', 'SM_OPT_IN_BLOCKED_001'
  ) = true,
  'opt-in is allowed when the patient is not a recipient of an active campaign'
);

insert into public.campaign_recipients (
  campaign_id, patient_id, wave_number, send_order
) values (
  '00000000-0000-4000-8000-000000001104',
  '00000000-0000-4000-8000-000000001101', 1, 3
);
update public.patients
   set opted_out = true, consent_status = 'REVOKED'
 where id = '00000000-0000-4000-8000-000000001101';
select pg_temp.assert_true(
  public.process_patient_opt_in(
    '00000000-0000-4000-8000-000000001101', 'SM_OPT_IN_BLOCKED_002'
  ) = false,
  'opt-in must not reinterpret YES while an active offer exists'
);

select pg_temp.assert_true(
  public.create_unhandled_inbox_message(
    'SM_OTHER_001', '00000000-0000-4000-8000-000000001101', null,
    'Please call me about this'
  ) = public.create_unhandled_inbox_message(
    'SM_OTHER_001', '00000000-0000-4000-8000-000000001101', null,
    'Please call me about this'
  ),
  'unhandled inbox insertion must be idempotent by MessageSid'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.unhandled_inbox where message_sid = 'SM_OTHER_001'),
  'unhandled replay must create one inbox row'
);

insert into public.sms_logs (
  message_sid, patient_id, direction, status
) values (
  'SM_STATUS_001', '00000000-0000-4000-8000-000000001102', 'OUTBOUND', 'QUEUED'
);
select public.reconcile_sms_status('SM_STATUS_001', 'SENT', null, 1, null);
select pg_temp.assert_true(
  public.reconcile_sms_status('SM_STATUS_001', 'QUEUED', null, null, null) = 'SENT',
  'delivery status must not regress from SENT to QUEUED'
);
select public.reconcile_sms_status('SM_STATUS_001', 'DELIVERED', null, 1, 0.0075);
select pg_temp.assert_true(
  public.reconcile_sms_status('SM_STATUS_001', 'FAILED', '30007', 1, null) = 'DELIVERED',
  'terminal delivery status must never regress or change'
);
select pg_temp.assert_true(
  (select status = 'DELIVERED' and price_usd = 0.0075 from public.sms_logs where message_sid = 'SM_STATUS_001'),
  'terminal delivery metadata must be retained'
);

select pg_temp.assert_true(
  public.reconcile_sms_status('SM_STATUS_UNKNOWN_001', 'SENT', null, 1, null) = 'SENT',
  'out-of-order status callback must create an idempotent log row'
);

select 'PASS: inbound replay, STOP enforcement, inbox, opt-in, and status invariants' as result;

rollback;
