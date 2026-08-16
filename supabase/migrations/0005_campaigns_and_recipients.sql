begin;

create table if not exists public.broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  appointment_time timestamptz not null,
  clinic_timezone text not null,
  procedure_type text not null,
  duration_min int not null,
  status public.campaign_status not null default 'DRAFT',
  wave_plan jsonb not null,
  current_wave int not null default 0,
  claimed_by uuid references public.patients(id),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  expires_at timestamptz not null,
  cancelled_reason text,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint claimed_consistency check (
    (status in ('FILLED', 'PENDING_PAYMENT') and claimed_by is not null)
    or (status not in ('FILLED', 'PENDING_PAYMENT') and claimed_by is null)
  )
);

create index if not exists campaigns_active_idx
  on public.broadcast_campaigns (appointment_time)
  where status in ('OPEN', 'ESCALATING', 'PENDING_PAYMENT');

create index if not exists campaigns_dashboard_idx
  on public.broadcast_campaigns (created_at desc);

create table if not exists public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.broadcast_campaigns(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  wave_number int not null,
  send_order int not null,
  send_status public.send_status not null default 'PENDING',
  sent_at timestamptz,
  responded_at timestamptz,
  response_body text,
  unique (campaign_id, patient_id)
);

create index if not exists recipients_campaign_idx
  on public.campaign_recipients (campaign_id, wave_number);

commit;
