# n8n Phase 5 workflows

`waitlist-engine.json` is a bulk export containing:

1. `Ghost-Buster — Campaign Start`
2. `Ghost-Buster — Wave Engine`
3. `Ghost-Buster — Error Handler`
4. `Ghost-Buster — Inbound Router`
5. `Ghost-Buster — Status Reconciler`

All workflows import inactive. Configure and test them before activation.

## Required credentials and variables

Map the placeholder credential IDs after import:

- `Ghost-Buster Postgres`: dedicated Supabase Postgres/service credential.
- `Twilio API`: HTTP Basic Auth with the Twilio Account SID as username and Auth Token as password.

Configure these n8n Variables:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_MESSAGING_SERVICE_SID`
- `TWILIO_INBOUND_WEBHOOK_URL` — exact public URL configured in Twilio
- `TWILIO_STATUS_WEBHOOK_URL` — exact public status-callback URL
- `OPERATIONS_ALERT_WEBHOOK_URL`

Configure `GHOSTBUSTER_SHARED_SECRET` and `TWILIO_AUTH_TOKEN` through n8n External Secrets or the managed instance environment. They are read only by signature-verification Code nodes and are never stored in the export.

## Activation order

1. Map credentials and variables.
2. Set the Wave Engine workflow reference in `Run Wave Engine` if n8n assigned a different workflow ID.
3. Attach and activate the Error Handler.
4. Test unsigned and correctly signed campaign-start requests.
5. Test forged and correctly signed Twilio inbound and status callbacks.
6. Activate Status Reconciler and Inbound Router.
7. Activate Wave Engine.
8. Activate Campaign Start last.

## Safety behavior

- Campaign Start verifies HMAC and five-minute timestamp skew before any database write.
- A DRAFT campaign activates with one conditional database update only after quiet-hours deferral.
- Every wait loops back through `Re-read Campaign State`.
- `reserve_next_campaign_wave()` inserts recipient ledger rows before Twilio calls and blocks duplicate reservation with an infinity sentinel until completion.
- Each recipient is rechecked immediately before sending: kill switch, opt-out, consent, quiet hours, and frequency cap.
- Workflow errors leave the wave reserved rather than risking duplicate SMS and write an automation audit event.
- Inbound and status webhooks verify Twilio's HMAC-SHA1 signature before any database write.
- Inbound `MessageSid` is inserted first as the replay key; conflicts return 200 with no side effects.
- Twilio handles the carrier-mandated STOP confirmation. The app immediately mirrors opt-out state and does not send an additional STOP reply.
- HELP, opt-in, winner, loser, and no-offer replies are transactional, idempotently logged, and contain no clinical detail.
- Delivery callbacks advance message state without regressing terminal statuses.
- Workflow logs must never be configured to retain full phone numbers or message bodies beyond n8n's minimum execution data required for recovery.
