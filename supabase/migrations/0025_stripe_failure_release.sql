begin;

create or replace function public.fail_stripe_payment(
  p_payment_link_id text,
  p_event_id text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_reservation public.payment_reservations;
begin
  update public.payment_reservations
     set status = 'FAILED', updated_at = now()
   where stripe_payment_link_id = p_payment_link_id
     and status = 'PENDING'
  returning * into v_reservation;
  if not found then return null; end if;

  update public.broadcast_campaigns
     set status = 'ESCALATING',
         claimed_by = null,
         claimed_at = null,
         claim_expires_at = null,
         next_wave_at = now(),
         updated_at = now()
   where id = v_reservation.campaign_id
     and status = 'PENDING_PAYMENT';
  if not found then return null; end if;

  insert into public.audit_events (
    actor_type, event_type, entity_type, entity_id, metadata
  ) values (
    'AUTOMATION', 'PAYMENT_FAILED', 'campaign', v_reservation.campaign_id,
    jsonb_build_object('stripe_event_id', p_event_id)
  );
  return v_reservation.campaign_id;
end
$function$;

revoke execute on function public.fail_stripe_payment(text,text)
  from public, anon, authenticated;
grant execute on function public.fail_stripe_payment(text,text)
  to service_role;

commit;
