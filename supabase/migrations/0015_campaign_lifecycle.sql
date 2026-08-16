begin;

alter table public.broadcast_campaigns
  add column if not exists next_wave_at timestamptz;

create table if not exists public.campaign_wave_runs (
  campaign_id uuid not null
    references public.broadcast_campaigns(id) on delete cascade,
  wave_number int not null check (wave_number > 0),
  delay_min int not null check (delay_min > 0),
  status text not null default 'RESERVED'
    check (status in ('RESERVED', 'SENT')),
  recipient_count int not null check (recipient_count > 0),
  reserved_at timestamptz not null default now(),
  sent_at timestamptz,
  next_wave_at timestamptz,
  primary key (campaign_id, wave_number)
);

alter table public.campaign_wave_runs enable row level security;
revoke all privileges on public.campaign_wave_runs from anon, authenticated;
grant select, insert, update, delete on public.campaign_wave_runs to service_role;

create or replace function public.create_broadcast_campaign(
  p_appointment_time timestamptz,
  p_clinic_timezone text,
  p_procedure_type text,
  p_duration_min int,
  p_wave_plan jsonb,
  p_created_by uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_campaign_id uuid;
begin
  insert into public.broadcast_campaigns (
    appointment_time,
    clinic_timezone,
    procedure_type,
    duration_min,
    status,
    wave_plan,
    expires_at,
    created_by
  ) values (
    p_appointment_time,
    p_clinic_timezone,
    p_procedure_type,
    p_duration_min,
    'DRAFT',
    p_wave_plan,
    p_appointment_time,
    p_created_by
  )
  returning id into v_campaign_id;

  insert into public.audit_events (
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    'STAFF',
    p_created_by,
    'CAMPAIGN_CREATED',
    'campaign',
    v_campaign_id,
    jsonb_build_object('appointment_time', p_appointment_time)
  );

  return v_campaign_id;
end
$function$;

create or replace function public.activate_campaign(p_campaign_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_activated boolean;
begin
  update public.broadcast_campaigns c
     set status = 'OPEN', updated_at = now()
   where c.id = p_campaign_id
     and c.status = 'DRAFT'
     and c.appointment_time > now()
  returning true into v_activated;

  return coalesce(v_activated, false);
end
$function$;

create or replace function public.schedule_campaign_start(
  p_campaign_id uuid,
  p_next_wave_at timestamptz
) returns boolean
language sql
security definer
set search_path = public, pg_temp
as $function$
  update public.broadcast_campaigns
     set next_wave_at = p_next_wave_at, updated_at = now()
   where id = p_campaign_id and status = 'DRAFT'
  returning true;
$function$;

create or replace function public.pause_campaign(
  p_campaign_id uuid,
  p_actor_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_paused boolean;
begin
  update public.broadcast_campaigns c
     set status = 'DRAFT', next_wave_at = null, updated_at = now()
   where c.id = p_campaign_id
     and c.status in ('OPEN', 'ESCALATING')
  returning true into v_paused;

  if coalesce(v_paused, false) then
    insert into public.audit_events (
      actor_type, actor_id, event_type, entity_type, entity_id
    ) values ('STAFF', p_actor_id, 'CAMPAIGN_PAUSED', 'campaign', p_campaign_id);
  end if;

  return coalesce(v_paused, false);
end
$function$;

create or replace function public.cancel_campaign(
  p_campaign_id uuid,
  p_actor_id uuid,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_cancelled boolean;
begin
  update public.broadcast_campaigns c
     set status = 'CANCELLED',
         cancelled_reason = p_reason,
         next_wave_at = null,
         updated_at = now()
   where c.id = p_campaign_id
     and c.status in ('DRAFT', 'OPEN', 'ESCALATING')
  returning true into v_cancelled;

  if coalesce(v_cancelled, false) then
    insert into public.audit_events (
      actor_type, actor_id, event_type, entity_type, entity_id, metadata
    ) values (
      'STAFF', p_actor_id, 'CAMPAIGN_CANCELLED', 'campaign', p_campaign_id,
      jsonb_build_object('reason', p_reason)
    );
  end if;

  return coalesce(v_cancelled, false);
end
$function$;

create or replace function public.assign_slot_manually(
  p_campaign_id uuid,
  p_patient_id uuid,
  p_actor_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_assigned boolean;
begin
  update public.broadcast_campaigns c
     set status = 'FILLED',
         claimed_by = p_patient_id,
         claimed_at = now(),
         next_wave_at = null,
         updated_at = now()
   where c.id = p_campaign_id
     and c.status in ('OPEN', 'ESCALATING')
  returning true into v_assigned;

  if coalesce(v_assigned, false) then
    insert into public.audit_events (
      actor_type, actor_id, event_type, entity_type, entity_id,
      metadata
    ) values (
      'STAFF', p_actor_id, 'SLOT_ASSIGNED_MANUALLY', 'campaign', p_campaign_id,
      jsonb_build_object('patient_id', p_patient_id)
    );
  end if;

  return coalesce(v_assigned, false);
end
$function$;

create or replace function public.count_eligible_patients(
  p_procedure_type text
) returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select count(*)
    from public.patients p
    cross join public.clinic_config config
   where p.opted_out = false
     and p.consent_status = 'GRANTED'
     and (
       p_procedure_type = any(p.preferred_procedures)
       or p.preferred_procedures = '{}'
     )
     and (
       select count(*)
         from public.sms_logs logs
        where logs.patient_id = p.id
          and logs.direction = 'OUTBOUND'
          and logs.created_at > now() - interval '7 days'
     ) < config.max_messages_per_week;
$function$;

revoke execute on function public.create_broadcast_campaign(
  timestamptz, text, text, int, jsonb, uuid
) from public, anon, authenticated;
revoke execute on function public.activate_campaign(uuid)
  from public, anon, authenticated;
revoke execute on function public.schedule_campaign_start(uuid, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.pause_campaign(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.cancel_campaign(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.assign_slot_manually(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.count_eligible_patients(text)
  from public, anon, authenticated;

grant execute on function public.create_broadcast_campaign(
  timestamptz, text, text, int, jsonb, uuid
) to service_role;
grant execute on function public.activate_campaign(uuid) to service_role;
grant execute on function public.schedule_campaign_start(uuid, timestamptz) to service_role;
grant execute on function public.pause_campaign(uuid, uuid) to service_role;
grant execute on function public.cancel_campaign(uuid, uuid, text) to service_role;
grant execute on function public.assign_slot_manually(uuid, uuid, uuid) to service_role;
grant execute on function public.count_eligible_patients(text) to service_role;

commit;
