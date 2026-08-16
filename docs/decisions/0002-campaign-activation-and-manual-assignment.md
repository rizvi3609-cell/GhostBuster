# Decision 0002: Campaign activation and manual assignment

## Status

Accepted for Phase 5.

## Context

Campaign Server Actions must create `DRAFT` rows, while the wave engine may send only `OPEN` or `ESCALATING` campaigns. The Phase 5 acceptance test also requires staff to fill an active slot manually during an n8n wait. The general claim rule reserves patient SMS wins for `claim_slot`, but a manual fill must not fabricate an inbound message or alter reliability scoring.

## Decision

- `campaign-start` verifies HMAC and quiet hours first, then calls `activate_campaign()`, which performs one conditional `DRAFT → OPEN` update.
- Patient SMS replies continue to use only `claim_slot()`.
- Staff manual fills use `assign_slot_manually()`, a separate service-role-only function with one conditional `OPEN/ESCALATING → FILLED` update.
- Manual assignment emits `SLOT_ASSIGNED_MANUALLY` and does not modify recipient response text or reliability score.
- Every post-wait branch re-reads campaign status, so a manual fill terminates all later sends.

## Consequences

The system preserves an honest audit trail while retaining the same single-update race protection for both patient and staff assignment paths. A losing manual assignment returns false rather than overwriting an existing winner.
