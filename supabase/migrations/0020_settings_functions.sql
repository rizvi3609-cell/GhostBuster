begin;

alter table public.clinic_config
  add column if not exists feature_stripe_deposits boolean not null default false,
  add column if not exists feature_recalls boolean not null default false,
  add column if not exists feature_reviews boolean not null default false;

create or replace function public.save_clinic_settings(
  p_actor_id uuid,
  p_clinic_name text,
  p_timezone text,
  p_quiet_hours_start time,
  p_quiet_hours_end time,
  p_max_messages_per_week int,
  p_estimated_chair_value numeric,
  p_recall_threshold_days int,
  p_recall_cooldown_days int,
  p_default_wave_plan jsonb,
  p_feature_stripe_deposits boolean,
  p_feature_recalls boolean,
  p_feature_reviews boolean
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if length(trim(p_clinic_name)) = 0
     or not exists (select 1 from pg_timezone_names where name = p_timezone)
     or p_quiet_hours_start = p_quiet_hours_end
     or p_max_messages_per_week < 1
     or p_estimated_chair_value < 0
     or p_recall_threshold_days < 1
     or p_recall_cooldown_days < 1
     or jsonb_typeof(p_default_wave_plan) <> 'array'
     or jsonb_array_length(p_default_wave_plan) < 1 then
    return false;
  end if;

  update public.clinic_config
     set clinic_name = trim(p_clinic_name),
         timezone = p_timezone,
         quiet_hours_start = p_quiet_hours_start,
         quiet_hours_end = p_quiet_hours_end,
         max_messages_per_week = p_max_messages_per_week,
         estimated_chair_value = p_estimated_chair_value,
         recall_threshold_days = p_recall_threshold_days,
         recall_cooldown_days = p_recall_cooldown_days,
         default_wave_plan = p_default_wave_plan,
         feature_stripe_deposits = p_feature_stripe_deposits,
         feature_recalls = p_feature_recalls,
         feature_reviews = p_feature_reviews,
         updated_at = now()
   where id = true;

  insert into public.audit_events (
    actor_type, actor_id, event_type, entity_type, metadata
  ) values (
    'STAFF', p_actor_id, 'CONFIG_CHANGED', 'clinic_config',
    jsonb_build_object('sections', array['clinic','sending','waves','money','features'])
  );
  return true;
end
$function$;

create or replace function public.set_automation_paused(
  p_actor_id uuid,
  p_paused boolean
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  update public.clinic_config
     set automation_paused = p_paused, updated_at = now()
   where id = true and automation_paused is distinct from p_paused;
  if not found then return false; end if;

  insert into public.audit_events (
    actor_type, actor_id, event_type, entity_type, metadata
  ) values (
    'STAFF', p_actor_id, 'KILL_SWITCH_TOGGLED', 'clinic_config',
    jsonb_build_object('automation_paused', p_paused)
  );
  return true;
end
$function$;

create or replace function public.upsert_slot_template(
  p_id uuid,
  p_actor_id uuid,
  p_label text,
  p_procedure_type text,
  p_duration_min int,
  p_wave_plan jsonb,
  p_requires_deposit boolean,
  p_sort_order int
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  if length(trim(p_label)) = 0
     or length(trim(p_procedure_type)) = 0
     or p_duration_min < 1 then
    return null;
  end if;

  insert into public.slot_templates (
    id, label, procedure_type, duration_min, wave_plan,
    requires_deposit, sort_order, active
  ) values (
    v_id, trim(p_label), upper(trim(p_procedure_type)), p_duration_min,
    p_wave_plan, p_requires_deposit, p_sort_order, true
  ) on conflict (id) do update
    set label = excluded.label,
        procedure_type = excluded.procedure_type,
        duration_min = excluded.duration_min,
        wave_plan = excluded.wave_plan,
        requires_deposit = excluded.requires_deposit,
        sort_order = excluded.sort_order;

  insert into public.audit_events (
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    'STAFF', p_actor_id, 'CONFIG_CHANGED', 'slot_template', v_id,
    jsonb_build_object('section', 'slot_templates')
  );
  return v_id;
end
$function$;

create or replace function public.set_slot_template_active(
  p_id uuid,
  p_actor_id uuid,
  p_active boolean
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  update public.slot_templates set active = p_active where id = p_id;
  if not found then return false; end if;
  insert into public.audit_events (
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    'STAFF', p_actor_id, 'CONFIG_CHANGED', 'slot_template', p_id,
    jsonb_build_object('section', 'slot_templates', 'active', p_active)
  );
  return true;
end
$function$;

create or replace function public.upsert_staff_member(
  p_staff_id uuid,
  p_actor_id uuid,
  p_email text,
  p_full_name text,
  p_role public.staff_role,
  p_active boolean
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_staff_id = p_actor_id and not p_active then return false; end if;
  if exists (
    select 1 from public.staff where id = p_staff_id and role = 'OWNER' and active
  ) and (p_role <> 'OWNER' or not p_active) and (
    select count(*) from public.staff where role = 'OWNER' and active
  ) <= 1 then
    return false;
  end if;

  insert into public.staff (id, email, full_name, role, active)
  values (p_staff_id, lower(trim(p_email)), nullif(trim(p_full_name), ''), p_role, p_active)
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        role = excluded.role,
        active = excluded.active;

  insert into public.audit_events (
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    'STAFF', p_actor_id, 'CONFIG_CHANGED', 'staff', p_staff_id,
    jsonb_build_object('section', 'staff', 'role', p_role, 'active', p_active)
  );
  return true;
end
$function$;

revoke execute on function public.save_clinic_settings(uuid,text,text,time,time,int,numeric,int,int,jsonb,boolean,boolean,boolean) from public, anon, authenticated;
revoke execute on function public.set_automation_paused(uuid,boolean) from public, anon, authenticated;
revoke execute on function public.upsert_slot_template(uuid,uuid,text,text,int,jsonb,boolean,int) from public, anon, authenticated;
revoke execute on function public.set_slot_template_active(uuid,uuid,boolean) from public, anon, authenticated;
revoke execute on function public.upsert_staff_member(uuid,uuid,text,text,public.staff_role,boolean) from public, anon, authenticated;

grant execute on function public.save_clinic_settings(uuid,text,text,time,time,int,numeric,int,int,jsonb,boolean,boolean,boolean) to service_role;
grant execute on function public.set_automation_paused(uuid,boolean) to service_role;
grant execute on function public.upsert_slot_template(uuid,uuid,text,text,int,jsonb,boolean,int) to service_role;
grant execute on function public.set_slot_template_active(uuid,uuid,boolean) to service_role;
grant execute on function public.upsert_staff_member(uuid,uuid,text,text,public.staff_role,boolean) to service_role;

commit;
