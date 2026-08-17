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
  public.stripe_events,
  public.payment_reservations,
  public.campaign_recipients,
  public.broadcast_campaigns,
  public.patients
restart identity cascade;

update public.clinic_config
   set feature_stripe_deposits = false, deposit_amount = 50.00;

insert into public.patients (
  id, full_name, phone_number, consent_status
) values
  ('00000000-0000-4000-8000-000000001501', 'Stripe Patient One', '+15005550501', 'GRANTED'),
  ('00000000-0000-4000-8000-000000001502', 'Stripe Patient Two', '+15005550502', 'GRANTED');

insert into public.broadcast_campaigns (
  id, appointment_time, clinic_timezone, procedure_type, duration_min,
  status, wave_plan, expires_at, requires_deposit
) values (
  '00000000-0000-4000-8000-000000001503', now() + interval '1 day',
  'UTC', 'HYGIENE', 60, 'OPEN', '[{"size":2,"delay_min":7}]',
  now() + interval '1 day', true
);
insert into public.campaign_recipients (
  campaign_id, patient_id, wave_number, send_order
) values (
  '00000000-0000-4000-8000-000000001503',
  '00000000-0000-4000-8000-000000001501', 1, 1
);
select claimed from public.claim_slot(
  '00000000-0000-4000-8000-000000001503',
  '00000000-0000-4000-8000-000000001501', 'SM_STRIPE_FLAG_OFF'
) \gset flag_off_
select pg_temp.assert_true(:'flag_off_claimed' = 't', 'normal claim must succeed with flag off');
select pg_temp.assert_true(
  (select status = 'FILLED' and claim_expires_at is null from public.broadcast_campaigns where id = '00000000-0000-4000-8000-000000001503'),
  'Stripe flag off must preserve Phase 8 FILLED behavior'
);
select pg_temp.assert_true(
  (select count(*) = 0 from public.payment_reservations),
  'Stripe flag off must create no reservation'
);

update public.clinic_config set feature_stripe_deposits = true;
insert into public.broadcast_campaigns (
  id, appointment_time, clinic_timezone, procedure_type, duration_min,
  status, wave_plan, expires_at, requires_deposit
) values (
  '00000000-0000-4000-8000-000000001504', now() + interval '1 day',
  'UTC', 'HYGIENE', 60, 'OPEN', '[{"size":2,"delay_min":7}]',
  now() + interval '1 day', true
);
insert into public.campaign_recipients (
  campaign_id, patient_id, wave_number, send_order
) values
  ('00000000-0000-4000-8000-000000001504', '00000000-0000-4000-8000-000000001501', 1, 1),
  ('00000000-0000-4000-8000-000000001504', '00000000-0000-4000-8000-000000001502', 1, 2);

select claimed from public.claim_slot(
  '00000000-0000-4000-8000-000000001504',
  '00000000-0000-4000-8000-000000001501', 'SM_STRIPE_WINNER'
) \gset deposit_
select pg_temp.assert_true(:'deposit_claimed' = 't', 'deposit reservation winner must claim atomically');
select pg_temp.assert_true(
  (select status = 'PENDING_PAYMENT' and claim_expires_at > now() from public.broadcast_campaigns where id = '00000000-0000-4000-8000-000000001504'),
  'deposit claim must reserve for ten minutes instead of filling'
);
select pg_temp.assert_true(
  (select amount_usd = 50 and status = 'PENDING' from public.payment_reservations where campaign_id = '00000000-0000-4000-8000-000000001504'),
  'deposit claim must create one payment reservation'
);
select pg_temp.assert_true(
  (select not claimed from public.claim_slot(
    '00000000-0000-4000-8000-000000001504',
    '00000000-0000-4000-8000-000000001502', 'SM_STRIPE_LOSER'
  )),
  'second deposit claimant must lose'
);

select reservation_id from public.get_pending_payment_reservation(
  '00000000-0000-4000-8000-000000001504'
) \gset
select pg_temp.assert_true(
  public.attach_stripe_payment_link(
    :'reservation_id', 'plink_test_unique_001', 'https://buy.stripe.com/test_random_link'
  ),
  'one unique payment link must attach to the reservation'
);
select pg_temp.assert_true(
  public.ingest_stripe_event('evt_test_001', 'checkout.session.completed'),
  'first Stripe event must insert its idempotency key'
);
select pg_temp.assert_true(
  not public.ingest_stripe_event('evt_test_001', 'checkout.session.completed'),
  'Stripe event replay must short-circuit'
);
select pg_temp.assert_true(
  public.complete_stripe_payment('plink_test_unique_001', 'evt_test_001') =
    '00000000-0000-4000-8000-000000001504'::uuid,
  'verified payment must promote reservation to FILLED'
);
select pg_temp.assert_true(
  (select status = 'FILLED' and claim_expires_at is null from public.broadcast_campaigns where id = '00000000-0000-4000-8000-000000001504'),
  'paid reservation must become a filled campaign'
);

insert into public.broadcast_campaigns (
  id, appointment_time, clinic_timezone, procedure_type, duration_min,
  status, wave_plan, expires_at, requires_deposit
) values (
  '00000000-0000-4000-8000-000000001506', now() + interval '1 day',
  'UTC', 'HYGIENE', 60, 'OPEN', '[{"size":2,"delay_min":7}]',
  now() + interval '1 day', true
);
insert into public.campaign_recipients (
  campaign_id, patient_id, wave_number, send_order
) values (
  '00000000-0000-4000-8000-000000001506',
  '00000000-0000-4000-8000-000000001502', 1, 1
);
select * from public.claim_slot(
  '00000000-0000-4000-8000-000000001506',
  '00000000-0000-4000-8000-000000001502', 'SM_STRIPE_FAIL'
);
select reservation_id from public.get_pending_payment_reservation(
  '00000000-0000-4000-8000-000000001506'
) \gset failed_
select public.attach_stripe_payment_link(
  :'failed_reservation_id', 'plink_test_failed_001', 'https://buy.stripe.com/test_failed_link'
);
select pg_temp.assert_true(
  public.fail_stripe_payment('plink_test_failed_001', 'evt_test_failed_001') =
    '00000000-0000-4000-8000-000000001506'::uuid,
  'failed payment must release its reservation'
);
select pg_temp.assert_true(
  (select status = 'ESCALATING' and claimed_by is null from public.broadcast_campaigns where id = '00000000-0000-4000-8000-000000001506'),
  'payment failure must resume campaign waves'
);

insert into public.broadcast_campaigns (
  id, appointment_time, clinic_timezone, procedure_type, duration_min,
  status, wave_plan, expires_at, requires_deposit
) values (
  '00000000-0000-4000-8000-000000001505', now() + interval '1 day',
  'UTC', 'HYGIENE', 60, 'OPEN', '[{"size":2,"delay_min":7}]',
  now() + interval '1 day', true
);
insert into public.campaign_recipients (
  campaign_id, patient_id, wave_number, send_order
) values (
  '00000000-0000-4000-8000-000000001505',
  '00000000-0000-4000-8000-000000001502', 1, 1
);
select * from public.claim_slot(
  '00000000-0000-4000-8000-000000001505',
  '00000000-0000-4000-8000-000000001502', 'SM_STRIPE_EXPIRE'
);
update public.payment_reservations set expires_at = now() - interval '1 minute'
 where campaign_id = '00000000-0000-4000-8000-000000001505';
update public.broadcast_campaigns set claim_expires_at = now() - interval '1 minute'
 where id = '00000000-0000-4000-8000-000000001505';
create temporary table released as select * from public.release_expired_reservations();
select pg_temp.assert_true(
  exists (select 1 from released where campaign_id = '00000000-0000-4000-8000-000000001505'),
  'expired reservation must be returned for wave resumption'
);
select pg_temp.assert_true(
  (
    select status = 'ESCALATING'
       and claimed_by is null
       and claim_expires_at is null
       and next_wave_at <= now()
      from public.broadcast_campaigns
     where id = '00000000-0000-4000-8000-000000001505'
  ),
  'expired deposit must release the slot and resume escalation'
);

select 'PASS: Stripe flags, atomic deposit claim, payment, replay, and expiry' as result;

rollback;
