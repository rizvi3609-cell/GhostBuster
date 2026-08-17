begin;

create table if not exists public.manual_reply_requests (
  id uuid primary key,
  inbox_id uuid not null references public.unhandled_inbox(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  staff_id uuid not null references public.staff(id),
  message_body text not null,
  status text not null check (status in ('PENDING', 'SENT', 'FAILED', 'BLOCKED')),
  blocked_reason text,
  message_sid text unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.manual_reply_requests enable row level security;
revoke all privileges on public.manual_reply_requests from anon, authenticated;
grant select, insert, update, delete on public.manual_reply_requests to service_role;

create or replace function public.assign_inbox_message(
  p_inbox_id uuid,
  p_assigned_to uuid,
  p_actor_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_updated boolean;
  v_patient_id uuid;
begin
  if not exists (select 1 from public.staff where id = p_assigned_to and active) then
    return false;
  end if;

  select patient_id into v_patient_id
    from public.unhandled_inbox
   where id = p_inbox_id and status in ('UNREAD', 'OPEN');
  if not found then return false; end if;

  update public.unhandled_inbox
     set assigned_to = p_assigned_to,
         status = case when status = 'UNREAD' then 'OPEN' else status end
   where status in ('UNREAD', 'OPEN')
     and (id = p_inbox_id or (v_patient_id is not null and patient_id = v_patient_id));
  v_updated := found;

  if coalesce(v_updated, false) then
    insert into public.audit_events (
      actor_type, actor_id, event_type, entity_type, entity_id,
      metadata
    ) values (
      'STAFF', p_actor_id, 'INBOX_ASSIGNED', 'inbox', p_inbox_id,
      jsonb_build_object('assigned_to', p_assigned_to)
    );
  end if;

  return coalesce(v_updated, false);
end
$function$;

create or replace function public.resolve_inbox_message(
  p_inbox_id uuid,
  p_actor_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_updated boolean;
  v_patient_id uuid;
begin
  select patient_id into v_patient_id
    from public.unhandled_inbox
   where id = p_inbox_id and status in ('UNREAD', 'OPEN');
  if not found then return false; end if;

  update public.unhandled_inbox
     set status = 'RESOLVED', resolved_at = now(), resolved_by = p_actor_id
   where status in ('UNREAD', 'OPEN')
     and (id = p_inbox_id or (v_patient_id is not null and patient_id = v_patient_id));
  v_updated := found;

  if coalesce(v_updated, false) then
    insert into public.audit_events (
      actor_type, actor_id, event_type, entity_type, entity_id
    ) values ('STAFF', p_actor_id, 'INBOX_RESOLVED', 'inbox', p_inbox_id);
  end if;

  return coalesce(v_updated, false);
end
$function$;

create or replace function public.reserve_manual_reply(
  p_request_id uuid,
  p_inbox_id uuid,
  p_patient_id uuid,
  p_staff_id uuid,
  p_message_body text
) returns table (
  should_send boolean,
  request_status text,
  phone_number text,
  blocked_reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_existing public.manual_reply_requests;
  v_patient public.patients;
  v_config public.clinic_config;
  v_inbox public.unhandled_inbox;
  v_reason text;
  v_local_time time;
begin
  select * into v_existing from public.manual_reply_requests where id = p_request_id;
  if found then
    return query select false, v_existing.status, null::text, v_existing.blocked_reason;
    return;
  end if;

  select * into v_config from public.clinic_config where id = true for update;
  select * into v_patient from public.patients where id = p_patient_id for update;
  select * into v_inbox
    from public.unhandled_inbox
   where id = p_inbox_id and patient_id = p_patient_id
   for update;

  if v_config.automation_paused then
    v_reason := 'AUTOMATION_PAUSED';
  elsif not found then
    v_reason := 'INBOX_UNAVAILABLE';
  elsif v_patient.opted_out then
    v_reason := 'OPTED_OUT';
  elsif v_patient.consent_status <> 'GRANTED' then
    v_reason := 'NO_CONSENT';
  else
    v_local_time := (now() at time zone v_config.timezone)::time;
    if v_config.quiet_hours_start = v_config.quiet_hours_end then
      v_reason := 'QUIET_HOURS';
    elsif v_config.quiet_hours_start < v_config.quiet_hours_end and (
      v_local_time < v_config.quiet_hours_start
      or v_local_time >= v_config.quiet_hours_end
    ) then
      v_reason := 'QUIET_HOURS';
    elsif v_config.quiet_hours_start > v_config.quiet_hours_end and (
      v_local_time < v_config.quiet_hours_start
      and v_local_time >= v_config.quiet_hours_end
    ) then
      v_reason := 'QUIET_HOURS';
    elsif (
      select count(*) from public.sms_logs logs
       where logs.patient_id = p_patient_id
         and logs.direction = 'OUTBOUND'
         and logs.created_at > now() - interval '7 days'
    ) >= v_config.max_messages_per_week then
      v_reason := 'FREQUENCY_CAP';
    end if;
  end if;

  insert into public.manual_reply_requests (
    id, inbox_id, patient_id, staff_id, message_body, status, blocked_reason
  ) values (
    p_request_id, p_inbox_id, p_patient_id, p_staff_id, p_message_body,
    case when v_reason is null then 'PENDING' else 'BLOCKED' end,
    v_reason
  );

  return query
    select v_reason is null, case when v_reason is null then 'PENDING' else 'BLOCKED' end,
           case when v_reason is null then v_patient.phone_number else null end,
           v_reason;
end
$function$;

create or replace function public.complete_manual_reply(
  p_request_id uuid,
  p_message_sid text,
  p_status public.sms_status,
  p_error_code text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_request public.manual_reply_requests;
  v_campaign_id uuid;
  v_completed boolean;
begin
  select * into v_request
    from public.manual_reply_requests
   where id = p_request_id
   for update;
  if not found or v_request.status <> 'PENDING' then return false; end if;

  select campaign_id into v_campaign_id
    from public.unhandled_inbox
   where id = v_request.inbox_id;

  insert into public.sms_logs (
    message_sid, patient_id, campaign_id, direction, status,
    message_body, error_code
  ) values (
    p_message_sid, v_request.patient_id, v_campaign_id, 'OUTBOUND', p_status,
    v_request.message_body, p_error_code
  ) on conflict (message_sid) do nothing;

  update public.manual_reply_requests
     set status = case when p_status = 'FAILED' then 'FAILED' else 'SENT' end,
         message_sid = p_message_sid,
         completed_at = now()
   where id = p_request_id
  returning true into v_completed;

  if p_status <> 'FAILED' then
    insert into public.audit_events (
      actor_type, actor_id, event_type, entity_type, entity_id,
      metadata
    ) values (
      'STAFF', v_request.staff_id, 'MANUAL_REPLY_SENT', 'inbox', v_request.inbox_id,
      jsonb_build_object('message_sid', p_message_sid)
    );
  end if;

  return coalesce(v_completed, false);
end
$function$;

do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'unhandled_inbox'
     ) then
    alter publication supabase_realtime add table public.unhandled_inbox;
  end if;
end
$publication$;

revoke execute on function public.assign_inbox_message(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.resolve_inbox_message(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reserve_manual_reply(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.complete_manual_reply(uuid, text, public.sms_status, text) from public, anon, authenticated;

grant execute on function public.assign_inbox_message(uuid, uuid, uuid) to service_role;
grant execute on function public.resolve_inbox_message(uuid, uuid) to service_role;
grant execute on function public.reserve_manual_reply(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.complete_manual_reply(uuid, text, public.sms_status, text) to service_role;

commit;
