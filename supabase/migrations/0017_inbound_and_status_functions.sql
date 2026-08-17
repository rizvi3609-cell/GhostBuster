begin;

create or replace function public.ingest_inbound_sms(
  p_message_sid text,
  p_message_body text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  insert into public.sms_logs (
    message_sid, direction, status, message_body
  ) values (
    p_message_sid, 'INBOUND', 'RECEIVED', p_message_body
  ) on conflict (message_sid) do nothing;

  return found;
end
$function$;

create or replace function public.link_inbound_sms_patient(
  p_message_sid text,
  p_patient_id uuid
) returns void
language sql
security definer
set search_path = public, pg_temp
as $function$
  update public.sms_logs
     set patient_id = p_patient_id, updated_at = now()
   where message_sid = p_message_sid
     and direction = 'INBOUND';
$function$;

create or replace function public.find_patient_active_campaign(
  p_patient_id uuid
) returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select campaign.id
    from public.campaign_recipients recipient
    join public.broadcast_campaigns campaign on campaign.id = recipient.campaign_id
   where recipient.patient_id = p_patient_id
     and campaign.status in ('OPEN', 'ESCALATING')
   order by campaign.created_at desc
   limit 1;
$function$;

create or replace function public.process_patient_opt_out(
  p_patient_id uuid,
  p_message_sid text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  update public.patients
     set opted_out = true,
         consent_status = 'REVOKED',
         consent_recorded_at = now(),
         updated_at = now()
   where id = p_patient_id;

  insert into public.audit_events (
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    'PATIENT', p_patient_id, 'OPT_OUT', 'patient', p_patient_id,
    jsonb_build_object('message_sid', p_message_sid)
  );
end
$function$;

create or replace function public.process_patient_opt_in(
  p_patient_id uuid,
  p_message_sid text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if exists (
    select 1
      from public.campaign_recipients recipient
      join public.broadcast_campaigns campaign on campaign.id = recipient.campaign_id
     where recipient.patient_id = p_patient_id
       and campaign.status in ('OPEN', 'ESCALATING')
  ) then
    return false;
  end if;

  update public.patients
     set opted_out = false,
         consent_status = 'GRANTED',
         consent_recorded_at = now(),
         updated_at = now()
   where id = p_patient_id;
  if not found then return false; end if;

  insert into public.audit_events (
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    'PATIENT', p_patient_id, 'OPT_IN', 'patient', p_patient_id,
    jsonb_build_object('message_sid', p_message_sid)
  );
  return true;
end
$function$;

create or replace function public.create_unhandled_inbox_message(
  p_message_sid text,
  p_patient_id uuid,
  p_campaign_id uuid,
  p_message_body text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_id uuid;
begin
  insert into public.unhandled_inbox (
    patient_id, campaign_id, message_sid, message_body, status
  ) values (
    p_patient_id, p_campaign_id, p_message_sid, p_message_body, 'UNREAD'
  ) on conflict (message_sid) do update
    set message_sid = excluded.message_sid
  returning id into v_id;
  return v_id;
end
$function$;

create or replace function public.record_transactional_sms(
  p_message_sid text,
  p_patient_id uuid,
  p_campaign_id uuid,
  p_message_body text,
  p_status public.sms_status,
  p_error_code text
) returns void
language sql
security definer
set search_path = public, pg_temp
as $function$
  insert into public.sms_logs (
    message_sid, patient_id, campaign_id, direction, status,
    message_body, error_code
  ) values (
    p_message_sid, p_patient_id, p_campaign_id, 'OUTBOUND', p_status,
    p_message_body, p_error_code
  ) on conflict (message_sid) do nothing;
$function$;

create or replace function public.reconcile_sms_status(
  p_message_sid text,
  p_status public.sms_status,
  p_error_code text,
  p_segments int,
  p_price_usd numeric
) returns public.sms_status
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_current public.sms_status;
  v_result public.sms_status;
begin
  select status into v_current
    from public.sms_logs
   where message_sid = p_message_sid
   for update;

  if not found then
    insert into public.sms_logs (
      message_sid, direction, status, error_code, segments, price_usd
    ) values (
      p_message_sid, 'OUTBOUND', p_status, p_error_code, p_segments, p_price_usd
    );
    return p_status;
  end if;

  if v_current in ('DELIVERED', 'UNDELIVERED', 'FAILED') then
    return v_current;
  end if;

  v_result := case
    when p_status in ('DELIVERED', 'UNDELIVERED', 'FAILED') then p_status
    when v_current = 'SENT' and p_status = 'QUEUED' then v_current
    else p_status
  end;

  update public.sms_logs
     set status = v_result,
         error_code = coalesce(p_error_code, error_code),
         segments = coalesce(p_segments, segments),
         price_usd = coalesce(p_price_usd, price_usd),
         updated_at = now()
   where message_sid = p_message_sid;

  return v_result;
end
$function$;

revoke execute on function public.ingest_inbound_sms(text, text) from public, anon, authenticated;
revoke execute on function public.link_inbound_sms_patient(text, uuid) from public, anon, authenticated;
revoke execute on function public.find_patient_active_campaign(uuid) from public, anon, authenticated;
revoke execute on function public.process_patient_opt_out(uuid, text) from public, anon, authenticated;
revoke execute on function public.process_patient_opt_in(uuid, text) from public, anon, authenticated;
revoke execute on function public.create_unhandled_inbox_message(text, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.record_transactional_sms(text, uuid, uuid, text, public.sms_status, text) from public, anon, authenticated;
revoke execute on function public.reconcile_sms_status(text, public.sms_status, text, int, numeric) from public, anon, authenticated;

grant execute on function public.ingest_inbound_sms(text, text) to service_role;
grant execute on function public.link_inbound_sms_patient(text, uuid) to service_role;
grant execute on function public.find_patient_active_campaign(uuid) to service_role;
grant execute on function public.process_patient_opt_out(uuid, text) to service_role;
grant execute on function public.process_patient_opt_in(uuid, text) to service_role;
grant execute on function public.create_unhandled_inbox_message(text, uuid, uuid, text) to service_role;
grant execute on function public.record_transactional_sms(text, uuid, uuid, text, public.sms_status, text) to service_role;
grant execute on function public.reconcile_sms_status(text, public.sms_status, text, int, numeric) to service_role;

commit;
