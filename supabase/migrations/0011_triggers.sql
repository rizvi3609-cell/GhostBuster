begin;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  new.updated_at = now();
  return new;
end
$function$;

drop trigger if exists t_patients_touch on public.patients;
create trigger t_patients_touch
  before update on public.patients
  for each row execute function public.touch_updated_at();

drop trigger if exists t_campaigns_touch on public.broadcast_campaigns;
create trigger t_campaigns_touch
  before update on public.broadcast_campaigns
  for each row execute function public.touch_updated_at();

drop trigger if exists t_sms_touch on public.sms_logs;
create trigger t_sms_touch
  before update on public.sms_logs
  for each row execute function public.touch_updated_at();

commit;
