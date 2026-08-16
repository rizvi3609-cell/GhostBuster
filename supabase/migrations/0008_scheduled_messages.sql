begin;

create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  kind text not null check (kind in ('RECALL', 'REVIEW_REQUEST')),
  run_after timestamptz not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SENT', 'FAILED', 'CANCELLED')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create unique index if not exists scheduled_dedupe_idx
  on public.scheduled_messages (patient_id, kind)
  where status = 'PENDING';

commit;
