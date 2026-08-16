begin;

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone_number text not null unique,
  opted_out boolean not null default false,
  consent_status public.consent_status not null default 'UNKNOWN',
  consent_recorded_at timestamptz,
  reliability_score int not null default 50,
  last_visit_date date,
  preferred_procedures text[] not null default '{}',
  last_messaged_at timestamptz,
  last_recall_sent_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_e164 check (phone_number ~ '^\+[1-9]\d{7,14}$'),
  constraint score_range check (reliability_score between 0 and 100)
);

create index if not exists patients_eligible_idx
  on public.patients (reliability_score desc, last_visit_date asc)
  where opted_out = false and consent_status = 'GRANTED';

create index if not exists patients_recall_idx
  on public.patients (last_visit_date)
  where opted_out = false;

create index if not exists patients_name_trgm
  on public.patients using gin (full_name gin_trgm_ops);

commit;
