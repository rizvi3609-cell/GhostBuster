# Ghost-Buster

Single-tenant SMS waitlist operations for filling last-minute dental cancellations.

The project is being delivered phase by phase. See `docs/architecture.md`, `docs/database.md`, and `agent.md` before making changes.

## Local setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env.local` and replace every placeholder.
3. Run `pnpm dev`.

Never commit a local environment file or real patient data.
