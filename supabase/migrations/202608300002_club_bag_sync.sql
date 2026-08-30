alter table public.user_clubs
  add column if not exists client_id text,
  add column if not exists payload jsonb not null default '{}'::jsonb;

update public.user_clubs
set client_id = id::text
where client_id is null;

alter table public.user_clubs
  alter column client_id set not null;

alter table public.user_clubs
  drop constraint if exists user_clubs_user_id_name_key;

create unique index if not exists user_clubs_user_client_id_uidx
  on public.user_clubs(user_id, client_id);

alter table public.club_distance_history
  add column if not exists set_id text,
  add column if not exists distance_basis text,
  add column if not exists normalized_distance_m numeric,
  add column if not exists club_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists is_changed boolean not null default false;

update public.club_distance_history
set set_id = id::text
where set_id is null;

alter table public.club_distance_history
  alter column set_id set not null,
  alter column distance drop not null;

alter table public.club_distance_history
  drop constraint if exists club_distance_history_distance_basis_check;

alter table public.club_distance_history
  add constraint club_distance_history_distance_basis_check
  check (distance_basis is null or distance_basis in ('carry', 'total'));

create unique index if not exists club_distance_user_set_club_uidx
  on public.club_distance_history(user_id, set_id, club_id);
