-- Replace the clinic placeholders before this migration is first applied.
-- After deployment, never edit this file; add a new migration instead.

begin;

insert into public.clinic_config (clinic_name, timezone)
values ('__CLINIC_NAME__', '__CLINIC_TIMEZONE__')
on conflict (id) do nothing;

insert into public.slot_templates (
  label,
  procedure_type,
  duration_min,
  sort_order
)
select seed.label, seed.procedure_type, seed.duration_min, seed.sort_order
from (
  values
    ('Hygiene — 60 min', 'HYGIENE', 60, 1),
    ('Crown — 90 min', 'CROWN', 90, 2),
    ('Emergency — 30 min', 'EMERGENCY', 30, 3)
) as seed(label, procedure_type, duration_min, sort_order)
where not exists (
  select 1
    from public.slot_templates existing
   where existing.label = seed.label
     and existing.procedure_type = seed.procedure_type
     and existing.duration_min = seed.duration_min
);

commit;
