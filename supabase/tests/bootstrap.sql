-- Local integration-test compatibility for the Supabase-managed auth schema and roles.
-- Run only against a disposable database.

do $bootstrap$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$bootstrap$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  created_at timestamptz not null default now()
);

do $bootstrap$
begin
  if to_regprocedure('auth.uid()') is null then
    execute $sql$
      create function auth.uid()
      returns uuid
      language sql
      stable
      as $function$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $function$
    $sql$;
  end if;
end
$bootstrap$;

grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
