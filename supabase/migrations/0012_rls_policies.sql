begin;

alter table public.patients enable row level security;
alter table public.broadcast_campaigns enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.sms_logs enable row level security;
alter table public.unhandled_inbox enable row level security;
alter table public.scheduled_messages enable row level security;
alter table public.import_batches enable row level security;
alter table public.audit_events enable row level security;
alter table public.clinic_config enable row level security;
alter table public.slot_templates enable row level security;
alter table public.staff enable row level security;

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1
      from public.staff s
     where s.id = auth.uid()
       and s.active
  );
$function$;

drop policy if exists staff_read_campaigns on public.broadcast_campaigns;
create policy staff_read_campaigns
  on public.broadcast_campaigns
  for select
  to authenticated
  using (public.is_active_staff());

drop policy if exists staff_read_inbox on public.unhandled_inbox;
create policy staff_read_inbox
  on public.unhandled_inbox
  for select
  to authenticated
  using (public.is_active_staff());

drop policy if exists staff_read_patients on public.patients;
create policy staff_read_patients
  on public.patients
  for select
  to authenticated
  using (public.is_active_staff());

revoke all privileges on all tables in schema public from anon;
revoke all privileges on all tables in schema public from authenticated;
grant select on public.broadcast_campaigns to authenticated;
grant select on public.unhandled_inbox to authenticated;
grant select on public.patients to authenticated;

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on function public.claim_slot(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_slot(uuid, uuid, text)
  to service_role;

revoke execute on function public.release_expired_reservations()
  from public, anon, authenticated;
grant execute on function public.release_expired_reservations()
  to service_role;

revoke execute on function public.is_active_staff()
  from public, anon;
grant execute on function public.is_active_staff()
  to authenticated, service_role;

commit;
