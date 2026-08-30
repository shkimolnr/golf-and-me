alter table public.profiles
  add column if not exists default_distance_unit text not null default 'M'
  check (default_distance_unit in ('M', 'YD'));
