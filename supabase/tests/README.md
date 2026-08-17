# Phase 1 database tests

These tests run against a real PostgreSQL server. They do not use mocks or an in-memory database.

## Safety

The runner truncates application tables. Use only a disposable database whose name ends in `_test`. The runner refuses other database names unless `ALLOW_NON_TEST_DATABASE=1` is explicitly set.

`bootstrap.sql` provides the Supabase-managed `auth.users` table, `auth.uid()` function, and API roles when testing against plain PostgreSQL. Do not run that bootstrap file against production.

## Run

```bash
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ghost_buster_test'
pnpm test:db
```

PostgreSQL 15 and `psql` must be installed. The database user must be able to create extensions and roles for the local Supabase compatibility bootstrap.

The runner:

1. Applies every migration twice to verify idempotency.
2. Verifies E.164, claimed-state, and recipient-deduplication constraints.
3. Verifies opt-out preservation, replay-safe chunks, one audit event, and a 5,000-row CSV import in ten 500-row batches.
4. Verifies triggers and expired payment-reservation release.
5. Verifies RLS on every table and deny-by-default browser privileges.
6. Verifies DRAFT activation, recipient reservation before send, replay blocking, pause/cancel, manual fill, and the post-wait state recheck.
7. Verifies inbound replay dedupe, immediate STOP enforcement, conditional opt-in, inbox idempotency, and non-regressing delivery status.
8. Verifies conversation-level assign/resolve, replay-safe manual replies, five precondition ordering, one SMS log, and one audit event.
9. Starts two independent `psql` connections against one campaign at the same timestamp and requires exactly one `claim_slot` winner.
10. Loads 20,000 eligible patients and requires `EXPLAIN ANALYZE` to use the hot-path indexes.
