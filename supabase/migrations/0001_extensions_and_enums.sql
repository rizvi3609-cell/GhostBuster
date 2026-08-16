begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

do $migration$
begin
  if to_regtype('public.consent_status') is null then
    create type public.consent_status as enum ('UNKNOWN', 'GRANTED', 'REVOKED');
  end if;

  if to_regtype('public.campaign_status') is null then
    create type public.campaign_status as enum (
      'DRAFT',
      'OPEN',
      'ESCALATING',
      'PENDING_PAYMENT',
      'FILLED',
      'EXPIRED',
      'CANCELLED'
    );
  end if;

  if to_regtype('public.send_status') is null then
    create type public.send_status as enum ('PENDING', 'SENT', 'FAILED', 'SKIPPED');
  end if;

  if to_regtype('public.sms_status') is null then
    create type public.sms_status as enum (
      'QUEUED',
      'SENT',
      'DELIVERED',
      'UNDELIVERED',
      'FAILED',
      'RECEIVED'
    );
  end if;

  if to_regtype('public.sms_direction') is null then
    create type public.sms_direction as enum ('OUTBOUND', 'INBOUND');
  end if;

  if to_regtype('public.inbox_status') is null then
    create type public.inbox_status as enum ('UNREAD', 'OPEN', 'RESOLVED');
  end if;

  if to_regtype('public.staff_role') is null then
    create type public.staff_role as enum ('OWNER', 'ADMIN', 'FRONT_DESK');
  end if;
end
$migration$;

commit;
