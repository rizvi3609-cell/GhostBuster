# Decision 0004: Conditional deposit claims and transparent reliability

## Status

Accepted for Phase 9.

## Deposit claim path

`claim_slot()` remains the only patient winner function and still performs one conditional campaign update. When both deployment and clinic Stripe flags are enabled and the campaign requires a deposit, the winning transition is `OPEN/ESCALATING → PENDING_PAYMENT` with a ten-minute expiry. Otherwise the function preserves the Phase 8 `→ FILLED` behavior.

Each reservation gets a dedicated Stripe Product, Price, and Payment Link. Stripe metadata contains campaign and reservation IDs only—never a patient identifier. The link is deactivated after payment, failure, or expiry. Signed Stripe events are replay-deduplicated before state changes.

## Reliability model

The visible 100-point model is:

- Prior successful claims: 40 points maximum, 10 per filled appointment.
- Time since last visit: 30 points maximum, five per 30 days.
- Procedure fit: 20 points.
- Recent-contact restraint: 10 points maximum, minus two per outbound message in seven days.

A daily job refreshes non-overridden scores. Staff may override a score only with a reason; saving or clearing an override writes an audit event. Campaign procedure eligibility remains a separate hard filter.

## Feature flags

Recalls, reviews, and Stripe deposits require both the deployment environment flag and clinic database flag. Database flags default off, so applying the migrations does not enable V2 behavior.
