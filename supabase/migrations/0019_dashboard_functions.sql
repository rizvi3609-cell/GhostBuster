begin;

create index if not exists campaigns_operational_idx
  on public.broadcast_campaigns (appointment_time)
  where status in ('DRAFT', 'OPEN', 'ESCALATING', 'PENDING_PAYMENT');

create or replace function public.get_dashboard_metrics()
returns table (
  chairs_filled_month bigint,
  median_fill_seconds numeric,
  estimated_revenue numeric,
  delivered_count bigint,
  failed_count bigint,
  delivery_rate numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with fills as (
    select
      count(*)::bigint as fill_count,
      percentile_cont(0.5) within group (
        order by extract(epoch from (claimed_at - created_at))
      )::numeric as median_seconds
    from public.broadcast_campaigns
    where status = 'FILLED'
      and claimed_at >= date_trunc('month', now())
  ),
  delivery as (
    select
      count(*) filter (where status = 'DELIVERED')::bigint as delivered,
      count(*) filter (where status in ('FAILED', 'UNDELIVERED'))::bigint as failed,
      count(*) filter (
        where status in ('DELIVERED', 'FAILED', 'UNDELIVERED')
      )::numeric as terminal
    from public.sms_logs
    where direction = 'OUTBOUND'
      and created_at >= now() - interval '30 days'
  )
  select
    fills.fill_count,
    coalesce(fills.median_seconds, 0),
    fills.fill_count * config.estimated_chair_value,
    delivery.delivered,
    delivery.failed,
    case
      when delivery.terminal = 0 then 0
      else round(delivery.delivered::numeric / delivery.terminal * 100, 1)
    end
  from fills
  cross join delivery
  cross join public.clinic_config config;
$function$;

create or replace function public.get_dashboard_campaigns()
returns table (
  id uuid,
  appointment_time timestamptz,
  clinic_timezone text,
  procedure_type text,
  duration_min int,
  status public.campaign_status,
  current_wave int,
  wave_count int,
  next_wave_at timestamptz,
  updated_at timestamptz,
  recipient_count bigint,
  delivered_count bigint,
  failed_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    campaign.id,
    campaign.appointment_time,
    campaign.clinic_timezone,
    campaign.procedure_type,
    campaign.duration_min,
    campaign.status,
    campaign.current_wave,
    jsonb_array_length(campaign.wave_plan),
    campaign.next_wave_at,
    campaign.updated_at,
    coalesce(recipients.recipient_count, 0),
    coalesce(delivery.delivered_count, 0),
    coalesce(delivery.failed_count, 0)
  from public.broadcast_campaigns campaign
  left join lateral (
    select count(*)::bigint as recipient_count
      from public.campaign_recipients recipient
     where recipient.campaign_id = campaign.id
  ) recipients on true
  left join lateral (
    select
      count(*) filter (where logs.status = 'DELIVERED')::bigint as delivered_count,
      count(*) filter (where logs.status in ('FAILED', 'UNDELIVERED'))::bigint as failed_count
    from public.sms_logs logs
    where logs.campaign_id = campaign.id and logs.direction = 'OUTBOUND'
  ) delivery on true
  where campaign.status in ('DRAFT', 'OPEN', 'ESCALATING', 'PENDING_PAYMENT')
    and campaign.appointment_time > now() - interval '1 day'
  order by campaign.appointment_time asc
  limit 20;
$function$;

create or replace function public.get_recent_campaign_outcomes()
returns table (
  id uuid,
  appointment_time timestamptz,
  clinic_timezone text,
  procedure_type text,
  status public.campaign_status,
  winner_name text,
  resolved_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    campaign.id,
    campaign.appointment_time,
    campaign.clinic_timezone,
    campaign.procedure_type,
    campaign.status,
    patient.full_name,
    coalesce(campaign.claimed_at, campaign.updated_at)
  from public.broadcast_campaigns campaign
  left join public.patients patient on patient.id = campaign.claimed_by
  where campaign.status in ('FILLED', 'EXPIRED', 'CANCELLED')
  order by coalesce(campaign.claimed_at, campaign.updated_at) desc
  limit 10;
$function$;

create or replace function public.record_automation_abort(
  p_campaign_id uuid,
  p_reason text
) returns void
language sql
security definer
set search_path = public, pg_temp
as $function$
  insert into public.audit_events (
    actor_type, event_type, entity_type, entity_id, metadata
  ) values (
    'AUTOMATION', 'AUTOMATION_ABORTED', 'campaign', p_campaign_id,
    jsonb_build_object('reason', p_reason)
  );
$function$;

revoke execute on function public.get_dashboard_metrics() from public, anon, authenticated;
revoke execute on function public.get_dashboard_campaigns() from public, anon, authenticated;
revoke execute on function public.get_recent_campaign_outcomes() from public, anon, authenticated;
revoke execute on function public.record_automation_abort(uuid, text) from public, anon, authenticated;

grant execute on function public.get_dashboard_metrics() to service_role;
grant execute on function public.get_dashboard_campaigns() to service_role;
grant execute on function public.get_recent_campaign_outcomes() to service_role;
grant execute on function public.record_automation_abort(uuid, text) to service_role;

commit;
