begin;

create table if not exists public.unhandled_inbox (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete set null,
  campaign_id uuid references public.broadcast_campaigns(id) on delete set null,
  message_sid text unique,
  message_body text not null,
  status public.inbox_status not null default 'UNREAD',
  assigned_to uuid references public.staff(id),
  received_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.staff(id)
);

create index if not exists inbox_open_idx
  on public.unhandled_inbox (received_at desc)
  where status in ('UNREAD', 'OPEN');

commit;
