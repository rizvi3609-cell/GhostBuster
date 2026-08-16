begin;

create or replace function public.claim_slot(
  p_campaign_id uuid,
  p_patient_id uuid,
  p_message_sid text
) returns table (
  claimed boolean,
  campaign_id uuid,
  appointment_time timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row public.broadcast_campaigns;
begin
  update public.broadcast_campaigns c
     set status = 'FILLED',
         claimed_by = p_patient_id,
         claimed_at = now(),
         updated_at = now()
   where c.id = p_campaign_id
     and c.status in ('OPEN', 'ESCALATING')
  returning c.* into v_row;

  if not found then
    return query
      select false, p_campaign_id, null::timestamptz;
    return;
  end if;

  update public.campaign_recipients
     set responded_at = now(),
         response_body = 'YES'
   where campaign_recipients.campaign_id = p_campaign_id
     and campaign_recipients.patient_id = p_patient_id;

  update public.patients
     set reliability_score = least(100, reliability_score + 5),
         updated_at = now()
   where id = p_patient_id;

  insert into public.audit_events (
    actor_type,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    'PATIENT',
    p_patient_id,
    'SLOT_CLAIMED',
    'campaign',
    p_campaign_id,
    jsonb_build_object('message_sid', p_message_sid)
  );

  return query
    select true, v_row.id, v_row.appointment_time;
end
$function$;

create or replace function public.release_expired_reservations()
returns table (campaign_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  return query
    update public.broadcast_campaigns c
       set status = 'ESCALATING',
           claimed_by = null,
           claimed_at = null,
           claim_expires_at = null,
           updated_at = now()
     where c.status = 'PENDING_PAYMENT'
       and c.claim_expires_at <= now()
    returning c.id;
end
$function$;

commit;
