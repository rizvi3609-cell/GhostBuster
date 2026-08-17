#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the disposable test database}"
psql_args=("$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atq)

psql "${psql_args[@]}" <<'SQL'
insert into public.broadcast_campaigns (
  appointment_time,
  clinic_timezone,
  procedure_type,
  duration_min,
  status,
  wave_plan,
  expires_at
)
select
  now() + interval '1 day' + value * interval '1 minute',
  'UTC',
  'HYGIENE',
  60,
  'DRAFT',
  '[{"size":3,"delay_min":7}]',
  now() + interval '2 days'
from generate_series(1, 500) value;

vacuum (analyze) public.broadcast_campaigns;
SQL

plan="$(psql "${psql_args[@]}" <<'SQL'
explain (analyze, buffers, format text)
select id, appointment_time
from public.broadcast_campaigns
where status in ('DRAFT', 'OPEN', 'ESCALATING', 'PENDING_PAYMENT')
  and appointment_time > now() - interval '1 day'
order by appointment_time asc
limit 20;
SQL
)"
printf '%s\n' "$plan"

if ! grep -q 'campaigns_operational_idx' <<<"$plan"; then
  echo 'FAIL: dashboard campaign query did not use campaigns_operational_idx' >&2
  exit 1
fi

rpc_plan="$(psql "${psql_args[@]}" <<'SQL'
explain (analyze, buffers, format text)
select * from public.get_dashboard_campaigns();
SQL
)"
printf '%s\n' "$rpc_plan"
execution_ms="$(awk '/Execution Time:/ {print $3}' <<<"$rpc_plan" | tail -n 1)"

if ! awk -v value="$execution_ms" 'BEGIN { exit !(value < 100) }'; then
  echo "FAIL: dashboard aggregate query took ${execution_ms}ms" >&2
  exit 1
fi

echo "PASS: dashboard query used its index and completed in ${execution_ms}ms at 500 campaigns"
