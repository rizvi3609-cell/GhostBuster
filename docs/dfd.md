# dfd.md

## Notation

Gane-Sarson style, rendered in Mermaid.

- **External entity** — actor or third party outside the trust boundary (rectangle)
- **Process** — numbered transformation `P1`, `P1.2` (rounded)
- **Data store** — persistent state `D1` (cylinder)
- **Data flow** — labeled arrow describing the payload, not the mechanism
- **Trust boundary** — dashed subgraph; every crossing needs authentication

## Data stores

| ID | Store | Contents |
| --- | --- | --- |
| D1 | `patients` | Identity, phone, consent, opt-out, reliability |
| D2 | `broadcast_campaigns` | Slot state machine, wave plan, winner |
| D3 | `campaign_recipients` | Who was contacted in which wave |
| D4 | `sms_logs` | Every message in and out, delivery state |
| D5 | `unhandled_inbox` | Inbound messages needing a human |
| D6 | `audit_events` | Immutable action trail |
| D7 | `clinic_config`  • `slot_templates` | Tunables, quiet hours, kill switch |
| D8 | `scheduled_messages` | Pending recalls and review requests |

## External entities

| ID | Entity |
| --- | --- |
| E1 | Front desk staff |
| E2 | Patient (mobile phone) |
| E3 | Twilio |
| E4 | Stripe (V2) |
| E5 | Practice management system (Dentrix / Eaglesoft) — CSV export only, no API |

## Level 0 — context diagram

```mermaid
flowchart TB
  E1[E1 Front desk staff]
  E2[E2 Patient]
  E3[E3 Twilio]
  E4[E4 Stripe]
  E5[E5 Practice mgmt system]

  GB((Ghost-Buster System))

  E5 -->|CSV export file| E1
  E1 -->|credentials, campaign request, CSV rows, manual replies| GB
  GB -->|dashboard state, inbox, ROI metrics, alerts| E1
  GB -->|outbound SMS request| E3
  E3 -->|inbound message, delivery status| GB
  E3 <-->|SMS| E2
  GB -->|payment link request| E4
  E4 -->|payment event| GB
```

The practice management system never connects directly. A human exports a CSV and imports it — that is the deliberate V1 boundary.

## Level 1 — major processes

```mermaid
flowchart TB
  subgraph TB1[" Trust boundary: authenticated staff session "]
    P1([P1 Authenticate staff])
    P2([P2 Import and validate patients])
    P3([P3 Create campaign])
    P7([P7 Manage inbox])
    P8([P8 Report and configure])
  end

  subgraph TB2[" Trust boundary: signed server-to-server "]
    P4([P4 Send wave])
    P5([P5 Process inbound message])
    P6([P6 Reconcile delivery status])
    P9([P9 Run scheduled jobs])
  end

  E1[E1 Staff] --> P1
  E1 -->|mapped, validated rows| P2
  E1 -->|slot template + time| P3
  E1 -->|reply / assign / resolve| P7

  P2 --> D1[(D1 patients)]
  P2 --> D6[(D6 audit_events)]

  P3 --> D2[(D2 campaigns)]
  P3 -->|signed campaign-start| P4
  P3 --> D6

  P4 --> D7[(D7 config)]
  P4 --> D1
  P4 -->|insert before send| D3[(D3 recipients)]
  P4 -->|send request| E3[E3 Twilio]
  P4 --> D4[(D4 sms_logs)]
  P4 --> D2

  E3 -->|inbound message| P5
  E3 -->|status callback| P6
  P5 --> D4
  P5 --> D1
  P5 -->|atomic claim| D2
  P5 -->|non-command| D5[(D5 inbox)]
  P5 -->|confirmation or already-filled| E3
  P5 --> D6
  P6 --> D4

  P9 --> D8[(D8 scheduled)]
  P9 --> D1
  P9 -->|recall / review send| E3
  P9 -->|expire stale campaigns| D2

  D5 --> P7
  P7 -->|manual reply| E3
  P7 --> D6

  D2 --> P8
  D4 --> P8
  P8 --> D7
```

### Process ownership

| Process | Runs in | Trigger |
| --- | --- | --- |
| P1 Authenticate | Next.js middleware + Supabase Auth | Page request |
| P2 Import patients | Browser parse → Server Action | Staff upload |
| P3 Create campaign | Server Action | Staff click |
| P4 Send wave | n8n | Webhook from P3, or post-Wait resume |
| P5 Process inbound | n8n | Twilio webhook |
| P6 Reconcile status | n8n | Twilio callback |
| P7 Manage inbox | Server Action + Realtime | Staff action |
| P8 Report / configure | Server Component read | Page load |
| P9 Scheduled jobs | n8n Schedule trigger | Daily / delayed |

## Level 2 — P5 inbound message processing

The highest-risk process in the system. Every branch matters.

```mermaid
flowchart TB
  E3[E3 Twilio POST] --> V{P5.1 Valid Twilio signature?}
  V -->|no| REJ[Return 403, log, no writes]
  V -->|yes| IDEM{P5.2 message_sid already in D4?}
  IDEM -->|yes, retry| STOPX[Return 200, no side effects]
  IDEM -->|no| LOG[P5.3 Insert INBOUND row into D4]
  LOG --> NORM[P5.4 Normalize phone to E.164, uppercase body]
  NORM --> LOOKUP[P5.5 Resolve patient from D1]
  LOOKUP --> KW{P5.6 Classify keyword}

  KW -->|STOP family| OUT[P5.7 Set opted_out, consent REVOKED in D1]
  KW -->|START family, no active campaign| IN[P5.8 Clear opt-out in D1]
  KW -->|HELP| HELP[P5.9 Static help reply]
  KW -->|affirmative| FIND[P5.10 Find eligible OPEN/ESCALATING campaign in D2]
  KW -->|anything else| INBOX[P5.13 Insert into D5 as UNREAD]

  FIND -->|none found| NOSLOT[P5.11 Reply: no active offer]
  FIND -->|found| CLAIM[[P5.12 claim_slot atomic UPDATE on D2]]
  CLAIM -->|1 row returned| WIN[Confirm appointment, terminate waves, audit D6]
  CLAIM -->|0 rows returned| LOSE[Polite already-filled reply]

  OUT --> ACK[Return 200 to Twilio]
  IN --> ACK
  HELP --> ACK
  INBOX --> ACK
  WIN --> ACK
  LOSE --> ACK
  NOSLOT --> ACK
```

<aside>
🔒

P5.12 is the only place a slot winner is decided. No other process may write `status = 'FILLED'` except the manual-assign path, which uses the same conditional guard.

</aside>

## Level 2 — P4 wave engine

```mermaid
flowchart TB
  START[Trigger: campaign-start webhook or Wait resume] --> KILL{P4.1 automation_paused in D7?}
  KILL -->|yes| HALT[Abort, log, alert]
  KILL -->|no| STATE[P4.2 Re-read campaign row from D2]
  STATE --> CLAIMABLE{P4.3 status in OPEN or ESCALATING?}
  CLAIMABLE -->|no| DONE[Terminate branch silently]
  CLAIMABLE -->|yes| QH{P4.4 Within clinic-local quiet hours?}
  QH -->|no| DEFER[Defer to next allowed window]
  QH -->|yes| PLAN[P4.5 Read wave_plan, current_wave]
  PLAN --> EXHAUST{P4.6 Waves remaining?}
  EXHAUST -->|no| EXPIRE[Set EXPIRED in D2, audit D6]
  EXHAUST -->|yes| SELECT[P4.7 Select N eligible patients from D1 excluding D3]
  SELECT --> EMPTY{P4.8 Any candidates?}
  EMPTY -->|no| EXPIRE
  EMPTY -->|yes| INSERT[[P4.9 Insert recipients into D3 BEFORE sending]]
  INSERT --> SEND[P4.10 Twilio send per recipient]
  SEND --> LOGS[P4.11 Write QUEUED rows to D4]
  LOGS --> BUMP[P4.12 Set ESCALATING, current_wave += 1 in D2]
  BUMP --> WAIT[[P4.13 Wait delay_min]]
  WAIT --> STATE
```

<aside>
⚠️

The loop returns to **P4.2**, never to P4.5. Re-reading state after the Wait is what makes manual fills, cancellations, and kill-switch flips take effect mid-campaign.

</aside>

## Level 2 — P2 CSV import

```mermaid
flowchart LR
  E5[CSV from practice mgmt] --> DROP[P2.1 Drag-drop in browser]
  DROP --> PARSE[P2.2 Papa Parse in memory]
  PARSE --> MAP[P2.3 Explicit column mapping by staff]
  MAP --> VAL[P2.4 Normalize E.164, flag invalid, dedupe in file]
  VAL --> PREV[P2.5 Preview counts and per-row errors]
  PREV -->|staff confirms| ACT[P2.6 Server Action, batches of 500]
  ACT --> UP[[P2.7 Upsert on phone_number, preserve opt-out and consent]]
  UP --> D1[(D1 patients)]
  ACT --> IB[(import_batches)]
  ACT --> D6[(D6 audit_events)]
  UP --> RESULT[P2.8 Return inserted/updated/skipped/invalid to UI]
```

The raw file never leaves the browser as an upload, and an import can never resurrect a patient who has opted out.

## Trust boundary crossings

| # | Crossing | Auth mechanism | Failure action |
| --- | --- | --- | --- |
| 1 | Browser → Server Action | Supabase Auth session + active-staff role check | Redirect to login |
| 2 | Browser → Supabase Realtime | Anon key, RLS select-only on 3 tables | Subscription denied |
| 3 | Next.js → n8n | HMAC over raw body + timestamp, 5-min skew window | 401, no workflow run |
| 4 | Twilio → n8n inbound | Twilio signature validation | 403 before any write |
| 5 | Twilio → n8n status | Twilio signature validation | 403 |
| 6 | Stripe → n8n | Stripe signature validation | 400 |
| 7 | n8n → Postgres | Credentials Manager connection string | Connection refused |
| 8 | n8n → Twilio | Credentials Manager account SID + token | Send fails, alert |

## Data dictionary — key flows

| Flow | Fields | Sensitivity |
| --- | --- | --- |
| Validated CSV rows | name, phone E.164, last visit date, procedure | PII, PHI-adjacent |
| Campaign-start webhook | campaign id, HMAC signature, timestamp | Low |
| Outbound offer SMS | clinic name, time, procedure label, reply instruction | **Minimize** — no clinical detail |
| Inbound message | from phone, body, message SID | PII, possibly PHI (patients volunteer symptoms) |
| Status callback | message SID, status, error code | Low |
| Claim result | boolean, campaign id, appointment time | Low |
| Confirmation SMS | clinic name, confirmed time | Minimize |
| Dashboard read | aggregate counts, campaign rows, patient names | PII |

## PHI classification

<aside>
🩺

**Assume PHI exists in D1, D4, D5, and D6.** A phone number tied to a dental appointment is PHI under HIPAA. Inbound free-text is the worst case — patients will describe symptoms unprompted, and that text lands in `unhandled_inbox` and `sms_logs`.

</aside>

Controls that follow from this:

- Outbound bodies carry no diagnosis, procedure detail beyond a generic label, or provider notes.
- No patient identifier in any URL, including review links and payment links.
- `sms_logs.message_body` redacted after 90 days; only metadata survives.
- Application logs never include full phone numbers or message bodies. Log the last four digits and the message SID.
- Vercel offers no BAA on Hobby or Pro — keep PHI out of request logs, and keep this on the counsel checklist.

## Trust boundary risks to test

| Risk | Test |
| --- | --- |
| Forged inbound webhook | POST without a Twilio signature; expect 403 and zero DB writes |
| Replayed inbound message | POST the same `message_sid` twice; expect one claim, one log row |
| Race on one slot | Two simultaneous YES replies; expect one winner, one already-filled reply |
| Anon key escalation | Attempt insert/update with the anon key; expect denial on every table |
| Cron/webhook auth bypass | Call the n8n webhook without the shared secret; expect rejection |
| Quiet-hours bypass | Create a campaign at 02:00 clinic time; expect deferral, not a send |
| Opt-out resurrection | Re-import a CSV containing an opted-out patient; expect opt-out preserved |