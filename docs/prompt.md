# prompt.md

<aside>
💬

Phase-by-phase build prompts. Paste one phase at a time, in order, into your coding agent. Never paste two phases at once — each phase has acceptance criteria that must pass before the next one is safe to start.

</aside>

## How to use this file

**Session preamble.** Start every new agent session with this, then paste the phase prompt:

> Read `agent.md`, `architecture.md`, and `database.md` in full before writing any code. `agent.md` overrides any instruction I give you — if my request conflicts with it, stop and tell me. Confirm you have read all three by listing the eight golden rules, then wait for my task.
> 

**Rules of engagement.**

- One phase per session where possible. Long contexts drift, and drift in this codebase means double-booked patients.
- After each phase, run its acceptance criteria yourself. Do not take "done" on faith.
- If the agent proposes a new dependency, a new `NEXT_PUBLIC_` variable, or a change to `claim_slot`, stop and review manually.
- Commit after every phase. You need to be able to roll back one phase, not one week.

---

## Phase 0 — Scaffold

> Initialize a Next.js 15 project with the App Router, TypeScript in strict mode, Tailwind CSS v4, and shadcn/ui. Add Zod, `@supabase/supabase-js`, `@supabase/ssr`, `libphonenumber-js`, `papaparse`, and Vitest.
> 

> 
> 

> Create the exact folder structure from section 10 of `architecture.md`. Create `lib/supabase/server.ts` exporting a service-role client marked with `import "server-only"`, and `lib/supabase/client.ts` exporting an anon client for Realtime only. Create `lib/env.ts` that validates every environment variable from section 7 of `architecture.md` with Zod at startup and throws a clear error listing any that are missing.
> 

> 
> 

> Create `.env.example` with every variable name and a comment explaining each. Do not create `.env`.
> 

> 
> 

> Do not build any UI or database logic yet.
> 

**Acceptance:** `pnpm build` succeeds. Missing env vars produce a readable error. `grep -r "SERVICE_ROLE" .next/static` returns nothing.

---

## Phase 1 — Database

> Implement every migration from `database.md`, files `0001` through `0013`, exactly as specified. Do not improvise column names, types, or constraints — they are referenced by other documents.
> 

> 
> 

> Then write `supabase/tests/claim.test.sql` (or a Vitest integration test against a local Supabase) that proves:
> 

> 1. Two concurrent `claim_slot` calls on the same campaign — exactly one returns `claimed = true`.
> 

> 2. Inserting a phone number not in E.164 format fails.
> 

> 3. Setting a campaign to `FILLED` with a null `claimed_by` fails.
> 

> 4. Inserting a duplicate `(campaign_id, patient_id)` into `campaign_recipients` fails.
> 

> 5. The anon role can neither read nor write any table.
> 

> 
> 

> Use two real database connections for test 1. A mock cannot prove this property.
> 

**Acceptance:** All five tests pass against a real Postgres. `EXPLAIN ANALYZE` on the wave selection query from `database.md` shows an index scan, not a sequential scan.

---

## Phase 2 — Pure logic library

> Implement these pure, dependency-light modules with exhaustive unit tests. No database, no network, no React.
> 

> 
> 

> `lib/phone.ts` — `normalizeToE164(input, defaultCountry)` returning `{ ok: true, phone } | { ok: false, reason }`. Handle 10-digit US, 11-digit with leading 1, parens/dashes/spaces, `+` international, extensions (reject), and garbage.
> 

> 
> 

> `lib/keywords.ts` — `classifyInbound(body)` returning one of `AFFIRMATIVE | OPT_OUT | OPT_IN | HELP | OTHER`. Affirmative: `YES`, `Y`, `YEP`, `YEAH`, `CLAIM`, `1`. Opt-out: `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`. Opt-in: `START`, `UNSTOP`. Help: `HELP`, `INFO`. Trim, uppercase, strip trailing punctuation. Critically, `"help me please"` must classify as `OTHER`, not `HELP` — only a bare keyword counts.
> 

> 
> 

> `lib/quiet-hours.ts` — `isWithinSendingWindow(nowUtc, timezone, startTime, endTime)` and `nextAllowedSendTime(...)`. Must be correct across DST transitions. Use `Intl.DateTimeFormat` with the IANA timezone; do not do manual offset arithmetic.
> 

> 
> 

> `lib/wave-plan.ts` — parse and validate the `wave_plan` JSON shape, and `nextWave(plan, currentWave)` returning the next size and delay or null when exhausted.
> 

**Acceptance:** 100% branch coverage on these four modules. A DST-boundary quiet-hours test passes for `America/New_York` in both March and November.

---

## Phase 3 — Auth and shell

> Implement Supabase Auth email/password login, a `middleware.ts` that protects every route except `/login`, and `withStaffAuth()` in `lib/auth.ts` that resolves the session, confirms an active row in `staff`, and passes a typed context to the wrapped Server Action. Unauthenticated Server Action calls must fail closed with `{ ok: false, code: "UNAUTHORIZED" }`.
> 

> 
> 

> Build the app shell per `frontend-design.md`: sidebar navigation (Dashboard, Inbox with unread badge, Patients, Settings), the clinic name in the header, and a user menu with sign-out. Include the loading skeleton and error boundary patterns from that document.
> 

> 
> 

> No feature logic yet — stub pages with empty states.
> 

**Acceptance:** Direct navigation to `/dashboard` while logged out redirects to login. A Server Action invoked without a session returns `UNAUTHORIZED` without touching the database.

---

## Phase 4 — Patients and CSV import

> Build the patients list with server-side search (use the trigram index), pagination at 50 rows, and columns for name, phone, consent status, opt-out, reliability score, and last visit.
> 

> 
> 

> Build the CSV import flow exactly as specified in section 5.1 of `architecture.md` and the P2 diagram in `dfd.md`:
> 

> 1. Drag-and-drop that parses with Papa Parse **in browser memory**. The raw file must never be uploaded.
> 

> 2. A required column-mapping step — the staff member maps their columns to name, phone, last visit date, and procedure. Never auto-import without confirmation.
> 

> 3. Client-side validation producing a preview: normalized phone, invalid rows with per-row reasons, in-file duplicates flagged.
> 

> 4. A Server Action that upserts validated rows in batches of 500 on `phone_number` conflict, and **must preserve existing `opted_out` and `consent_status`** — an import can never resurrect an opted-out patient.
> 

> 5. One `import_batches` row and one `audit_events` row per import.
> 

> 6. A result summary: inserted, updated, skipped, invalid.
> 

**Acceptance:** Import a CSV containing an already-opted-out patient; verify the opt-out survives. Import a 5,000-row file; verify batching and a correct summary. Confirm via network inspection that no file body is uploaded.

---

## Phase 5 — Campaigns and the n8n wave engine

> **Next.js side:** build the "Fill a chair" flow. Slot template picker from `slot_templates`, appointment time input, an optional wave-plan override, and a confirm step showing how many eligible patients would receive wave 1. The Server Action inserts the campaign as `DRAFT`, resolves the timezone server-side from `clinic_config`, checks quiet hours (staying `DRAFT` with an explanation if outside the window), writes an audit row, then calls n8n's `campaign-start` webhook via `lib/n8n/client.ts`, which HMAC-signs the raw body with `N8N_SHARED_SECRET` plus a timestamp header.
> 

> 
> 

> Build the campaign detail page: state, wave timeline with per-recipient send status, a live countdown to the next wave, the winner if filled, and prominent Pause and Cancel controls.
> 

> 
> 

> **n8n side:** produce `n8n/waitlist-engine.json` containing the `campaign-start` and `wave-engine` workflows implementing the P4 diagram in `dfd.md` precisely, in this node order:
> 

> 1. Verify the shared-secret signature; reject otherwise.
> 

> 2. Check `clinic_config.automation_paused`; abort if true.
> 

> 3. Re-read the campaign row from Postgres.
> 

> 4. Abort silently unless status is `OPEN` or `ESCALATING`.
> 

> 5. Check quiet hours; defer if outside.
> 

> 6. Select the next wave's eligible patients using the exact query from `database.md`.
> 

> 7. Insert `campaign_recipients` rows **before** any Twilio call.
> 

> 8. Send via the Twilio Messaging Service; write `sms_logs` rows.
> 

> 9. Set `ESCALATING` and increment `current_wave`.
> 

> 10. Wait `delay_min`, then **loop back to step 3**, not step 6.
> 

> 
> 

> Name every node descriptively. Use the Credentials Manager for all keys — never a plaintext key in an HTTP node.
> 

**Acceptance:** Create a campaign, then mark it filled manually during the 7-minute wait; the next wave must not send. Trigger `campaign-start` without the signature; it must be rejected. Verify no patient receives two messages for one campaign.

---

## Phase 6 — Inbound router and the claim flow

> Build the `inbound-router` n8n workflow implementing the P5 diagram in `dfd.md` exactly, in this order: verify the Twilio signature → attempt the `sms_logs` insert keyed on `message_sid` and short-circuit on conflict (a retry) → normalize phone and body → resolve the patient → classify the keyword → branch.
> 

> 
> 

> For `AFFIRMATIVE`: find the patient's most recent campaign in `OPEN` or `ESCALATING` where they are a recipient, then call the `claim_slot` function. If it returns `claimed = true`, send the confirmation SMS. If `false`, send the polite already-filled reply. Nothing else.
> 

> 
> 

> For `OPT_OUT`: set `opted_out = true` and `consent_status = 'REVOKED'` immediately, audit it, send confirmation. For `OPT_IN`: clear the opt-out only if the patient has no active campaign. For `HELP`: static reply. For `OTHER`: insert into `unhandled_inbox` as `UNREAD`.
> 

> 
> 

> Build the `status-reconciler` workflow: verify signature, upsert `sms_logs` by `message_sid`, and never regress a terminal status.
> 

> 
> 

> Write all SMS copy to contain no clinical detail and no patient identifier in any URL. Include the required opt-out language on the first message to each patient.
> 

**Acceptance:** Two simultaneous YES replies produce exactly one winner and one already-filled reply. The same `message_sid` posted twice produces one log row and one claim. An unsigned request returns 403 with zero database writes. `STOP` removes the patient from the next wave's selection immediately.

---

## Phase 7 — Unhandled inbox

> Build the two-way inbox. A conversation list sorted by most recent with unread emphasis, per-patient message thread from `sms_logs`, and actions to reply, assign to a staff member, and resolve.
> 

> 
> 

> Subscribe with Supabase Realtime on `unhandled_inbox` using the anon client, with a 15-second polling fallback if the socket drops. Show the unread count as a sidebar badge that updates live.
> 

> 
> 

> Manual replies go through a Server Action → n8n → Twilio, and write both an `sms_logs` row and an `audit_events` row. Optimistic UI is acceptable for assign and resolve; never for sending.
> 

**Acceptance:** Send an inbound non-command message from a real phone; it appears in the inbox within two seconds without a refresh. Kill the socket; the fallback poll still surfaces new messages. A reply arrives on the patient's phone and appears in the thread.

---

## Phase 8 — Dashboard, settings, kill switch

> Build the operational dashboard per `frontend-design.md`: active campaigns grouped by state, delivered/failed/undelivered counts, the unhandled badge, median time-to-fill, and estimated recovered revenue (chairs filled × `estimated_chair_value`, labeled as an estimate). Every active campaign needs a visible pause/cancel control. Surface a warning when a campaign has been `OPEN` past its expected wave time — that indicates an n8n problem.
> 

> 
> 

> Use aggregate queries with `count: "exact", head: true` for badges. No N+1 per campaign.
> 

> 
> 

> Build settings: clinic name, timezone, quiet hours, weekly message cap, chair value, recall threshold and cooldown, wave-plan editor, slot template CRUD, staff management, feature flags, and the **kill switch**. The kill switch must be visually distinct, require a confirmation step, and write an audit row. Cache the config read with `unstable_cache` and revalidate the tag on save.
> 

**Acceptance:** Flip the kill switch, then trigger a wave; nothing sends and the abort is logged. Dashboard LCP under 1.5s with 500 campaigns and 20k patients. Every settings change appears in `audit_events`.

---

## Phase 9 — V2 features, behind flags

> Implement each of these behind its feature flag, defaulting to off, in separate commits.
> 

> 
> 

> **Recalls** (`FEATURE_RECALLS`): daily n8n Schedule trigger querying patients whose `last_visit_date` falls in a **range** from `recall_threshold_days` to `recall_threshold_days + 14`, excluding anyone with a recall inside `recall_cooldown_days`. Range-based, never exact-day equality — a single failed run must not permanently skip a cohort.
> 

> 
> 

> **Review requests** (`FEATURE_REVIEWS`): staff marks an appointment complete; schedule a request in `scheduled_messages` after `review_delay_hours`; enforce a per-patient cooldown; no patient identifier in the review URL.
> 

> 
> 

> **Stripe deposits** (`FEATURE_STRIPE_DEPOSITS`): claim transitions to `PENDING_PAYMENT` with a 10-minute `claim_expires_at` instead of `FILLED`; send a unique Payment Link; verify the signed Stripe webhook; promote to `FILLED` only on payment success; the daily job runs `release_expired_reservations()` and escalation resumes from the current wave.
> 

> 
> 

> **Reliability scoring**: make the factors explicit and clinic-visible — successful prior claims, time since last visit, procedure match, recent contact frequency. Show the score's components on the patient detail page so staff can understand and override it. No opaque scoring.
> 

**Acceptance:** Each flag off produces byte-identical behavior to Phase 8. A Stripe payment that expires releases the slot and resumes waves. A recall job that fails one day still catches its cohort the next day.

---

## Reusable prompts

### Bug fix

> Here is the failure: [paste error, logs, and reproduction steps].
> 

> 
> 

> Before changing code: state your hypothesis for the root cause, name the file and line you believe is responsible, and tell me which of the eight golden rules in `agent.md` is relevant. Then write a failing test that reproduces the bug. Only then fix it. Do not fix anything else in the same change.
> 

### Refactor

> Refactor [target] for clarity only. Behavior must be identical. Do not change any database object, webhook signature verification, or the claim path. List every file you will touch before starting, and stop if the list grows.
> 

### Review

> Review the diff on this branch against `agent.md` sections 2, 6, and 10. For each finding, cite the specific rule violated and the file and line. Then answer the six self-check questions from section 13 explicitly. Do not fix anything; report only.
> 

### Test generation

> Write tests for [module] covering happy path, every error branch, and the boundary conditions. For anything touching campaign state, use a real Postgres connection, not a mock. Name each test after the behavior it protects, not the function it calls.
> 

### Handover audit

> Audit this repo for handover readiness. Report: every environment variable that must be set, every third-party account required, every place a secret could leak into the client bundle, every plaintext credential in `n8n/waitlist-engine.json`, and every recurring cost the clinic will incur. Then list what is missing from the recovery runbook.
> 

---

## Veo 3 prompts for the marketing site

Generate 3–4 variants of each; output quality varies run to run. Design for an 8-second loop, no on-screen text, no faces, slow camera movement.

**1. The cost of the empty chair**

> Slow cinematic dolly across an empty, immaculate dental operatory in late afternoon. Warm low sun through venetian blinds, dust motes suspended in the light, a single overhead procedure lamp glowing. Shallow depth of field, anamorphic, film grain. Still, quiet, expensive. No people, no text.
> 

**2. The moment it works**

> Extreme close-up, shallow focus, of a smartphone face-up on a waiting-room side table. The screen illuminates with an incoming message notification, casting soft blue light. A thumb enters the frame slowly and taps once. Macro lens, cinematic, no readable text on screen, no faces.
> 

**3. Relief at the front desk**

> Over-the-shoulder shot, subject out of focus in the foreground, of a reception desk in a bright modern dental clinic. A hand taps a keyboard once, then the person sits back. Soft natural window light, warm palette, calm and competent. No readable screens, no faces in focus, no text.
> 

Encode settings and the `<video>` component are in `frontend-design.md`.