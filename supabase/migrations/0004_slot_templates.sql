begin;

create table if not exists public.slot_templates (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  procedure_type text not null,
  duration_min int not null,
  wave_plan jsonb,
  requires_deposit boolean not null default false,
  sort_order int not null default 0,
  active boolean not null default true
);

commit;
