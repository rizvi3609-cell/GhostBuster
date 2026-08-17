begin;

create or replace function public.save_v2_settings(
  p_actor_id uuid,
  p_deposit_amount numeric,
  p_review_url text,
  p_review_cooldown_days int
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_deposit_amount < 0
     or p_review_url !~ '^https://'
     or p_review_cooldown_days < 1 then
    return false;
  end if;

  update public.clinic_config
     set deposit_amount = p_deposit_amount,
         review_url = p_review_url,
         review_cooldown_days = p_review_cooldown_days,
         updated_at = now()
   where id = true;

  insert into public.audit_events (
    actor_type, actor_id, event_type, entity_type, metadata
  ) values (
    'STAFF', p_actor_id, 'CONFIG_CHANGED', 'clinic_config',
    jsonb_build_object('section', 'v2_settings')
  );
  return true;
end
$function$;

revoke execute on function public.save_v2_settings(uuid,numeric,text,int)
  from public, anon, authenticated;
grant execute on function public.save_v2_settings(uuid,numeric,text,int)
  to service_role;

commit;
