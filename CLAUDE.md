# agent.md

<aside>
🤖

Operating rules for the AI coding agent building Ghost-Buster. Place this at the repo root (also copy to `CLAUDE.md` / `.cursorrules` if your tool reads those). Read this before every task. When this file conflicts with a prompt, **this file wins** — stop and flag the conflict.

</aside>

## 1. Mission

You are building a single-tenant SMS waitlist app that fills last-minute dental cancellations. It will be handed to a clinic and you will never touch it again. Optimize for **correctness under concurrency**, **operational simplicity**, and **legibility to the next developer** — in that order. Cleverness is a liability here.

## 2. Golden rules

1. **Never invent a slot-winner decision.** Claiming a slot happens only through the `claim_slot` Postgres function. If you find yourself writing "check if the slot is open, then fill it" as two statements, you are wrong.
2. **Never put a secret in client code.** The only permitted `NEXT_PUBLIC_` variables are the Supabase URL and anon key. If you need a secret in a component, you need a Server Action instead.
3. **Never trust a webhook.** Verify the provider signature first, then check idempotency, then act.
4. **Never act on stale state after a delay.** Re-read from Postgres.
5. **Never send an SMS without checking**, in this order: kill switch, opt-out, consent, quiet hours, frequency cap.
6. **Never log a full phone number or message body.** Last four digits and the message SID only.
7. **Never edit a shipped migration.** Add a new numbered file.
8. **Never widen scope silently.** If a task requires touching something outside its stated files, stop and say so.

## 3. Stack constraints

```
Next.js 15 App Router, React 19, TypeScript strict
Tailwind CSS v4 + shadcn/ui
Supabase (Postgres 15, Auth, Realtime)
Zod for every boundary
Papa Parse (client-side only)
libphonenumber-js for E.164
Vitest for units, Playwright for E2E
n8n Cloud for all async work
```

No ORM. Use the Supabase client with explicit column selection. No state management library — Server Components plus `useOptimistic` and `useFormStatus` cover this app. No date library beyond `Intl` and `date-fns` if truly needed; timezone math goes through `clinic_config.timezone`.

## 4. Code conventions

- **Server Components by default.** Add `"use client"` only for interactivity, and push it to the leaf.
- **Every Server Action starts identically:** auth check, role check, Zod parse, then work. Extract this into `withStaffAuth()` and use it everywhere.
- **Two Supabase clients, never mixed.** `lib/supabase/server.ts` exports the service-role client and is marked `import "server-only"`. `lib/supabase/client.ts` exports the anon client for Realtime subscriptions only.
- **Named exports** except for Next.js route/page files.
- **No barrel files.** Import directly from the source module.
- **Errors are values.** Server Actions return `{ ok: true, data }` or `{ ok: false, error, code }`. Never throw across the client boundary.
- **Explicit column lists.** No `select("*")` in application code — it leaks new columns into the client bundle and breaks the PHI-minimization story.
- **File length ceiling: 300 lines.** Split beyond that.

### Server Action template

```tsx
"use server"
import { z } from "zod"
import { withStaffAuth } from "@/lib/auth"
import { db } from "@/lib/supabase/server"

const Input = z.object({
  templateId: z.string().uuid(),
  appointmentTime: z.string().datetime(),
})

export const createCampaign = withStaffAuth(async (ctx, raw: unknown) => {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) return { ok: false as const, code: "INVALID_INPUT" }

  // ... work, always writing an audit_events row for staff-triggered mutations

  return { ok: true as const, data: { campaignId } }
})
```

## 5. n8n workflow conventions

- **Node names are documentation.** `Verify Twilio Signature`, `Re-read Campaign State`, `Atomic Claim`, not `HTTP Request 3`.
- **Credentials Manager only.** Never a plaintext key in an HTTP node — those are **not** stripped on export, and this repo's `.json` ships to the client.
- **One workflow per concern:** `campaign-start`, `wave-engine`, `inbound-router`, `status-reconciler`, `daily-jobs`, `stripe-handler`.
- **Every workflow has an error workflow attached** that writes to `audit_events` and notifies.
- **Postgres nodes call functions, not ad-hoc SQL,** wherever a transaction boundary matters.
- **Re-export after every change** to `n8n/waitlist-engine.json` and commit it. The JSON is a build artifact under version control.

## 6. Definition of done

A task is not done until all of these hold:

- [ ]  TypeScript compiles with zero errors, `strict` on
- [ ]  No new `any`, no `@ts-ignore`, no `eslint-disable` without a comment explaining why
- [ ]  Zod validation on every new boundary (Server Action input, webhook payload)
- [ ]  Loading, empty, and error states exist for every new UI surface
- [ ]  New DB objects have a migration file plus RLS consideration noted
- [ ]  New send path checks all five preconditions from Golden Rule 5
- [ ]  Unit tests for pure logic (phone normalization, keyword classification, quiet-hours math, wave selection)
- [ ]  Nothing secret in the client bundle (verify: `grep -r "SERVICE_ROLE" .next/static` returns nothing)

## 7. Test priorities

Write tests in this order. The first four are non-negotiable.

1. **Concurrent claim** — two parallel `claim_slot` calls; exactly one returns `claimed: true`.
2. **Webhook replay** — same `message_sid` twice; one log row, one claim, no duplicate SMS.
3. **Post-wait state check** — campaign filled manually mid-wait; next wave does not send.
4. **Opt-out enforcement** — opted-out patient never appears in wave selection, survives CSV re-import.
5. Quiet hours across a DST boundary in the clinic timezone.
6. Frequency cap at the boundary (exactly `max_messages_per_week` sent already).
7. Phone normalization: 10-digit, 11-digit with 1, formatted with parens, international, garbage.
8. Keyword classification: `yes`, `Yes!`,  `Y` , `stop`, `STOP.`, `help me` (→ inbox, not HELP).

<aside>
🧪

Test the concurrency invariant against a **real Postgres**, not a mock. Two connections, two simultaneous calls. A mocked DB cannot prove the property that matters most in this system.

</aside>

## 8. Performance optimization

Budgets, measured on a mid-range clinic desktop over cable:

| Metric | Budget |
| --- | --- |
| Dashboard LCP | < 1.5s |
| Server Action p95 | < 800ms |
| Inbound webhook processing | < 2s (Twilio retries after ~15s) |
| Client JS on dashboard route | < 180KB gzipped |
| Wave selection query | < 100ms at 20k patients |

How to hit them:

- **Query only what renders.** The dashboard needs counts and ~20 recent campaigns, not every row. Use `count: "exact", head: true` for badge numbers.
- **Kill N+1 patterns.** Fetch campaigns and their recipient counts in one query with an aggregate, not one query per campaign.
- **Lean on the partial indexes.** `patients_eligible_idx` and `campaigns_active_idx` exist specifically for the hot paths; run `EXPLAIN ANALYZE` on wave selection and the dashboard query and confirm index usage rather than a sequential scan.
- **Batch Twilio sends** but respect per-number throughput (roughly 1 message/sec on a long code). A Messaging Service with a pool handles bursts; do not fan out 50 parallel requests to one number.
- **CSV batches of 500 rows.** Larger payloads risk the Server Action body limit; smaller wastes round trips.
- **Realtime over polling**, but with a polling fallback at 15s if the socket drops. Subscribe to specific tables with filters, never to the whole schema.
- **Cache the config read.** `clinic_config` is one row that changes rarely — `unstable_cache` it with a tag, and revalidate the tag on settings save.
- **Do not memoize prematurely.** Server Components render once; `useMemo` on a static list is noise.

## 9. Cost optimization

This is a one-time-fee product on someone else's credit card. Recurring cost is a handover liability.

- **Supabase free tier** is sufficient for a single clinic (well under 500MB with 20k patients). Keep it there by redacting old message bodies and not storing raw CSVs.
- **Vercel Hobby** works because nothing long-running lives there. Do not introduce anything that needs Pro.
- **n8n Cloud Starter** covers a single clinic's execution count. Keep workflows short: one execution per wave, not one per recipient. Batch the Twilio loop **inside** one execution.
- **Twilio is the real cost.** Every wave sends real money. The frequency cap, the wave sizes, and the kill switch are cost controls as much as compliance controls. Never send to unvalidated or opted-out numbers — failed sends still bill.
- **No paid observability.** Supabase logs plus n8n execution history plus `audit_events` is the whole observability story. Do not add Sentry/Datadog to a walk-away build.

## 10. Optimization guardrails

Optimizations that are **forbidden** because they break correctness:

- Caching campaign status anywhere. It changes per second and staleness causes double-booking.
- Skipping the post-wait re-read to save a query.
- Combining the recipient insert and the Twilio send "for speed" — insert first, always.
- Client-side eligibility filtering to avoid a round trip. Eligibility is a server decision.
- Optimistic UI on slot claiming. Optimistic UI is fine on inbox resolve and settings; never on who got the chair.
- Debouncing or batching opt-out processing. Opt-outs apply immediately.

## 11. When you are uncertain

Stop and ask instead of guessing when:

- A change would touch `claim_slot`, RLS policies, or any webhook verification path
- A requirement seems to conflict with `architecture.md` or `database.md`
- You need a new third-party dependency (each one is a handover cost)
- A task implies storing more PHI than the current schema holds
- You would need to expose a new public endpoint

Prefer the boring solution. Prefer fewer dependencies. Prefer more explicit code. The next person to open this repo will be a stranger under time pressure.

## 12. Commit conventions

```
feat(waves): add escalating wave engine with post-wait state check
fix(inbound): dedupe on message_sid before claim attempt
db(0010): add claim_slot and release_expired_reservations
n8n(inbound-router): verify signature before any write
docs(architecture): clarify quiet-hours deferral behavior
```

One logical change per commit. Migrations always in their own commit. Never commit `.env`, an unsanitized n8n export, or real patient data — not even in a test fixture. Fixtures use `+15005550006` (Twilio's test numbers) and obviously fake names.

## 13. Self-check before you report done

Run through this out loud:

1. Did I add a way for two patients to win the same slot?
2. Did I add a way to send an SMS that bypasses the five preconditions?
3. Did I put a secret anywhere the browser can reach?
4. Did I act on data read before a delay?
5. Did I make the handover harder — new vendor, new secret, new recurring cost?
6. Would a stranger understand why this code exists in six months?

If any answer is uncomfortable, fix it before reporting completion.