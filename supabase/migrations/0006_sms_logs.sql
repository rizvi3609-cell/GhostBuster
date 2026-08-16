begin;

create table if not exists public.sms_logs (
  id uuid primary key default gen_random_uuid(),
  message_sid text unique,
  patient_id uuid references public.patients(id) on delete set null,
  campaign_id uuid references public.broadcast_campaigns(id) on delete set null,
  direction public.sms_direction not null,
  status public.sms_status not null,
  message_body text,
  error_code text,
  segments int,
  price_usd numeric(8,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sms_logs_patient_idx
  on public.sms_logs (patient_id, created_at desc);

create index if not exists sms_logs_campaign_idx
  on public.sms_logs (campaign_id);

create index if not exists sms_logs_failed_idx
  on public.sms_logs (created_at desc)
  where status in ('FAILED', 'UNDELIVERED');

commit;
