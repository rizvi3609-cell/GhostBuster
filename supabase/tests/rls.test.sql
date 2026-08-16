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
  public.staff,
  public.patients
restart identity cascade;

insert into public.patients (
  id,
  full_name,
  phone_number,
  consent_status
) values
  (
    '00000000-0000-0000-0000-000000000601',
    'RLS Test Patient One',
    '+15005550006',
    'GRANTED'
  ),
  (
    '00000000-0000-0000-0000-000000000602',
    'RLS Test Patient Two',
    '+15005550007',
    'GRANTED'
  );

insert into auth.users (id, email)
values (
  '00000000-0000-0000-0000-000000000701',
  'rls.staff@example.test'
);

insert into public.staff (id, email, full_name, role, active)
values (
  '00000000-0000-0000-0000-000000000701',
  'rls.staff@example.test',
  'RLS Test Staff',
  'FRONT_DESK',
  true
);

do $test$
declare
  protected_table text;
  should_authenticated_read boolean;
  rls_enabled boolean;
begin
  foreach protected_table in array array[
    'patients',
    'broadcast_campaigns',
    'campaign_recipients',
    'campaign_wave_runs',
    'sms_logs',
    'unhandled_inbox',
    'scheduled_messages',
    'import_batches',
    'import_batch_chunks',
    'audit_events',
    'clinic_config',
    'slot_templates',
    'staff'
  ] loop
    select c.relrowsecurity
      into rls_enabled
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = protected_table;

    if rls_enabled is not true then
      raise exception 'RLS is not enabled on public.%', protected_table;
    end if;

    if has_table_privilege(
      'anon',
      format('public.%I', protected_table),
      'SELECT, INSERT, UPDATE, DELETE'
    ) then
      raise exception 'anon unexpectedly has privileges on public.%', protected_table;
    end if;

    if has_table_privilege(
      'authenticated',
      format('public.%I', protected_table),
      'INSERT, UPDATE, DELETE'
    ) then
      raise exception 'authenticated unexpectedly has write privileges on public.%',
        protected_table;
    end if;

    should_authenticated_read := protected_table in (
      'patients',
      'broadcast_campaigns',
      'unhandled_inbox'
    );

    if has_table_privilege(
      'authenticated',
      format('public.%I', protected_table),
      'SELECT'
    ) is distinct from should_authenticated_read then
      raise exception 'authenticated SELECT privilege is wrong on public.%',
        protected_table;
    end if;
  end loop;
end
$test$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000701';
select pg_temp.assert_true(
  (select count(*) = 2 from public.patients),
  'active staff must read patients through RLS'
);
reset role;

update public.staff
   set active = false
 where id = '00000000-0000-0000-0000-000000000701';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000701';
select pg_temp.assert_true(
  (select count(*) = 0 from public.patients),
  'inactive staff must read no patients through RLS'
);
reset role;

select pg_temp.assert_true(
  not has_function_privilege(
    'anon',
    'public.claim_slot(uuid,uuid,text)',
    'EXECUTE'
  ),
  'anon must not execute claim_slot'
);

select pg_temp.assert_true(
  not has_function_privilege(
    'authenticated',
    'public.claim_slot(uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated browser sessions must not execute claim_slot'
);

select pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'public.claim_slot(uuid,uuid,text)',
    'EXECUTE'
  ),
  'service role must execute claim_slot'
);

select 'PASS: RLS and role-privilege invariants' as result;

rollback;
