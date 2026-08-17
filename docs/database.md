# database.md

## Conventions

- Postgres 15 via Supabase. `uuid` primary keys, `gen_random_uuid()` default.
- All timestamps `timestamptz`, stored UTC. Clinic-local rendering happens at the edges using `clinic_config.timezone`.
- Phone numbers stored **only** in E.164 (`+15551234567`), enforced by a check constraint.
- Enums as native Postgres types so bad states are impossible to insert.
- RLS enabled on every table, deny-by-default. All writes go through the service role in Server Actions or n8n.
- Every mutation that a human triggered writes an `audit_events` row.

## Extensions and enums

```sql
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create type consent_status  as enum ('UNKNOWN','GRANTED','REVOKED');
create type campaign_status as enum ('DRAFT','OPEN','ESCALATING','PENDING_PAYMENT','FILLED','EXPIRED','CANCELLED');
create type send_status     as enum ('PENDING','SENT','FAILED','SKIPPED');
create type sms_status      as enum ('QUEUED','SENT','DELIVERED','UNDELIVERED','FAILED','RECEIVED');
create type sms_direction   as enum ('OUTBOUND','INBOUND');
create type inbox_status    as enum ('UNREAD','OPEN','RESOLVED');
create type staff_role      as enum ('OWNER','ADMIN','FRONT_DESK');
```

## Tables

### `clinic_config` — single row

One row, enforced. Holds everything a clinic can tune without a redeploy.

```sql
create table clinic_config (
  id                    boolean primary key default true,
  clinic_name           text not null,
  timezone              text not null default 'America/New_York',
  quiet_hours_start     time not null default '08:00',
  quiet_hours_end       time not null default '20:00',
  max_messages_per_week int  not null default 3,
  estimated_chair_value numeric(10,2) not null default 350.00,
  recall_threshold_days int  not null default 180,
  recall_cooldown_days  int  not null default 30,
  review_delay_hours    int  not null default 4,
  default_wave_plan     jsonb not null default
    '[{"size":3,"delay_min":7},{"size":5,"delay_min":7},{"size":10,"delay_min":10}]',
  automation_paused     boolean not null default false,  -- kill switch
  updated_at            timestamptz not null default now(),
  constraint single_row check (id)
);
```

<aside>
🛑

`automation_paused` is the kill switch. Every outbound send path — waves, recalls, reviews — must check it as its first condition.

</aside>

### `staff`

```sql
create table staff (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  full_name  text,
  role       staff_role not null default 'FRONT_DESK',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
```

### `patients`

```sql
create table patients (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null,
  phone_number        text not null unique,
  opted_out           boolean not null default false,
  consent_status      consent_status not null default 'UNKNOWN',
  consent_recorded_at timestamptz,
  reliability_score   int not null default 50,
  last_visit_date     date,
  preferred_procedures text[] not null default '{}',
  last_messaged_at    timestamptz,
  last_recall_sent_at timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint phone_e164 check (phone_number ~ '^\+[1-9]\d{7,14}$'),
  constraint score_range check (reliability_score between 0 and 100)
);

create index patients_eligible_idx
  on patients (reliability_score desc, last_visit_date asc)
  where opted_out = false and consent_status = 'GRANTED';

create index patients_recall_idx on patients (last_visit_date)
  where opted_out = false;

create index patients_name_trgm on patients using gin (full_name gin_trgm_ops);
```

The partial index on eligible patients is the one that matters — wave selection runs against it on every send.

### `slot_templates`

```sql
create table slot_templates (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,          -- 'Hygiene — 60 min'
  procedure_type text not null,          -- 'HYGIENE'
  duration_min   int not null,
  wave_plan      jsonb,                  -- null = inherit clinic default
  requires_deposit boolean not null default false,
  sort_order     int not null default 0,
  active         boolean not null default true
);
```

### `broadcast_campaigns`

```sql
create table broadcast_campaigns (
  id               uuid primary key default gen_random_uuid(),
  appointment_time timestamptz not null,
  clinic_timezone  text not null,
  procedure_type   text not null,
  duration_min     int  not null,
  status           campaign_status not null default 'DRAFT',
  wave_plan        jsonb not null,
  current_wave     int  not null default 0,
  claimed_by       uuid references patients(id),
  claimed_at       timestamptz,
  claim_expires_at timestamptz,
  expires_at       timestamptz not null,
  cancelled_reason text,
  created_by       uuid references staff(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint claimed_consistency check (
    (status in ('FILLED','PENDING_PAYMENT') and claimed_by is not null)
    or (status not in ('FILLED','PENDING_PAYMENT') and claimed_by is null)
  )
);

create index campaigns_active_idx on broadcast_campaigns (appointment_time)
  where status in ('OPEN','ESCALATING','PENDING_PAYMENT');

create index campaigns_dashboard_idx on broadcast_campaigns (created_at desc);
```

The `claimed_consistency` constraint makes "filled with nobody in the chair" unrepresentable.

### `campaign_recipients`

The deduplication ledger. Inserted **before** the Twilio call.

```sql
create table campaign_recipients (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references broadcast_campaigns(id) on delete cascade,
  patient_id   uuid not null references patients(id) on delete cascade,
  wave_number  int  not null,
  send_order   int  not null,
  send_status  send_status not null default 'PENDING',
  sent_at      timestamptz,
  responded_at timestamptz,
  response_body text,
  unique (campaign_id, patient_id)
);

create index recipients_campaign_idx on campaign_recipients (campaign_id, wave_number);
```

The `unique (campaign_id, patient_id)` constraint is what makes wave escalation safe: a retried or duplicated wave simply conflicts instead of double-texting.

### `sms_logs`

```sql
create table sms_logs (
  id           uuid primary key default gen_random_uuid(),
  message_sid  text unique,             -- Twilio SID; the idempotency key
  patient_id   uuid references patients(id) on delete set null,
  campaign_id  uuid references broadcast_campaigns(id) on delete set null,
  direction    sms_direction not null,
  status       sms_status not null,
  message_body text,                    -- redacted per retention policy
  error_code   text,
  segments     int,
  price_usd    numeric(8,4),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index sms_logs_patient_idx  on sms_logs (patient_id, created_at desc);
create index sms_logs_campaign_idx on sms_logs (campaign_id);
create index sms_logs_failed_idx   on sms_logs (created_at desc)
  where status in ('FAILED','UNDELIVERED');
```

### `unhandled_inbox`

```sql
create table unhandled_inbox (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid references patients(id) on delete set null,
  campaign_id  uuid references broadcast_campaigns(id) on delete set null,
  message_sid  text unique,
  message_body text not null,
  status       inbox_status not null default 'UNREAD',
  assigned_to  uuid references staff(id),
  received_at  timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references staff(id)
);

create index inbox_open_idx on unhandled_inbox (received_at desc)
  where status in ('UNREAD','OPEN');
```

### `scheduled_messages` — recalls and reviews (V2)

```sql
create table scheduled_messages (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients(id) on delete cascade,
  kind        text not null check (kind in ('RECALL','REVIEW_REQUEST')),
  run_after   timestamptz not null,
  status      text not null default 'PENDING'
                check (status in ('PENDING','SENT','FAILED','CANCELLED')),
  attempts    int not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create unique index scheduled_dedupe_idx
  on scheduled_messages (patient_id, kind)
  where status = 'PENDING';
```

### `import_batches`

```sql
create table import_batches (
  id            uuid primary key default gen_random_uuid(),
  imported_by   uuid references staff(id),
  filename      text,
  row_count     int not null,
  inserted_count int not null,
  updated_count int not null,
  skipped_count int not null,
  invalid_count int not null,
  column_mapping jsonb,
  created_at    timestamptz not null default now()
);
```

### `import_batch_chunks` — idempotent CSV batch ledger

Added in migration `0014_patient_import_batches.sql`. Browser parsing sends only validated rows in batches of at most 500. Each `(import_batch_id, batch_number)` is recorded once, so retrying a network request returns the original counts without double-counting or re-importing the chunk.

```sql
create table import_batch_chunks (
  import_batch_id uuid not null references import_batches(id) on delete cascade,
  batch_number int not null,
  row_count int not null check (row_count between 1 and 500),
  inserted_count int not null,
  updated_count int not null,
  skipped_count int not null,
  created_at timestamptz not null default now(),
  primary key (import_batch_id, batch_number)
);
```

`import_patient_batch()` locks the parent import, upserts only name, phone, visit date, and procedures, and therefore cannot overwrite `opted_out` or `consent_status`. `finalize_patient_import()` verifies the totals and emits exactly one `CSV_IMPORTED` audit event.

### `audit_events`

```sql
create table audit_events (
  id         uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('STAFF','AUTOMATION','PATIENT')),
  actor_id   uuid,
  event_type text not null,
  entity_type text,
  entity_id  uuid,
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index audit_entity_idx on audit_events (entity_type, entity_id, created_at desc);
create index audit_recent_idx on audit_events (created_at desc);
```

Event types to emit: `CAMPAIGN_CREATED`, `CAMPAIGN_CANCELLED`, `CAMPAIGN_PAUSED`, `SLOT_CLAIMED`, `SLOT_ASSIGNED_MANUALLY`, `WAVE_SENT`, `MANUAL_REPLY_SENT`, `OPT_OUT`, `OPT_IN`, `CSV_IMPORTED`, `CONFIG_CHANGED`, `KILL_SWITCH_TOGGLED`.

## The atomic claim function

This is the most important object in the database. Everything else is bookkeeping.

```sql
create or replace function claim_slot(
  p_campaign_id uuid,
  p_patient_id  uuid,
  p_message_sid text
) returns table (claimed boolean, campaign_id uuid, appointment_time timestamptz)
language plpgsql
security definer
as $$
declare
  v_row broadcast_campaigns;
begin
  update broadcast_campaigns c
     set status     = 'FILLED',
         claimed_by = p_patient_id,
         claimed_at = now(),
         updated_at = now()
   where c.id = p_campaign_id
     and c.status in ('OPEN','ESCALATING')
  returning c.* into v_row;

  if not found then
    return query select false, p_campaign_id, null::timestamptz;
    return;
  end if;

  update campaign_recipients
     set responded_at = now(), response_body = 'YES'
   where campaign_recipients.campaign_id = p_campaign_id
     and campaign_recipients.patient_id  = p_patient_id;

  update patients
     set reliability_score = least(100, reliability_score + 5),
         updated_at = now()
   where id = p_patient_id;

  insert into audit_events (actor_type, actor_id, event_type, entity_type, entity_id, metadata)
  values ('PATIENT', p_patient_id, 'SLOT_CLAIMED', 'campaign', p_campaign_id,
          jsonb_build_object('message_sid', p_message_sid));

  return query select true, v_row.id, v_row.appointment_time;
end;
$$;
```

<aside>
✅

Callers do exactly one thing with the result: if `claimed` is true, send the confirmation SMS. If false, send the already-filled reply. No re-reads, no retries, no second-guessing.

</aside>

A deposit variant transitions to `PENDING_PAYMENT` with `claim_expires_at = now() + interval '10 minutes'` instead of `FILLED`, and a `release_expired_reservations()` function run by the daily job reverts stale ones to `ESCALATING`.

## Wave selection query

```sql
select p.id, p.full_name, p.phone_number
  from patients p
 where p.opted_out = false
   and p.consent_status = 'GRANTED'
   and not exists (
     select 1 from campaign_recipients r
      where r.campaign_id = $1 and r.patient_id = p.id
   )
   and (
     select count(*) from sms_logs l
      where l.patient_id = p.id
        and l.direction = 'OUTBOUND'
        and l.created_at > now() - interval '7 days'
   ) < $2
   and ($3 = any(p.preferred_procedures) or p.preferred_procedures = '{}')
 order by p.reliability_score desc, p.last_visit_date asc nulls last
 limit $4;
```

If the trailing-7-day subquery becomes slow at scale, denormalize it into `patients.messages_last_7d`, refreshed by the daily job.

## Auto-update triggers

```sql
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger t_patients_touch  before update on patients
  for each row execute function touch_updated_at();
create trigger t_campaigns_touch before update on broadcast_campaigns
  for each row execute function touch_updated_at();
create trigger t_sms_touch       before update on sms_logs
  for each row execute function touch_updated_at();
```

## Row Level Security

Deny by default. Staff read through authenticated policies; all writes go through the service role.

```sql
alter table patients            enable row level security;
alter table broadcast_campaigns enable row level security;
alter table campaign_recipients enable row level security;
alter table sms_logs            enable row level security;
alter table unhandled_inbox     enable row level security;
alter table scheduled_messages  enable row level security;
alter table import_batches      enable row level security;
alter table import_batch_chunks enable row level security;
alter table audit_events        enable row level security;
alter table clinic_config       enable row level security;
alter table slot_templates      enable row level security;
alter table staff               enable row level security;

create or replace function is_active_staff() returns boolean
language sql stable security definer as $$
  select exists (select 1 from staff s where s.id = auth.uid() and s.active);
$$;

-- Read-only for authenticated staff (needed for Realtime subscriptions)
create policy staff_read_campaigns on broadcast_campaigns
  for select to authenticated using (is_active_staff());
create policy staff_read_inbox on unhandled_inbox
  for select to authenticated using (is_active_staff());
create policy staff_read_patients on patients
  for select to authenticated using (is_active_staff());

-- No insert/update/delete policies for authenticated. Service role bypasses RLS.
revoke all on all tables in schema public from anon;
```

<aside>
⚠️

The browser gets the **anon** key only, and only to subscribe to Realtime on the three readable tables. The service-role key exists exclusively in Vercel server env and n8n credentials. If it ever appears in a client bundle, treat it as a breach: rotate immediately.

</aside>

## Retention and deletion

- `sms_logs.message_body` redacted to `NULL` after 90 days by a daily job; metadata retained for reporting.
- `audit_events` retained 7 years (immutable; no update or delete policy).
- Patient deletion request: hard-delete the `patients` row. `sms_logs` and `unhandled_inbox` FKs are `on delete set null`, so aggregate reporting survives while the identity is gone.
- `campaign_recipients` cascades with its campaign.

## Migration order

```
0001_extensions_and_enums.sql
0002_clinic_config_and_staff.sql
0003_patients.sql
0004_slot_templates.sql
0005_campaigns_and_recipients.sql
0006_sms_logs.sql
0007_unhandled_inbox.sql
0008_scheduled_messages.sql
0009_import_batches_and_audit.sql
0010_functions_claim_and_release.sql
0011_triggers.sql
0012_rls_policies.sql
0013_seed_config_and_templates.sql
0014_patient_import_batches.sql
0015_campaign_lifecycle.sql
0016_wave_engine_functions.sql
0017_inbound_and_status_functions.sql
0018_inbox_and_manual_replies.sql
```

Each file is forward-only and idempotent (`if not exists` / `create or replace`). Never edit a shipped migration; add a new one.

## Seed data

```sql
insert into clinic_config (clinic_name, timezone)
values ('__CLINIC_NAME__', '__CLINIC_TIMEZONE__')
on conflict (id) do nothing;

insert into slot_templates (label, procedure_type, duration_min, sort_order) values
  ('Hygiene — 60 min',   'HYGIENE',   60, 1),
  ('Crown — 90 min',     'CROWN',     90, 2),
  ('Emergency — 30 min', 'EMERGENCY', 30, 3)
on conflict do nothing;
```

## Pre-handover verification

- [ ]  Anon key cannot read or write any table (verify with a raw REST call)
- [ ]  `claim_slot` returns `claimed = false` on the second concurrent call (test with two parallel connections)
- [ ]  `campaign_recipients` unique constraint blocks a duplicated wave
- [ ]  Inserting a non-E.164 phone fails
- [ ]  Setting `status = 'FILLED'` with a null `claimed_by` fails
- [ ]  Backup restore tested end to end and documented in the runbook