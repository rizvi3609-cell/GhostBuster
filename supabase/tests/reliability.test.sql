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
  public.sms_logs,
  public.broadcast_campaigns,
  public.staff,
  public.patients
restart identity cascade;

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000001601', 'score.staff@example.test')
on conflict (id) do nothing;
insert into public.staff (id, email, full_name, role, active)
values ('00000000-0000-4000-8000-000000001601', 'score.staff@example.test', 'Score Staff', 'ADMIN', true);
insert into public.patients (
  id, full_name, phone_number, consent_status, reliability_score,
  last_visit_date, preferred_procedures
) values (
  '00000000-0000-4000-8000-000000001602', 'Score Patient',
  '+15005550602', 'GRANTED', 50, current_date - 180, array['HYGIENE']
);

insert into public.broadcast_campaigns (
  appointment_time, clinic_timezone, procedure_type, duration_min,
  status, wave_plan, claimed_by, claimed_at, expires_at
) values
  (now() - interval '2 days', 'UTC', 'HYGIENE', 60, 'FILLED', '[{"size":1,"delay_min":7}]', '00000000-0000-4000-8000-000000001602', now() - interval '2 days', now() + interval '1 day'),
  (now() - interval '1 day', 'UTC', 'HYGIENE', 60, 'FILLED', '[{"size":1,"delay_min":7}]', '00000000-0000-4000-8000-000000001602', now() - interval '1 day', now() + interval '1 day');
insert into public.sms_logs (
  message_sid, patient_id, direction, status, created_at
) values
  ('SM_SCORE_001', '00000000-0000-4000-8000-000000001602', 'OUTBOUND', 'DELIVERED', now() - interval '2 days'),
  ('SM_SCORE_002', '00000000-0000-4000-8000-000000001602', 'OUTBOUND', 'DELIVERED', now() - interval '1 day');

create temporary table components as
select * from public.get_patient_reliability_components(
  '00000000-0000-4000-8000-000000001602', 'HYGIENE'
);
select pg_temp.assert_true(
  (
    select successful_claims = 2
       and prior_claims_points = 20
       and recency_points = 30
       and procedure_match_points = 20
       and messages_last_7d = 2
       and contact_restraint_points = 6
       and computed_score = 76
       and effective_score = 76
      from components
  ),
  'balanced score must expose all four weighted components'
);
select pg_temp.assert_true(
  (
    select procedure_match_points = 0
      from public.get_patient_reliability_components(
        '00000000-0000-4000-8000-000000001602', 'CROWN'
      )
  ),
  'procedure mismatch must be visible instead of hidden in an opaque score'
);

select pg_temp.assert_true(
  public.override_patient_reliability(
    '00000000-0000-4000-8000-000000001602', 55,
    'Staff knows patient availability changed',
    '00000000-0000-4000-8000-000000001601'
  ),
  'staff must be able to save an explained reliability override'
);
select pg_temp.assert_true(
  (
    select effective_score = 55 and override_reason is not null
      from public.get_patient_reliability_components(
        '00000000-0000-4000-8000-000000001602', 'HYGIENE'
      )
  ),
  'override and reason must be visible in score components'
);
select public.refresh_reliability_scores();
select pg_temp.assert_true(
  (select reliability_score = 55 from public.patients where id = '00000000-0000-4000-8000-000000001602'),
  'daily refresh must preserve an active override'
);
select pg_temp.assert_true(
  public.clear_patient_reliability_override(
    '00000000-0000-4000-8000-000000001602',
    '00000000-0000-4000-8000-000000001601'
  ),
  'staff must be able to clear an override'
);
select pg_temp.assert_true(
  (
    select reliability_override is null and reliability_score = 76
      from public.patients where id = '00000000-0000-4000-8000-000000001602'
  ),
  'clearing override must restore the computed score'
);
select pg_temp.assert_true(
  (select count(*) = 2 from public.audit_events where event_type in ('RELIABILITY_OVERRIDDEN', 'RELIABILITY_OVERRIDE_CLEARED')),
  'override changes must be fully audited'
);

select 'PASS: transparent reliability components, refresh, override, and audit' as result;

rollback;
