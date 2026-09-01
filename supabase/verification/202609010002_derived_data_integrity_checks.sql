-- Run the first result set before applying the migration. Every count must be 0.
select 'round_holes_owner_mismatch' as check_name, count(*) as violation_count
from public.round_holes as holes
join public.rounds as rounds on rounds.id = holes.round_id
where holes.user_id <> rounds.user_id
union all
select 'round_shots_owner_mismatch', count(*)
from public.round_shots as shots
join public.round_holes as holes
  on holes.round_id = shots.round_id
 and holes.hole_number = shots.hole_number
where shots.user_id <> holes.user_id
union all
select 'club_distance_owner_mismatch', count(*)
from public.club_distance_history as distances
join public.user_clubs as clubs on clubs.id = distances.club_id
where distances.user_id <> clubs.user_id;

-- Run after applying the migration. All three constraints must be validated.
select
  constraint_name,
  validated
from (
  select conname as constraint_name, convalidated as validated
  from pg_catalog.pg_constraint
  where conrelid in (
    'public.round_holes'::regclass,
    'public.round_shots'::regclass,
    'public.club_distance_history'::regclass
  )
) as constraints
where constraint_name in (
  'round_holes_round_user_fkey',
  'round_shots_round_hole_user_fkey',
  'club_distance_history_club_user_fkey'
)
order by constraint_name;

-- Authenticated users must have SELECT only on the derived tables.
select
  table_name,
  privilege_type
from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_schema = 'public'
  and table_name in ('round_holes', 'round_shots')
order by table_name, privilege_type;
