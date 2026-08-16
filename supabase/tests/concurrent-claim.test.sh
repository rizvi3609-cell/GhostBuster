#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the disposable test database}"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

psql_args=("$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atq)

psql "${psql_args[@]}" <<'SQL'
truncate table
  public.audit_events,
  public.campaign_recipients,
  public.broadcast_campaigns,
  public.patients
restart identity cascade;

insert into public.patients (
  id,
  full_name,
  phone_number,
  consent_status,
  preferred_procedures
) values
  (
    '00000000-0000-0000-0000-000000000301',
    'Concurrent Test Patient One',
    '+15005550006',
    'GRANTED',
    array['HYGIENE']
  ),
  (
    '00000000-0000-0000-0000-000000000302',
    'Concurrent Test Patient Two',
    '+15005550007',
    'GRANTED',
    array['HYGIENE']
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
  '00000000-0000-0000-0000-000000000401',
  now() + interval '1 day',
  'America/New_York',
  'HYGIENE',
  60,
  'OPEN',
  '[{"size":3,"delay_min":7}]',
  now() + interval '2 days'
);

insert into public.campaign_recipients (
  campaign_id,
  patient_id,
  wave_number,
  send_order
) values
  (
    '00000000-0000-0000-0000-000000000401',
    '00000000-0000-0000-0000-000000000301',
    1,
    1
  ),
  (
    '00000000-0000-0000-0000-000000000401',
    '00000000-0000-0000-0000-000000000302',
    1,
    2
  );
SQL

target_time="$(psql "${psql_args[@]}" -c \
  "select clock_timestamp() + interval '3 seconds';")"

run_claim() {
  local patient_id="$1"
  local message_sid="$2"

  PGAPPNAME="ghost-buster-concurrent-claim-${patient_id: -3}" \
    psql "${psql_args[@]}" \
      -v target_time="$target_time" \
      -v patient_id="$patient_id" \
      -v message_sid="$message_sid" <<'SQL'
set role service_role;

select pg_sleep(
  greatest(
    extract(epoch from (:'target_time'::timestamptz - clock_timestamp())),
    0
  )
);

select claimed
  from public.claim_slot(
    '00000000-0000-0000-0000-000000000401',
    :'patient_id'::uuid,
    :'message_sid'
  );
SQL
}

run_claim \
  '00000000-0000-0000-0000-000000000301' \
  'SM_CONCURRENT_TEST_001' >"$work_dir/claim-one.out" &
pid_one=$!

run_claim \
  '00000000-0000-0000-0000-000000000302' \
  'SM_CONCURRENT_TEST_002' >"$work_dir/claim-two.out" &
pid_two=$!

wait "$pid_one"
wait "$pid_two"

result_one="$(grep -E '^[tf]$' "$work_dir/claim-one.out" | tail -n 1)"
result_two="$(grep -E '^[tf]$' "$work_dir/claim-two.out" | tail -n 1)"

true_count=0
[[ "$result_one" == "t" ]] && true_count=$((true_count + 1))
[[ "$result_two" == "t" ]] && true_count=$((true_count + 1))

if [[ "$true_count" -ne 1 ]]; then
  echo "FAIL: expected one winner; got results '$result_one' and '$result_two'" >&2
  exit 1
fi

verification="$(psql "${psql_args[@]}" <<'SQL'
select
  (select count(*) from public.broadcast_campaigns where status = 'FILLED'),
  (select count(*) from public.audit_events where event_type = 'SLOT_CLAIMED'),
  (select count(*) from public.campaign_recipients where responded_at is not null);
SQL
)"

if [[ "$verification" != "1|1|1" ]]; then
  echo "FAIL: expected one filled campaign, audit event, and response; got '$verification'" >&2
  exit 1
fi

echo "PASS: two simultaneous database connections produced exactly one winner"
