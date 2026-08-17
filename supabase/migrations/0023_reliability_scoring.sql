begin;

alter table public.patients
  add column if not exists reliability_override int
    check (reliability_override between 0 and 100),
  add column if not exists reliability_override_reason text,
  add column if not exists reliability_overridden_at timestamptz,
  add column if not exists reliability_overridden_by uuid references public.staff(id);

create or replace function public.get_patient_reliability_components(
  p_patient_id uuid,
  p_procedure_type text
) returns table (
  successful_claims bigint,
  prior_claims_points int,
  days_since_last_visit int,
  recency_points int,
  procedure_match_points int,
  messages_last_7d bigint,
  contact_restraint_points int,
  computed_score int,
  override_score int,
  effective_score int,
  override_reason text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with facts as (
    select
      patient.id,
      patient.last_visit_date,
      patient.preferred_procedures,
      patient.reliability_override,
      patient.reliability_override_reason,
      (
        select count(*) from public.broadcast_campaigns campaign
         where campaign.claimed_by = patient.id and campaign.status = 'FILLED'
      )::bigint as claims,
      (
        select count(*) from public.sms_logs logs
         where logs.patient_id = patient.id
           and logs.direction = 'OUTBOUND'
           and logs.created_at > now() - interval '7 days'
      )::bigint as recent_messages
    from public.patients patient
    where patient.id = p_patient_id
  ),
  components as (
    select
      facts.*,
      least(40, facts.claims::int * 10) as claim_points,
      case
        when facts.last_visit_date is null then 0
        else least(30, greatest(0, (current_date - facts.last_visit_date) / 30 * 5))
      end::int as visit_points,
      case
        when p_procedure_type is null
          or facts.preferred_procedures = '{}'
          or p_procedure_type = any(facts.preferred_procedures)
        then 20 else 0
      end as procedure_points,
      greatest(0, 10 - facts.recent_messages::int * 2) as contact_points
    from facts
  )
  select
    components.claims,
    components.claim_points,
    case
      when components.last_visit_date is null then 0
      else current_date - components.last_visit_date
    end,
    components.visit_points,
    components.procedure_points,
    components.recent_messages,
    components.contact_points,
    components.claim_points + components.visit_points +
      components.procedure_points + components.contact_points,
    components.reliability_override,
    coalesce(
      components.reliability_override,
      components.claim_points + components.visit_points +
        components.procedure_points + components.contact_points
    ),
    components.reliability_override_reason
  from components;
$function$;

create or replace function public.refresh_reliability_scores()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_count bigint;
begin
  with scores as materialized (
    select patient.id, components.effective_score
      from public.patients patient
      cross join lateral public.get_patient_reliability_components(
        patient.id, null
      ) components
  )
  update public.patients patient
     set reliability_score = scores.effective_score,
         updated_at = now()
    from scores
   where patient.id = scores.id
     and patient.reliability_score is distinct from scores.effective_score;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

create or replace function public.override_patient_reliability(
  p_patient_id uuid,
  p_score int,
  p_reason text,
  p_actor_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_score not between 0 and 100 or length(trim(p_reason)) < 3 then
    return false;
  end if;

  update public.patients
     set reliability_override = p_score,
         reliability_override_reason = trim(p_reason),
         reliability_overridden_at = now(),
         reliability_overridden_by = p_actor_id,
         reliability_score = p_score,
         updated_at = now()
   where id = p_patient_id;
  if not found then return false; end if;

  insert into public.audit_events (
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    'STAFF', p_actor_id, 'RELIABILITY_OVERRIDDEN', 'patient', p_patient_id,
    jsonb_build_object('score', p_score, 'reason', trim(p_reason))
  );
  return true;
end
$function$;

create or replace function public.clear_patient_reliability_override(
  p_patient_id uuid,
  p_actor_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_score int;
begin
  select computed_score into v_score
    from public.get_patient_reliability_components(p_patient_id, null);
  if not found then return false; end if;

  update public.patients
     set reliability_override = null,
         reliability_override_reason = null,
         reliability_overridden_at = null,
         reliability_overridden_by = null,
         reliability_score = v_score,
         updated_at = now()
   where id = p_patient_id;

  insert into public.audit_events (
    actor_type, actor_id, event_type, entity_type, entity_id
  ) values (
    'STAFF', p_actor_id, 'RELIABILITY_OVERRIDE_CLEARED', 'patient', p_patient_id
  );
  return true;
end
$function$;

revoke execute on function public.get_patient_reliability_components(uuid,text) from public, anon, authenticated;
revoke execute on function public.refresh_reliability_scores() from public, anon, authenticated;
revoke execute on function public.override_patient_reliability(uuid,int,text,uuid) from public, anon, authenticated;
revoke execute on function public.clear_patient_reliability_override(uuid,uuid) from public, anon, authenticated;

grant execute on function public.get_patient_reliability_components(uuid,text) to service_role;
grant execute on function public.refresh_reliability_scores() to service_role;
grant execute on function public.override_patient_reliability(uuid,int,text,uuid) to service_role;
grant execute on function public.clear_patient_reliability_override(uuid,uuid) to service_role;

commit;
