begin;

alter table public.clinic_config
  add column if not exists review_url text not null default 'https://example.com/review',
  add column if not exists review_cooldown_days int not null default 180;

alter table public.broadcast_campaigns
  add column if not exists appointment_completed_at timestamptz;

create or replace function public.reserve_due_recalls()
returns table (
  scheduled_message_id uuid,
  patient_id uuid,
  full_name text,
  phone_number text
)
language sql
security definer
set search_path = public, pg_temp
as $function$
  with config as (
    select * from public.clinic_config where id = true and feature_recalls
  ),
  candidates as (
    select patient.id, patient.full_name, patient.phone_number
      from public.patients patient
      cross join config
     where patient.opted_out = false
       and patient.consent_status = 'GRANTED'
       and patient.last_visit_date between
         (now() at time zone config.timezone)::date - (config.recall_threshold_days + 14)
         and (now() at time zone config.timezone)::date - config.recall_threshold_days
       and (
         patient.last_recall_sent_at is null
         or patient.last_recall_sent_at < now() - make_interval(days => config.recall_cooldown_days)
       )
  ),
  inserted as (
    insert into public.scheduled_messages (
      patient_id, kind, run_after, status
    )
    select candidate.id, 'RECALL', now(), 'PENDING'
      from candidates candidate
    on conflict (patient_id, kind) where status = 'PENDING' do nothing
    returning id, patient_id
  )
  select inserted.id, patient.id, patient.full_name, patient.phone_number
    from inserted
    join public.patients patient on patient.id = inserted.patient_id;
$function$;

create or replace function public.mark_appointment_complete(
  p_campaign_id uuid,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_campaign public.broadcast_campaigns;
  v_config public.clinic_config;
  v_scheduled_id uuid;
begin
  select * into v_config from public.clinic_config where id = true;
  if not v_config.feature_reviews then return null; end if;

  update public.broadcast_campaigns
     set appointment_completed_at = coalesce(appointment_completed_at, now()),
         updated_at = now()
   where id = p_campaign_id
     and status = 'FILLED'
  returning * into v_campaign;
  if not found then return null; end if;

  if exists (
    select 1 from public.scheduled_messages message
     where message.patient_id = v_campaign.claimed_by
       and message.kind = 'REVIEW_REQUEST'
       and message.status = 'SENT'
       and message.sent_at > now() - make_interval(days => v_config.review_cooldown_days)
  ) then
    return null;
  end if;

  insert into public.scheduled_messages (
    patient_id, kind, run_after, status
  ) values (
    v_campaign.claimed_by,
    'REVIEW_REQUEST',
    now() + make_interval(hours => v_config.review_delay_hours),
    'PENDING'
  ) on conflict (patient_id, kind) where status = 'PENDING' do update
    set run_after = excluded.run_after
  returning id into v_scheduled_id;

  insert into public.audit_events (
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    'STAFF', p_actor_id, 'APPOINTMENT_COMPLETED', 'campaign', p_campaign_id,
    jsonb_build_object('scheduled_message_id', v_scheduled_id)
  );
  return v_scheduled_id;
end
$function$;

create or replace function public.get_due_scheduled_messages(p_kind text)
returns table (
  scheduled_message_id uuid,
  patient_id uuid,
  phone_number text,
  message_kind text,
  review_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    message.id,
    patient.id,
    patient.phone_number,
    message.kind,
    case when message.kind = 'REVIEW_REQUEST' then config.review_url else null end
  from public.scheduled_messages message
  join public.patients patient on patient.id = message.patient_id
  cross join public.clinic_config config
  where message.status = 'PENDING'
    and message.run_after <= now()
    and message.kind = p_kind
    and (
      (message.kind = 'RECALL' and config.feature_recalls)
      or (message.kind = 'REVIEW_REQUEST' and config.feature_reviews)
    )
  order by message.run_after asc
  limit 500;
$function$;

create or replace function public.check_scheduled_message_eligibility(
  p_scheduled_message_id uuid
) returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select case
    when config.automation_paused then 'AUTOMATION_PAUSED'
    when patient.opted_out then 'OPTED_OUT'
    when patient.consent_status <> 'GRANTED' then 'NO_CONSENT'
    when config.quiet_hours_start = config.quiet_hours_end then 'QUIET_HOURS'
    when config.quiet_hours_start < config.quiet_hours_end and (
      (now() at time zone config.timezone)::time < config.quiet_hours_start
      or (now() at time zone config.timezone)::time >= config.quiet_hours_end
    ) then 'QUIET_HOURS'
    when config.quiet_hours_start > config.quiet_hours_end and (
      (now() at time zone config.timezone)::time < config.quiet_hours_start
      and (now() at time zone config.timezone)::time >= config.quiet_hours_end
    ) then 'QUIET_HOURS'
    when (
      select count(*) from public.sms_logs logs
       where logs.patient_id = patient.id
         and logs.direction = 'OUTBOUND'
         and logs.created_at > now() - interval '7 days'
    ) >= config.max_messages_per_week then 'FREQUENCY_CAP'
    else 'ALLOWED'
  end
  from public.scheduled_messages message
  join public.patients patient on patient.id = message.patient_id
  cross join public.clinic_config config
  where message.id = p_scheduled_message_id and message.status = 'PENDING';
$function$;

create or replace function public.complete_scheduled_message(
  p_scheduled_message_id uuid,
  p_message_sid text,
  p_message_body text,
  p_status public.sms_status,
  p_error_code text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_message public.scheduled_messages;
begin
  select * into v_message from public.scheduled_messages
   where id = p_scheduled_message_id and status = 'PENDING'
   for update;
  if not found then return false; end if;

  insert into public.sms_logs (
    message_sid, patient_id, direction, status, message_body, error_code
  ) values (
    p_message_sid, v_message.patient_id, 'OUTBOUND', p_status, p_message_body, p_error_code
  ) on conflict (message_sid) do nothing;

  update public.scheduled_messages
     set status = case when p_status = 'FAILED' then 'FAILED' else 'SENT' end,
         attempts = attempts + 1,
         last_error = p_error_code,
         sent_at = case when p_status = 'FAILED' then sent_at else now() end
   where id = p_scheduled_message_id;

  if p_status <> 'FAILED' and v_message.kind = 'RECALL' then
    update public.patients set last_recall_sent_at = now() where id = v_message.patient_id;
  end if;

  insert into public.audit_events (
    actor_type, event_type, entity_type, entity_id, metadata
  ) values (
    'AUTOMATION',
    case when v_message.kind = 'RECALL' then 'RECALL_SENT' else 'REVIEW_REQUEST_SENT' end,
    'scheduled_message', v_message.id,
    jsonb_build_object('message_sid', p_message_sid, 'status', p_status)
  );
  return true;
end
$function$;

revoke execute on function public.reserve_due_recalls() from public, anon, authenticated;
revoke execute on function public.mark_appointment_complete(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.get_due_scheduled_messages(text) from public, anon, authenticated;
revoke execute on function public.check_scheduled_message_eligibility(uuid) from public, anon, authenticated;
revoke execute on function public.complete_scheduled_message(uuid,text,text,public.sms_status,text) from public, anon, authenticated;

grant execute on function public.reserve_due_recalls() to service_role;
grant execute on function public.mark_appointment_complete(uuid, uuid) to service_role;
grant execute on function public.get_due_scheduled_messages(text) to service_role;
grant execute on function public.check_scheduled_message_eligibility(uuid) to service_role;
grant execute on function public.complete_scheduled_message(uuid,text,text,public.sms_status,text) to service_role;

commit;
