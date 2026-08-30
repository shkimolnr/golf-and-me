begin;

alter table public.round_shots
  add column if not exists club_client_id text,
  add column if not exists club_snapshot jsonb;

create or replace function public.sync_round_children_from_payload()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.round_shots where round_id = new.id;
  delete from public.round_holes where round_id = new.id;

  insert into public.round_holes (
    round_id, hole_number, user_id, par, score, swing_count, putts,
    payload, updated_at
  )
  select
    new.id,
    coalesce(nullif(hole.value->>'holeNumber', '')::smallint, hole.ordinality::smallint),
    new.user_id,
    nullif(hole.value->>'par', '')::smallint,
    nullif(hole.value->>'score', '')::smallint,
    nullif(hole.value->>'swingCount', '')::smallint,
    nullif(hole.value->>'putts', '')::smallint,
    hole.value,
    new.updated_at
  from jsonb_array_elements(coalesce(new.payload->'holes', '[]'::jsonb)) with ordinality as hole(value, ordinality);

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
    case when jsonb_typeof(shot.value->'clubSnapshot') = 'object' then shot.value->'clubSnapshot' else null end,
    nullif(shot.value->>'remainingDistance', '')::numeric,
    nullif(shot.value->>'troubleDirection', ''),
    nullif(shot.value->>'troubleType', ''),
    nullif(shot.value->>'obRelief', ''),
    shot.value,
    new.updated_at
  from jsonb_array_elements(coalesce(new.payload->'holes', '[]'::jsonb)) with ordinality as hole(value, ordinality)
  cross join lateral jsonb_array_elements(coalesce(hole.value->'shots', '[]'::jsonb)) with ordinality as shot(value, ordinality);

  return new;
end;
$$;

commit;
