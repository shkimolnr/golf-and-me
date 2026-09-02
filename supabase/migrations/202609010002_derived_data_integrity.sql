begin;

-- The payload on public.rounds is the source of truth. These redundant unique
-- indexes let the child foreign keys enforce that every derived row belongs to
-- the same user as its parent without changing existing primary keys.
create unique index if not exists rounds_id_user_uidx
  on public.rounds (id, user_id);
create unique index if not exists round_holes_round_hole_user_uidx
  on public.round_holes (round_id, hole_number, user_id);
create unique index if not exists user_clubs_id_user_uidx
  on public.user_clubs (id, user_id);

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'round_holes_round_user_fkey'
      and conrelid = 'public.round_holes'::regclass
  ) then
    alter table public.round_holes
      add constraint round_holes_round_user_fkey
      foreign key (round_id, user_id)
      references public.rounds (id, user_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'round_shots_round_hole_user_fkey'
      and conrelid = 'public.round_shots'::regclass
  ) then
    alter table public.round_shots
      add constraint round_shots_round_hole_user_fkey
      foreign key (round_id, hole_number, user_id)
      references public.round_holes (round_id, hole_number, user_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'club_distance_history_club_user_fkey'
      and conrelid = 'public.club_distance_history'::regclass
  ) then
    alter table public.club_distance_history
      add constraint club_distance_history_club_user_fkey
      foreign key (club_id, user_id)
      references public.user_clubs (id, user_id)
      on delete cascade
      not valid;
  end if;
end;
$$;

-- NOT VALID avoids an unbounded validation scan while each constraint is
-- installed. Validation still occurs in this transaction before any privilege
-- change; an ownership mismatch aborts the migration without deleting data.
alter table public.round_holes
  validate constraint round_holes_round_user_fkey;
alter table public.round_shots
  validate constraint round_shots_round_hole_user_fkey;
alter table public.club_distance_history
  validate constraint club_distance_history_club_user_fkey;

-- Keep the function complete even when a new environment replays migrations.
alter table public.round_holes
  add column if not exists swing_count smallint;

create or replace function public.sync_round_children_from_payload()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.round_shots where round_id = new.id;
  delete from public.round_holes where round_id = new.id;

  insert into public.round_holes (
    round_id, user_id, hole_number, official_hole_number, par, distance,
    score, swing_count, putts, payload, updated_at
  )
  select
    new.id,
    new.user_id,
    coalesce(nullif(hole.value->>'holeNumber', '')::smallint, hole.ordinality::smallint),
    nullif(hole.value->>'sourceOfficialHole', '')::smallint,
    nullif(hole.value->>'par', '')::smallint,
    nullif(hole.value->>'distance', '')::numeric,
    nullif(hole.value->>'score', '')::smallint,
    nullif(hole.value->>'swingCount', '')::smallint,
    nullif(hole.value->>'putts', '')::smallint,
    hole.value,
    new.updated_at
  from jsonb_array_elements(coalesce(new.payload->'holes', '[]'::jsonb))
    with ordinality as hole(value, ordinality);

  insert into public.round_shots (
    round_id, hole_number, user_id, shot_sequence, club, club_client_id,
    club_snapshot, remaining_distance, trouble_direction, trouble_type,
    ob_relief, payload, updated_at
  )
  select
    new.id,
    coalesce(nullif(hole.value->>'holeNumber', '')::smallint, hole.ordinality::smallint),
    new.user_id,
    coalesce(nullif(shot.value->>'sequence', '')::smallint, shot.ordinality::smallint),
    nullif(shot.value->>'club', ''),
    nullif(shot.value->>'clubId', ''),
    case
      when jsonb_typeof(shot.value->'clubSnapshot') = 'object'
        then shot.value->'clubSnapshot'
      else null
    end,
    nullif(shot.value->>'remainingDistance', '')::numeric,
    nullif(shot.value->>'troubleDirection', ''),
    nullif(shot.value->>'troubleType', ''),
    nullif(shot.value->>'obRelief', ''),
    shot.value,
    new.updated_at
  from jsonb_array_elements(coalesce(new.payload->'holes', '[]'::jsonb))
    with ordinality as hole(value, ordinality)
  cross join lateral jsonb_array_elements(coalesce(hole.value->'shots', '[]'::jsonb))
    with ordinality as shot(value, ordinality);

  return new;
end;
$$;

-- The browser writes only public.rounds. Its trigger recreates these derived
-- rows under the migration owner's privileges; authenticated users retain
-- owner-filtered SELECT but cannot make the cache diverge through direct DML.
revoke insert, update, delete on table
  public.round_holes,
  public.round_shots
from authenticated;

commit;
