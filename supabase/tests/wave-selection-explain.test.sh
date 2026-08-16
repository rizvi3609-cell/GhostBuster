#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the disposable test database}"

psql_args=("$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atq)

campaign_id="$(psql "${psql_args[@]}" <<'SQL'
insert into public.broadcast_campaigns (
  appointment_time,
  clinic_timezone,
  procedure_type,
  duration_min,
  status,
  wave_plan,
  expires_at
) values (
  now() + interval '1 day',
  'America/New_York',
  'HYGIENE',
  60,
  'OPEN',
  '[{"size":3,"delay_min":7}]',
  now() + interval '2 days'
)
returning id;
SQL
)"

psql "${psql_args[@]}" <<'SQL'
insert into public.patients (
  full_name,
  phone_number,
  consent_status,
  reliability_score,
  last_visit_date,
  preferred_procedures
)
select
  'Index Test Patient ' || value,
  '+1999' || lpad(value::text, 8, '0'),
  'GRANTED',
  value % 101,
  current_date - (value % 730),
  array['HYGIENE']
from generate_series(1, 20000) as value
on conflict (phone_number) do nothing;

vacuum (analyze) public.patients;
SQL

plan="$(psql "${psql_args[@]}" -v campaign_id="$campaign_id" <<'SQL'
explain (analyze, buffers, format text)
select p.id, p.full_name, p.phone_number
  from public.patients p
 where p.opted_out = false
   and p.consent_status = 'GRANTED'
   and not exists (
     select 1 from public.campaign_recipients r
      where r.campaign_id = :'campaign_id'::uuid
        and r.patient_id = p.id
   )
   and (
     select count(*) from public.sms_logs l
      where l.patient_id = p.id
        and l.direction = 'OUTBOUND'
        and l.created_at > now() - interval '7 days'
   ) < 3
   and ('HYGIENE' = any(p.preferred_procedures) or p.preferred_procedures = '{}')
 order by p.reliability_score desc, p.last_visit_date asc nulls last
 limit 3;
SQL
)"

printf '%s\n' "$plan"

if ! grep -q 'Index Scan using patients_eligible_idx' <<<"$plan"; then
  echo 'FAIL: wave-selection query did not use patients_eligible_idx' >&2
  exit 1
fi

if grep -q 'Seq Scan on patients p' <<<"$plan"; then
  echo 'FAIL: wave-selection query used a sequential patient scan' >&2
  exit 1
fi

echo 'PASS: wave-selection query used patients_eligible_idx at 20k patients'

search_plan="$(psql "${psql_args[@]}" <<'SQL'
explain (analyze, buffers, format text)
select
  id,
  full_name,
  phone_number,
  consent_status,
  opted_out,
  reliability_score,
  last_visit_date
from public.patients
where full_name ilike '%Index Test Patient 19999%'
order by full_name asc
limit 50;
SQL
)"

printf '%s\n' "$search_plan"

if ! grep -q 'patients_name_trgm' <<<"$search_plan"; then
  echo 'FAIL: patient name search did not use patients_name_trgm' >&2
  exit 1
fi

if grep -q 'Seq Scan on patients' <<<"$search_plan"; then
  echo 'FAIL: patient name search used a sequential scan' >&2
  exit 1
fi

echo 'PASS: server-side patient search used patients_name_trgm at 20k patients'
