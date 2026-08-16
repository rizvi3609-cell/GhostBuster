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
  public.import_batch_chunks,
  public.import_batches,
  public.campaign_recipients,
  public.broadcast_campaigns,
  public.staff,
  public.patients
restart identity cascade;

insert into auth.users (id, email)
values (
  '00000000-0000-4000-8000-000000000801',
  'import.staff@example.test'
)
on conflict (id) do nothing;

insert into public.staff (id, email, full_name, role, active)
values (
  '00000000-0000-4000-8000-000000000801',
  'import.staff@example.test',
  'Import Test Staff',
  'FRONT_DESK',
  true
);

insert into public.patients (
  id,
  full_name,
  phone_number,
  opted_out,
  consent_status,
  preferred_procedures
) values (
  '00000000-0000-4000-8000-000000000802',
  'Existing Opted Out Patient',
  '+15005550006',
  true,
  'REVOKED',
  array['OLD']
);

insert into public.import_batches (
  id,
  imported_by,
  filename,
  row_count,
  inserted_count,
  updated_count,
  skipped_count,
  invalid_count,
  column_mapping
) values (
  '00000000-0000-4000-8000-000000000803',
  '00000000-0000-4000-8000-000000000801',
  'fake-patients.csv',
  3,
  0,
  0,
  1,
  0,
  '{"fullName":"Name","phone":"Phone","lastVisit":"Last Visit","procedure":"Procedure"}'
);

select *
from public.import_patient_batch(
  '00000000-0000-4000-8000-000000000803',
  '00000000-0000-4000-8000-000000000801',
  0,
  '[
    {
      "full_name":"Updated Opted Out Patient",
      "phone_number":"+15005550006",
      "last_visit_date":"2025-06-01",
      "preferred_procedures":["HYGIENE"]
    },
    {
      "full_name":"New Test Patient",
      "phone_number":"+15005550007",
      "last_visit_date":null,
      "preferred_procedures":[]
    }
  ]'::jsonb
);

select pg_temp.assert_true(
  (
    select opted_out = true
       and consent_status = 'REVOKED'
       and full_name = 'Updated Opted Out Patient'
       and preferred_procedures = array['HYGIENE']
      from public.patients
     where phone_number = '+15005550006'
  ),
  'CSV upsert must preserve opt-out and revoked consent'
);

select *
from public.import_patient_batch(
  '00000000-0000-4000-8000-000000000803',
  '00000000-0000-4000-8000-000000000801',
  0,
  '[
    {
      "full_name":"Updated Opted Out Patient",
      "phone_number":"+15005550006",
      "last_visit_date":"2025-06-01",
      "preferred_procedures":["HYGIENE"]
    },
    {
      "full_name":"New Test Patient",
      "phone_number":"+15005550007",
      "last_visit_date":null,
      "preferred_procedures":[]
    }
  ]'::jsonb
);

select pg_temp.assert_true(
  (
    select inserted_count = 1
       and updated_count = 1
       and skipped_count = 1
       and invalid_count = 0
      from public.import_batches
     where id = '00000000-0000-4000-8000-000000000803'
  ),
  'replayed chunks must not double-count import results'
);

select *
from public.finalize_patient_import(
  '00000000-0000-4000-8000-000000000803',
  '00000000-0000-4000-8000-000000000801'
);

select *
from public.finalize_patient_import(
  '00000000-0000-4000-8000-000000000803',
  '00000000-0000-4000-8000-000000000801'
);

select pg_temp.assert_true(
  (
    select count(*) = 1
      from public.audit_events
     where event_type = 'CSV_IMPORTED'
       and entity_id = '00000000-0000-4000-8000-000000000803'
  ),
  'finalization must write exactly one CSV_IMPORTED audit event'
);

insert into public.import_batches (
  id,
  imported_by,
  filename,
  row_count,
  inserted_count,
  updated_count,
  skipped_count,
  invalid_count,
  column_mapping
) values (
  '00000000-0000-4000-8000-000000000804',
  '00000000-0000-4000-8000-000000000801',
  'fake-5000-patients.csv',
  5000,
  0,
  0,
  0,
  0,
  '{"fullName":"Name","phone":"Phone","lastVisit":"Last Visit","procedure":"Procedure"}'
);

do $test$
declare
  batch_number int;
  batch_rows jsonb;
begin
  for batch_number in 0..9 loop
    select jsonb_agg(
      jsonb_build_object(
        'full_name', 'Bulk Test Patient ' || value,
        'phone_number', '+1998' || lpad(value::text, 8, '0'),
        'last_visit_date', null,
        'preferred_procedures', jsonb_build_array('HYGIENE')
      )
    )
      into batch_rows
      from generate_series(batch_number * 500 + 1, batch_number * 500 + 500) value;

    perform public.import_patient_batch(
      '00000000-0000-4000-8000-000000000804',
      '00000000-0000-4000-8000-000000000801',
      batch_number,
      batch_rows
    );
  end loop;
end
$test$;

select *
from public.finalize_patient_import(
  '00000000-0000-4000-8000-000000000804',
  '00000000-0000-4000-8000-000000000801'
);

select pg_temp.assert_true(
  (
    select inserted_count = 5000
       and updated_count = 0
      from public.import_batches
     where id = '00000000-0000-4000-8000-000000000804'
  ),
  '5,000 rows must import as 10 complete batches'
);

select pg_temp.assert_true(
  (
    select count(*) = 10
      from public.import_batch_chunks
     where import_batch_id = '00000000-0000-4000-8000-000000000804'
  ),
  '5,000 rows must create exactly 10 chunk ledger rows'
);

select 'PASS: patient import preservation, idempotency, and 5,000-row batching' as result;

rollback;
