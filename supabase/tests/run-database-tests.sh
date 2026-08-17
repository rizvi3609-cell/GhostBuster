#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to a disposable PostgreSQL test database}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
psql_args=("$DATABASE_URL" -X -v ON_ERROR_STOP=1)

server_major="$(psql "${psql_args[@]}" -Atq -c \
  "select current_setting('server_version_num')::int / 10000;")"
if [[ "$server_major" != "15" ]]; then
  echo "PostgreSQL 15 is required; connected server reports major version $server_major." >&2
  exit 1
fi

database_name="$(psql "${psql_args[@]}" -Atq -c 'select current_database();')"
if [[ "$database_name" != *_test && "${ALLOW_NON_TEST_DATABASE:-0}" != "1" ]]; then
  echo "Refusing destructive tests against database '$database_name'." >&2
  echo "Use a name ending in _test or set ALLOW_NON_TEST_DATABASE=1 explicitly." >&2
  exit 1
fi

psql "${psql_args[@]}" -f "$repo_root/supabase/tests/bootstrap.sql"

for pass in 1 2; do
  echo "Applying migrations (idempotency pass $pass)..."
  for migration in "$repo_root"/supabase/migrations/*.sql; do
    echo "  $(basename "$migration")"
    psql "${psql_args[@]}" -f "$migration" >/dev/null
  done
done

echo 'Running constraint and function invariants...'
psql "${psql_args[@]}" -f "$repo_root/supabase/tests/claim.test.sql"

echo 'Running patient-import invariants...'
psql "${psql_args[@]}" -f "$repo_root/supabase/tests/import.test.sql"

echo 'Running RLS and role-privilege invariants...'
psql "${psql_args[@]}" -f "$repo_root/supabase/tests/rls.test.sql"

echo 'Running campaign and wave-engine invariants...'
psql "${psql_args[@]}" -f "$repo_root/supabase/tests/campaign.test.sql"

echo 'Running inbound and delivery-status invariants...'
psql "${psql_args[@]}" -f "$repo_root/supabase/tests/inbound.test.sql"

echo 'Running inbox and manual-reply invariants...'
psql "${psql_args[@]}" -f "$repo_root/supabase/tests/inbox.test.sql"

echo 'Running dashboard, settings, and kill-switch invariants...'
psql "${psql_args[@]}" -f "$repo_root/supabase/tests/settings.test.sql"

echo 'Running recall and review invariants...'
psql "${psql_args[@]}" -f "$repo_root/supabase/tests/recalls_reviews.test.sql"

echo 'Running Stripe deposit invariants...'
psql "${psql_args[@]}" -f "$repo_root/supabase/tests/stripe.test.sql"

echo 'Running reliability-score invariants...'
psql "${psql_args[@]}" -f "$repo_root/supabase/tests/reliability.test.sql"

echo 'Running real two-connection claim race...'
DATABASE_URL="$DATABASE_URL" \
  "$repo_root/supabase/tests/concurrent-claim.test.sh"

echo 'Checking the 20k-patient wave-selection plan...'
DATABASE_URL="$DATABASE_URL" \
  "$repo_root/supabase/tests/wave-selection-explain.test.sh"

echo 'Checking dashboard query performance at 500 campaigns...'
DATABASE_URL="$DATABASE_URL" \
  "$repo_root/supabase/tests/dashboard-performance.test.sh"

echo 'PASS: all database integration tests completed'
