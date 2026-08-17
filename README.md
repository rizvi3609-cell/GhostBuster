# Ghost-Buster

Single-tenant SMS waitlist operations for filling last-minute dental cancellations.

Read `agent.md`, `docs/architecture.md`, and `docs/database.md` before making changes. The operating rules in `agent.md` take precedence over implementation prompts.

## Current scope

Phases 0–8 are complete: the scaffold, database and RLS foundation, atomic claims, staff authentication, patient import, campaign and inbound automation, live two-way inbox, operational dashboard, audited settings, staff/template management, and the global kill switch are in place. Optional V2 recalls, reviews, deposits, and reliability scoring remain behind Phase 9.

## Local setup

1. Install Node.js 22 or newer and pnpm 10.15.
2. Run `pnpm install --frozen-lockfile`.
3. Copy `.env.example` to `.env.local` and replace every placeholder.
4. Run `pnpm dev`.

The application fails closed at startup when required environment variables are missing or malformed. Never commit a local environment file or real patient data.

The `pnpm.overrides` entries for `postcss` and `sharp` are deliberate security patches for transitive versions pinned by Next.js 15. Keep them until the Next.js dependency tree resolves to patched versions on its own.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit

# Requires a disposable PostgreSQL 15 database ending in _test:
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ghost_buster_test' pnpm test:db
```

`pnpm build` requires a valid local environment. After a production build, confirm that server secrets are absent from the client bundle:

```bash
! grep -R "SERVICE_ROLE\|N8N_SHARED_SECRET" .next/static
```
