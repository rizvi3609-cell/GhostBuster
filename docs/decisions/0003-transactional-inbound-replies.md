# Decision 0003: Transactional inbound replies

## Status

Accepted for Phase 6.

## Context

Inbound STOP, HELP, opt-in, and appointment-claim commands require immediate handling. Automated campaign offers must always enforce the kill switch, opt-out, consent, quiet hours, and frequency cap. Applying those marketing controls after receiving STOP would make a STOP confirmation impossible because consent has already been revoked.

## Decision

- Campaign offers continue to enforce all five send preconditions immediately before every Twilio request.
- Twilio remains responsible for the carrier-mandated STOP confirmation. Ghost-Buster mirrors opt-out and revoked consent immediately and does not send a duplicate STOP response.
- HELP, opt-in, winner, already-filled, and no-active-offer messages are transactional replies to a patient-initiated inbound message.
- Transactional replies are short, contain no clinical detail, use provider message IDs for idempotent logging, and are not used to start or continue campaign promotion.
- Every inbound request is signature-verified and replay-deduplicated before command processing.

## Consequences

A patient can always stop messages immediately without receiving an application-generated message after revocation. Claim and help responses remain timely and auditable without weakening eligibility checks on proactive campaigns.
