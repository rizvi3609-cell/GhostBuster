begin;

create or replace function public.reserve_next_campaign_wave(
  p_campaign_id uuid
) returns table (
  campaign_id uuid,
  patient_id uuid,
  full_name text,
  phone_number text,
  wave_number int,
  send_order int,
  delay_min int,
  appointment_time timestamptz,
  clinic_name text,
  clinic_timezone text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_campaign public.broadcast_campaigns;
  v_config public.clinic_config;
  v_patient_ids uuid[];
  v_size int;
  v_delay int;
  v_wave_number int;
  v_local_time time;
begin
  select * into v_config from public.clinic_config where id = true for update;
  if not found or v_config.automation_paused then return; end if;

  select * into v_campaign
    from public.broadcast_campaigns c
   where c.id = p_campaign_id
   for update;

  if not found or v_campaign.status not in ('OPEN', 'ESCALATING') then return; end if;
  if v_campaign.appointment_time <= now() then
    update public.broadcast_campaigns
       set status = 'EXPIRED', next_wave_at = null, updated_at = now()
     where id = p_campaign_id;
    return;
  end if;
  if v_campaign.next_wave_at is not null and v_campaign.next_wave_at > now() then return; end if;

  v_local_time := (now() at time zone v_config.timezone)::time;
  if v_config.quiet_hours_start = v_config.quiet_hours_end then return; end if;
  if v_config.quiet_hours_start < v_config.quiet_hours_end then
    if v_local_time < v_config.quiet_hours_start
       or v_local_time >= v_config.quiet_hours_end then return; end if;
  elsif v_local_time < v_config.quiet_hours_start
        and v_local_time >= v_config.quiet_hours_end then
    return;
  end if;

  if v_campaign.current_wave >= jsonb_array_length(v_campaign.wave_plan) then
    update public.broadcast_campaigns
       set status = 'EXPIRED', next_wave_at = null, updated_at = now()
     where id = p_campaign_id;
    return;
  end if;

  v_size := (v_campaign.wave_plan -> v_campaign.current_wave ->> 'size')::int;
  v_delay := (v_campaign.wave_plan -> v_campaign.current_wave ->> 'delay_min')::int;
  v_wave_number := v_campaign.current_wave + 1;

  if v_size < 1 or v_delay < 1 then raise exception 'Invalid campaign wave plan'; end if;

  select array_agg(candidate.id order by candidate.reliability_score desc, candidate.last_visit_date asc nulls last)
    into v_patient_ids
    from (
      select p.id, p.reliability_score, p.last_visit_date
        from public.patients p
       where p.opted_out = false
         and p.consent_status = 'GRANTED'
         and not exists (
           select 1 from public.campaign_recipients r
            where r.campaign_id = p_campaign_id and r.patient_id = p.id
         )
         and (
           select count(*) from public.sms_logs logs
            where logs.patient_id = p.id
              and logs.direction = 'OUTBOUND'
              and logs.created_at > now() - interval '7 days'
         ) < v_config.max_messages_per_week
         and (
           v_campaign.procedure_type = any(p.preferred_procedures)
           or p.preferred_procedures = '{}'
         )
       order by p.reliability_score desc, p.last_visit_date asc nulls last
       limit v_size
    ) candidate;

  if coalesce(cardinality(v_patient_ids), 0) = 0 then
    update public.broadcast_campaigns
       set status = 'EXPIRED', next_wave_at = null, updated_at = now()
     where id = p_campaign_id;
    return;
  end if;

  insert into public.campaign_wave_runs (
    campaign_id, wave_number, delay_min, recipient_count
  ) values (
    p_campaign_id, v_wave_number, v_delay, cardinality(v_patient_ids)
  );

  insert into public.campaign_recipients (
    campaign_id, patient_id, wave_number, send_order
  )
  select p_campaign_id, selected.patient_id, v_wave_number, selected.send_order::int
    from unnest(v_patient_ids) with ordinality selected(patient_id, send_order);

  update public.broadcast_campaigns
     set status = 'ESCALATING',
         current_wave = v_wave_number,
         next_wave_at = 'infinity'::timestamptz,
         updated_at = now()
   where id = p_campaign_id;

  return query
    select
      p_campaign_id,
      p.id,
      p.full_name,
      p.phone_number,
      v_wave_number,
      selected.send_order::int,
      v_delay,
      v_campaign.appointment_time,
      v_config.clinic_name,
      v_campaign.clinic_timezone
    from unnest(v_patient_ids) with ordinality selected(patient_id, send_order)
    join public.patients p on p.id = selected.patient_id
    order by selected.send_order;
end
$function$;

create or replace function public.complete_campaign_wave(
  p_campaign_id uuid,
  p_wave_number int
) returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_run public.campaign_wave_runs;
  v_next timestamptz;
begin
  select * into v_run
    from public.campaign_wave_runs r
   where r.campaign_id = p_campaign_id and r.wave_number = p_wave_number
   for update;
  if not found then return null; end if;
  if v_run.status = 'SENT' then return v_run.next_wave_at; end if;

  v_next := now() + make_interval(mins => v_run.delay_min);
  update public.campaign_wave_runs
     set status = 'SENT', sent_at = now(), next_wave_at = v_next
   where campaign_id = p_campaign_id and wave_number = p_wave_number;

  update public.broadcast_campaigns
     set next_wave_at = v_next, updated_at = now()
   where id = p_campaign_id and status in ('OPEN', 'ESCALATING');

  insert into public.audit_events (
    actor_type, event_type, entity_type, entity_id, metadata
  ) values (
    'AUTOMATION', 'WAVE_SENT', 'campaign', p_campaign_id,
    jsonb_build_object('wave_number', p_wave_number, 'recipient_count', v_run.recipient_count)
  );

  return v_next;
end
$function$;

create or replace function public.check_campaign_send_eligibility(
  p_campaign_id uuid,
  p_patient_id uuid
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
    when campaign.status not in ('OPEN', 'ESCALATING') then 'CAMPAIGN_CLOSED'
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
  from public.broadcast_campaigns campaign
  join public.campaign_recipients recipient
    on recipient.campaign_id = campaign.id and recipient.patient_id = p_patient_id
  join public.patients patient on patient.id = recipient.patient_id
  cross join public.clinic_config config
  where campaign.id = p_campaign_id;
$function$;

create or replace function public.mark_campaign_recipient_skipped(
  p_campaign_id uuid,
  p_patient_id uuid
) returns void
language sql
security definer
set search_path = public, pg_temp
as $function$
  update public.campaign_recipients
     set send_status = 'SKIPPED'
   where campaign_id = p_campaign_id
     and patient_id = p_patient_id
     and send_status = 'PENDING';
$function$;

create or replace function public.record_campaign_sms(
  p_campaign_id uuid,
  p_patient_id uuid,
  p_message_sid text,
  p_message_body text,
  p_status public.sms_status,
  p_error_code text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  insert into public.sms_logs (
    message_sid, patient_id, campaign_id, direction, status, message_body, error_code
  ) values (
    p_message_sid, p_patient_id, p_campaign_id, 'OUTBOUND', p_status,
    p_message_body, p_error_code
  ) on conflict (message_sid) do nothing;

  update public.campaign_recipients
     set send_status = case
           when p_status = 'FAILED' then 'FAILED'::public.send_status
           else 'SENT'::public.send_status
         end,
         sent_at = case when p_status = 'FAILED' then sent_at else now() end
   where campaign_id = p_campaign_id and patient_id = p_patient_id;

  update public.patients
     set last_messaged_at = case when p_status = 'FAILED' then last_messaged_at else now() end
   where id = p_patient_id;
end
$function$;

revoke execute on function public.reserve_next_campaign_wave(uuid) from public, anon, authenticated;
revoke execute on function public.complete_campaign_wave(uuid, int) from public, anon, authenticated;
revoke execute on function public.check_campaign_send_eligibility(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.mark_campaign_recipient_skipped(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.record_campaign_sms(uuid, uuid, text, text, public.sms_status, text) from public, anon, authenticated;

grant execute on function public.reserve_next_campaign_wave(uuid) to service_role;
grant execute on function public.complete_campaign_wave(uuid, int) to service_role;
grant execute on function public.check_campaign_send_eligibility(uuid, uuid) to service_role;
grant execute on function public.mark_campaign_recipient_skipped(uuid, uuid) to service_role;
grant execute on function public.record_campaign_sms(uuid, uuid, text, text, public.sms_status, text) to service_role;

commit;
