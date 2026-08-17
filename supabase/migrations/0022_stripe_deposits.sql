begin;

alter table public.clinic_config
  add column if not exists deposit_amount numeric(10,2) not null default 50.00;

alter table public.broadcast_campaigns
  add column if not exists requires_deposit boolean not null default false;

create table if not exists public.payment_reservations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references public.broadcast_campaigns(id) on delete cascade,
  patient_id uuid not null references public.patients(id),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PAID', 'EXPIRED', 'FAILED')),
  amount_usd numeric(10,2) not null,
  stripe_payment_link_id text unique,
  stripe_payment_link_url text,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

alter table public.payment_reservations enable row level security;
alter table public.stripe_events enable row level security;
revoke all privileges on public.payment_reservations, public.stripe_events from anon, authenticated;
grant select, insert, update, delete on public.payment_reservations, public.stripe_events to service_role;

create or replace function public.create_broadcast_campaign_v2(
  p_appointment_time timestamptz,
  p_clinic_timezone text,
  p_procedure_type text,
  p_duration_min int,
  p_wave_plan jsonb,
  p_created_by uuid,
  p_requires_deposit boolean
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_campaign_id uuid;
begin
  insert into public.broadcast_campaigns (
    appointment_time, clinic_timezone, procedure_type, duration_min,
    status, wave_plan, expires_at, created_by, requires_deposit
  ) values (
    p_appointment_time, p_clinic_timezone, p_procedure_type, p_duration_min,
    'DRAFT', p_wave_plan, p_appointment_time, p_created_by, p_requires_deposit
  ) returning id into v_campaign_id;

  insert into public.audit_events (
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    'STAFF', p_created_by, 'CAMPAIGN_CREATED', 'campaign', v_campaign_id,
    jsonb_build_object(
      'appointment_time', p_appointment_time,
      'requires_deposit', p_requires_deposit
    )
  );
  return v_campaign_id;
end
$function$;

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
  v_deposit_enabled boolean;
  v_deposit_amount numeric;
begin
  select feature_stripe_deposits, deposit_amount
    into v_deposit_enabled, v_deposit_amount
    from public.clinic_config where id = true;

  update public.broadcast_campaigns c
     set status = case
           when c.requires_deposit and v_deposit_enabled
             then 'PENDING_PAYMENT'::public.campaign_status
           else 'FILLED'::public.campaign_status
         end,
         claimed_by = p_patient_id,
         claimed_at = now(),
         claim_expires_at = case
           when c.requires_deposit and v_deposit_enabled then now() + interval '10 minutes'
           else null
         end,
         updated_at = now()
   where c.id = p_campaign_id
     and c.status in ('OPEN', 'ESCALATING')
  returning c.* into v_row;

  if not found then
    return query select false, p_campaign_id, null::timestamptz;
    return;
  end if;

  update public.campaign_recipients
     set responded_at = now(), response_body = 'YES'
   where campaign_recipients.campaign_id = p_campaign_id
     and campaign_recipients.patient_id = p_patient_id;

  update public.patients
     set reliability_score = least(100, reliability_score + 5),
         updated_at = now()
   where id = p_patient_id;

  if v_row.status = 'PENDING_PAYMENT' then
    insert into public.payment_reservations (
      campaign_id, patient_id, amount_usd, expires_at
    ) values (
      p_campaign_id, p_patient_id, v_deposit_amount, v_row.claim_expires_at
    );
  end if;

  insert into public.audit_events (
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    'PATIENT', p_patient_id, 'SLOT_CLAIMED', 'campaign', p_campaign_id,
    jsonb_build_object('message_sid', p_message_sid, 'status', v_row.status)
  );

  return query select true, v_row.id, v_row.appointment_time;
end
$function$;

create or replace function public.get_pending_payment_reservation(p_campaign_id uuid)
returns table (
  reservation_id uuid,
  campaign_id uuid,
  amount_usd numeric,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select reservation.id, reservation.campaign_id, reservation.amount_usd, reservation.expires_at
    from public.payment_reservations reservation
   where reservation.campaign_id = p_campaign_id
     and reservation.status = 'PENDING';
$function$;

create or replace function public.attach_stripe_payment_link(
  p_reservation_id uuid,
  p_link_id text,
  p_link_url text
) returns boolean
language sql
security definer
set search_path = public, pg_temp
as $function$
  update public.payment_reservations
     set stripe_payment_link_id = p_link_id,
         stripe_payment_link_url = p_link_url,
         updated_at = now()
   where id = p_reservation_id and status = 'PENDING'
  returning true;
$function$;

create or replace function public.ingest_stripe_event(
  p_event_id text,
  p_event_type text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  insert into public.stripe_events (event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do nothing;
  return found;
end
$function$;

create or replace function public.complete_stripe_payment(
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
     set status = 'PAID', paid_at = now(), updated_at = now()
   where stripe_payment_link_id = p_payment_link_id
     and status = 'PENDING'
     and expires_at > now()
  returning * into v_reservation;
  if not found then return null; end if;

  update public.broadcast_campaigns
     set status = 'FILLED', claim_expires_at = null, updated_at = now()
   where id = v_reservation.campaign_id
     and status = 'PENDING_PAYMENT'
     and claimed_by = v_reservation.patient_id;
  if not found then return null; end if;

  insert into public.audit_events (
    actor_type, event_type, entity_type, entity_id, metadata
  ) values (
    'AUTOMATION', 'PAYMENT_COMPLETED', 'campaign', v_reservation.campaign_id,
    jsonb_build_object('stripe_event_id', p_event_id)
  );
  return v_reservation.campaign_id;
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
    with candidates as materialized (
      select campaign.id
        from public.broadcast_campaigns campaign
       where campaign.status = 'PENDING_PAYMENT'
         and campaign.claim_expires_at <= now()
       for update
    ),
    expired as (
      update public.payment_reservations reservation
         set status = 'EXPIRED', updated_at = now()
        from candidates
       where reservation.campaign_id = candidates.id
         and reservation.status = 'PENDING'
      returning reservation.campaign_id
    )
    update public.broadcast_campaigns campaign
       set status = 'ESCALATING',
           claimed_by = null,
           claimed_at = null,
           claim_expires_at = null,
           next_wave_at = now(),
           updated_at = now()
      from candidates
     where campaign.id = candidates.id
    returning campaign.id;
end
$function$;

revoke execute on function public.create_broadcast_campaign_v2(timestamptz,text,text,int,jsonb,uuid,boolean) from public, anon, authenticated;
revoke execute on function public.get_pending_payment_reservation(uuid) from public, anon, authenticated;
revoke execute on function public.attach_stripe_payment_link(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.ingest_stripe_event(text,text) from public, anon, authenticated;
revoke execute on function public.complete_stripe_payment(text,text) from public, anon, authenticated;

grant execute on function public.create_broadcast_campaign_v2(timestamptz,text,text,int,jsonb,uuid,boolean) to service_role;
grant execute on function public.get_pending_payment_reservation(uuid) to service_role;
grant execute on function public.attach_stripe_payment_link(uuid,text,text) to service_role;
grant execute on function public.ingest_stripe_event(text,text) to service_role;
grant execute on function public.complete_stripe_payment(text,text) to service_role;

commit;
