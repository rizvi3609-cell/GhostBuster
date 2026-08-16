begin;

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  imported_by uuid references public.staff(id),
  filename text,
  row_count int not null,
  inserted_count int not null,
  updated_count int not null,
  skipped_count int not null,
  invalid_count int not null,
  column_mapping jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('STAFF', 'AUTOMATION', 'PATIENT')),
  actor_id uuid,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists audit_entity_idx
  on public.audit_events (entity_type, entity_id, created_at desc);

create index if not exists audit_recent_idx
  on public.audit_events (created_at desc);

commit;
