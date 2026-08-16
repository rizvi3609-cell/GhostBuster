begin;

create table if not exists public.clinic_config (
  id boolean primary key default true,
  clinic_name text not null,
  timezone text not null default 'America/New_York',
  quiet_hours_start time not null default '08:00',
  quiet_hours_end time not null default '20:00',
  max_messages_per_week int not null default 3,
  estimated_chair_value numeric(10,2) not null default 350.00,
  recall_threshold_days int not null default 180,
  recall_cooldown_days int not null default 30,
  review_delay_hours int not null default 4,
  default_wave_plan jsonb not null default
    '[{"size":3,"delay_min":7},{"size":5,"delay_min":7},{"size":10,"delay_min":10}]',
  automation_paused boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint single_row check (id)
);

create table if not exists public.staff (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role public.staff_role not null default 'FRONT_DESK',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

commit;
