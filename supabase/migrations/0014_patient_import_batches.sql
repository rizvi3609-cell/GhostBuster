begin;

create table if not exists public.import_batch_chunks (
  import_batch_id uuid not null
    references public.import_batches(id) on delete cascade,
  batch_number int not null check (batch_number >= 0),
  row_count int not null check (row_count between 1 and 500),
  inserted_count int not null check (inserted_count >= 0),
  updated_count int not null check (updated_count >= 0),
  skipped_count int not null check (skipped_count >= 0),
  created_at timestamptz not null default now(),
  primary key (import_batch_id, batch_number)
);

alter table public.import_batch_chunks enable row level security;

revoke all privileges on public.import_batch_chunks from anon, authenticated;
grant select, insert, update, delete on public.import_batch_chunks to service_role;

create or replace function public.import_patient_batch(
  p_import_batch_id uuid,
  p_imported_by uuid,
  p_batch_number int,
  p_rows jsonb
) returns table (
  inserted_count int,
  updated_count int,
  skipped_count int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_chunk public.import_batch_chunks;
  v_inserted int;
  v_updated int;
  v_row_count int;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Import batch rows must be a JSON array';
  end if;

  v_row_count := jsonb_array_length(p_rows);
  if v_row_count < 1 or v_row_count > 500 then
    raise exception 'Import batch must contain between 1 and 500 rows';
  end if;

  perform 1
    from public.import_batches b
   where b.id = p_import_batch_id
     and b.imported_by = p_imported_by
   for update;

  if not found then
    raise exception 'Import batch not found';
  end if;

  select c.*
    into v_chunk
    from public.import_batch_chunks c
   where c.import_batch_id = p_import_batch_id
     and c.batch_number = p_batch_number;

  if found then
    return query
      select v_chunk.inserted_count, v_chunk.updated_count, v_chunk.skipped_count;
    return;
  end if;

  select count(*), count(distinct row_data.phone_number)
    into v_row_count, v_updated
    from jsonb_to_recordset(p_rows) as row_data(phone_number text);

  if v_row_count <> v_updated then
    raise exception 'Import batch contains duplicate phone numbers';
  end if;

  with input_rows as materialized (
    select
      row_data.full_name,
      row_data.phone_number,
      row_data.last_visit_date,
      coalesce(row_data.preferred_procedures, '{}') as preferred_procedures
    from jsonb_to_recordset(p_rows) as row_data(
      full_name text,
      phone_number text,
      last_visit_date date,
      preferred_procedures text[]
    )
  ),
  existing_rows as materialized (
    select i.phone_number
      from input_rows i
      join public.patients p on p.phone_number = i.phone_number
  ),
  upserted_rows as (
    insert into public.patients (
      full_name,
      phone_number,
      last_visit_date,
      preferred_procedures
    )
    select
      i.full_name,
      i.phone_number,
      i.last_visit_date,
      i.preferred_procedures
    from input_rows i
    on conflict (phone_number) do update
      set full_name = excluded.full_name,
          last_visit_date = excluded.last_visit_date,
          preferred_procedures = excluded.preferred_procedures,
          updated_at = now()
    returning phone_number
  )
  select
    count(*)::int - (select count(*)::int from existing_rows),
    (select count(*)::int from existing_rows)
    into v_inserted, v_updated
    from upserted_rows;

  insert into public.import_batch_chunks (
    import_batch_id,
    batch_number,
    row_count,
    inserted_count,
    updated_count,
    skipped_count
  ) values (
    p_import_batch_id,
    p_batch_number,
    v_row_count,
    v_inserted,
    v_updated,
    0
  );

  update public.import_batches b
     set inserted_count = b.inserted_count + v_inserted,
         updated_count = b.updated_count + v_updated
   where b.id = p_import_batch_id;

  return query select v_inserted, v_updated, 0;
end
$function$;

create or replace function public.finalize_patient_import(
  p_import_batch_id uuid,
  p_imported_by uuid
) returns table (
  row_count int,
  inserted_count int,
  updated_count int,
  skipped_count int,
  invalid_count int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_batch public.import_batches;
begin
  select b.*
    into v_batch
    from public.import_batches b
   where b.id = p_import_batch_id
     and b.imported_by = p_imported_by
   for update;

  if not found then
    raise exception 'Import batch not found';
  end if;

  if v_batch.row_count <>
     v_batch.inserted_count + v_batch.updated_count +
     v_batch.skipped_count + v_batch.invalid_count then
    raise exception 'Import batch is incomplete';
  end if;

  if not exists (
    select 1
      from public.audit_events e
     where e.event_type = 'CSV_IMPORTED'
       and e.entity_type = 'import_batch'
       and e.entity_id = p_import_batch_id
  ) then
    insert into public.audit_events (
      actor_type,
      actor_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      'STAFF',
      p_imported_by,
      'CSV_IMPORTED',
      'import_batch',
      p_import_batch_id,
      jsonb_build_object(
        'row_count', v_batch.row_count,
        'inserted_count', v_batch.inserted_count,
        'updated_count', v_batch.updated_count,
        'skipped_count', v_batch.skipped_count,
        'invalid_count', v_batch.invalid_count
      )
    );
  end if;

  return query
    select
      v_batch.row_count,
      v_batch.inserted_count,
      v_batch.updated_count,
      v_batch.skipped_count,
      v_batch.invalid_count;
end
$function$;

revoke execute on function public.import_patient_batch(uuid, uuid, int, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_patient_batch(uuid, uuid, int, jsonb)
  to service_role;

revoke execute on function public.finalize_patient_import(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_patient_import(uuid, uuid)
  to service_role;

commit;
