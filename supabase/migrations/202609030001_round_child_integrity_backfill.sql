begin;

-- TASK-051 follow-up for environments where the historical child-sync function
-- omitted official_hole_number and distance. rounds.payload remains the source
-- of truth; this migration never updates rounds or its timestamps.
do $$
declare
  prerequisite_blockers bigint;
  invalid_payload_blockers bigint;
  integrity_blockers bigint;
begin
  with expected_constraints(name, source_table, target_table, definition_hash) as (
    values
      ('round_holes_round_user_fkey', 'public.round_holes', 'public.rounds',
        'e3b623f516c684668621ccd632836397'),
      ('round_shots_round_hole_user_fkey', 'public.round_shots', 'public.round_holes',
        '1bf16d147e147d6f71d140b23437af1d'),
      ('club_distance_history_club_user_fkey', 'public.club_distance_history',
        'public.user_clubs', '170720a3019599ad3bc4deb65af12b71')
  ), expected_indexes(name, source_table, definition_hash) as (
    values
      ('rounds_id_user_uidx', 'public.rounds', '0f19e9b0fd53196aa331e7b5adbd7465'),
      ('round_holes_round_hole_user_uidx', 'public.round_holes',
        'b1ebee28c4c609f5fd381a6b1b84f14f'),
      ('user_clubs_id_user_uidx', 'public.user_clubs',
        'df2e9cd4a2f585f8d6760caa7896d819')
  ), exact_constraint_count as (
    select count(*)::integer as value
    from expected_constraints as expected
    join pg_catalog.pg_constraint as constraints on constraints.conname = expected.name
    join pg_catalog.pg_namespace as schemas on schemas.oid = constraints.connamespace
    where schemas.nspname = 'public'
      and constraints.conrelid = pg_catalog.to_regclass(expected.source_table)
      and constraints.confrelid = pg_catalog.to_regclass(expected.target_table)
      and constraints.contype = 'f' and constraints.confdeltype = 'c'
      and constraints.convalidated
      and md5(pg_catalog.pg_get_constraintdef(constraints.oid, false))
        = expected.definition_hash
  ), named_constraint_count as (
    select count(*)::integer as value
    from pg_catalog.pg_constraint as constraints
    join pg_catalog.pg_namespace as schemas on schemas.oid = constraints.connamespace
    where schemas.nspname = 'public'
      and constraints.conname in (select name from expected_constraints)
  ), exact_index_count as (
    select count(*)::integer as value
    from expected_indexes as expected
    join pg_catalog.pg_class as indexes on indexes.relname = expected.name
    join pg_catalog.pg_namespace as schemas on schemas.oid = indexes.relnamespace
    join pg_catalog.pg_index as definitions on definitions.indexrelid = indexes.oid
    where schemas.nspname = 'public'
      and definitions.indrelid = pg_catalog.to_regclass(expected.source_table)
      and definitions.indisunique and definitions.indisvalid and definitions.indisready
      and definitions.indpred is null and definitions.indexprs is null
      and definitions.indnatts = definitions.indnkeyatts
      and md5(pg_catalog.pg_get_indexdef(indexes.oid)) = expected.definition_hash
  ), sync_function_check as (
    select count(*)::integer as value
    from pg_catalog.pg_proc as functions
    join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
    join pg_catalog.pg_language as languages on languages.oid = functions.prolang
    where schemas.nspname = 'public'
      and functions.proname = 'sync_round_children_from_payload'
      and pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
      and functions.prosecdef and languages.lanname = 'plpgsql'
      and functions.proconfig = array['search_path=pg_catalog, public']::text[]
      and md5(pg_catalog.pg_get_functiondef(functions.oid))
        = '055b059c2c323c69234ba1ac2f526c95'
      and (select count(*) from pg_catalog.pg_proc as overloads
        where overloads.pronamespace = schemas.oid
          and overloads.proname = functions.proname) = 1
  ), tombstone_function_check as (
    select count(functions.oid)::integer as named_value,
      count(functions.oid) filter (where
        pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
        and md5(pg_catalog.pg_get_functiondef(functions.oid))
          = expected.definition_hash)::integer as exact_value
    from (values
      ('record_round_tombstone_before_delete', 'eb89388ca6e924490945b3b3cfea423f'),
      ('reject_tombstoned_round_write', '0c86baea5e633a1d5d5982bb212cbb20')
    ) as expected(name, definition_hash)
    join pg_catalog.pg_proc as functions on functions.proname = expected.name
    join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
    where schemas.nspname = 'public'
  ), tombstone_trigger_check as (
    select count(*)::integer as value
    from (values
      ('rounds_00_record_tombstone_before_delete', '8f146f8e85b30643fd57dfb0ad23fbf1'),
      ('rounds_00_reject_tombstoned_write', '1b8785b648e166ce876e4a978adf3a19')
    ) as expected(name, definition_hash)
    join pg_catalog.pg_trigger as triggers on triggers.tgname = expected.name
    where triggers.tgrelid = 'public.rounds'::regclass
      and not triggers.tgisinternal and triggers.tgenabled = 'O'
      and md5(pg_catalog.pg_get_triggerdef(triggers.oid, false)) = expected.definition_hash
  )
  select
    (case when (select value from exact_constraint_count) = 3
      and (select value from named_constraint_count) = 3 then 0 else 1 end)
    + (case when (select value from exact_index_count) = 3 then 0 else 1 end)
    + (case when (select value from sync_function_check) = 1 then 0 else 1 end)
    + (case when not exists (
      select 1 from (values
        ('round_holes', 'INSERT'), ('round_holes', 'UPDATE'), ('round_holes', 'DELETE'),
        ('round_shots', 'INSERT'), ('round_shots', 'UPDATE'), ('round_shots', 'DELETE')
      ) as forbidden(table_name, privilege_name)
      where pg_catalog.has_table_privilege('authenticated',
        pg_catalog.format('public.%I', table_name), privilege_name)
    ) then 0 else 1 end)
    + (case when exists (
      select 1 from pg_catalog.pg_class as tables
      join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
      where schemas.nspname = 'public' and tables.relname = 'round_tombstones'
        and tables.relkind = 'r'
    ) and (select named_value from tombstone_function_check) = 2
      and (select exact_value from tombstone_function_check) = 2
      and (select value from tombstone_trigger_check) = 2 then 0 else 1 end)
    + (case when not exists (
      select 1 from pg_catalog.pg_proc as functions
      join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
      where schemas.nspname = 'public'
        and functions.proname in (
          'calculate_round_stats_from_payload', 'sync_round_summary_from_payload'
        )
    ) and not exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = 'public.rounds'::regclass
        and tgname = 'rounds_sync_summary' and not tgisinternal
    ) then 0 else 1 end)
  into prerequisite_blockers;

  if prerequisite_blockers <> 0 then
    raise exception using
      errcode = '55000',
      message = 'round_child_backfill_prerequisite_blocker';
  end if;

  with holes as (
    select rounds.id as round_id, hole.value, hole.ordinality
    from public.rounds as rounds
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(rounds.payload->'holes') = 'array'
        then rounds.payload->'holes' else '[]'::jsonb end
    ) with ordinality as hole(value, ordinality)
  ), shots as (
    select holes.round_id, holes.value as hole_value, holes.ordinality as hole_ordinality,
      shot.value, shot.ordinality
    from holes
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(holes.value->'shots') = 'array'
        then holes.value->'shots' else '[]'::jsonb end
    ) with ordinality as shot(value, ordinality)
  ), invalid_checks as (
    select count(*)::bigint as violation_count
    from public.rounds
    where payload ? 'holes' and jsonb_typeof(payload->'holes') <> 'array'
    union all
    select count(*)::bigint
    from holes
    where jsonb_typeof(value) <> 'object'
      or (nullif(value->>'holeNumber', '') is not null
        and not pg_catalog.pg_input_is_valid(value->>'holeNumber', 'smallint'))
      or (nullif(value->>'sourceOfficialHole', '') is not null
        and not pg_catalog.pg_input_is_valid(value->>'sourceOfficialHole', 'smallint'))
      or (nullif(value->>'par', '') is not null
        and not pg_catalog.pg_input_is_valid(value->>'par', 'smallint'))
      or (nullif(value->>'distance', '') is not null
        and not pg_catalog.pg_input_is_valid(value->>'distance', 'numeric'))
      or (nullif(value->>'score', '') is not null
        and not pg_catalog.pg_input_is_valid(value->>'score', 'smallint'))
      or (nullif(value->>'swingCount', '') is not null
        and not pg_catalog.pg_input_is_valid(value->>'swingCount', 'smallint'))
      or (nullif(value->>'putts', '') is not null
        and not pg_catalog.pg_input_is_valid(value->>'putts', 'smallint'))
      or (value ? 'shots' and jsonb_typeof(value->'shots') <> 'array')
    union all
    select count(*)::bigint
    from shots
    where jsonb_typeof(value) <> 'object'
      or (nullif(value->>'sequence', '') is not null
        and not pg_catalog.pg_input_is_valid(value->>'sequence', 'smallint'))
      or (nullif(value->>'remainingDistance', '') is not null
        and not pg_catalog.pg_input_is_valid(value->>'remainingDistance', 'numeric'))
  )
  select coalesce(sum(violation_count), 0) into invalid_payload_blockers
  from invalid_checks;

  if invalid_payload_blockers <> 0 then
    raise exception using
      errcode = '22023',
      message = 'round_child_backfill_invalid_payload';
  end if;

  with holes as (
    select rounds.id as round_id, hole.value, hole.ordinality
    from public.rounds as rounds
    cross join lateral jsonb_array_elements(coalesce(rounds.payload->'holes', '[]'::jsonb))
      with ordinality as hole(value, ordinality)
  ), normalized_holes as (
    select round_id,
      coalesce(nullif(value->>'holeNumber', '')::smallint::numeric, ordinality::numeric)
        as hole_number,
      nullif(value->>'par', '')::smallint as par,
      nullif(value->>'distance', '')::numeric as distance,
      nullif(value->>'score', '')::smallint as score,
      nullif(value->>'putts', '')::smallint as putts
    from holes
  ), shots as (
    select holes.round_id,
      coalesce(nullif(holes.value->>'holeNumber', '')::smallint::numeric,
        holes.ordinality::numeric) as hole_number,
      coalesce(nullif(shot.value->>'sequence', '')::smallint::numeric,
        shot.ordinality::numeric) as shot_sequence,
      nullif(shot.value->>'remainingDistance', '')::numeric as remaining_distance
    from holes
    cross join lateral jsonb_array_elements(coalesce(holes.value->'shots', '[]'::jsonb))
      with ordinality as shot(value, ordinality)
  ), invalid_range_or_duplicate_checks as (
    select count(*)::bigint as violation_count from normalized_holes
    where hole_number not between 1 and 18
      or (par is not null and par not between 3 and 6)
      or (distance is not null and distance < 0)
      or (score is not null and score < 0)
      or (putts is not null and putts < 0)
    union all
    select count(*)::bigint from shots
    where shot_sequence not between 1 and 32767
      or (remaining_distance is not null and remaining_distance < 0)
    union all
    select count(*)::bigint from (
      select round_id, hole_number from normalized_holes
      group by round_id, hole_number having count(*) > 1
    ) as duplicate_holes
    union all
    select count(*)::bigint from (
      select round_id, hole_number, shot_sequence from shots
      group by round_id, hole_number, shot_sequence having count(*) > 1
    ) as duplicate_shots
  )
  select coalesce(sum(violation_count), 0) into invalid_payload_blockers
  from invalid_range_or_duplicate_checks;

  if invalid_payload_blockers <> 0 then
    raise exception using
      errcode = '22023',
      message = 'round_child_backfill_ambiguous_payload';
  end if;

  with expected_holes as (
    select rounds.id as round_id,
      coalesce(nullif(hole.value->>'holeNumber', '')::smallint,
        hole.ordinality::smallint) as hole_number
    from public.rounds as rounds
    cross join lateral jsonb_array_elements(coalesce(rounds.payload->'holes', '[]'::jsonb))
      with ordinality as hole(value, ordinality)
  ), expected_shots as (
    select expected_holes.round_id, expected_holes.hole_number,
      coalesce(nullif(shot.value->>'sequence', '')::smallint,
        shot.ordinality::smallint) as shot_sequence
    from public.rounds as rounds
    cross join lateral jsonb_array_elements(coalesce(rounds.payload->'holes', '[]'::jsonb))
      with ordinality as hole(value, ordinality)
    join expected_holes
      on expected_holes.round_id = rounds.id
     and expected_holes.hole_number = coalesce(nullif(hole.value->>'holeNumber', '')::smallint,
       hole.ordinality::smallint)
    cross join lateral jsonb_array_elements(coalesce(hole.value->'shots', '[]'::jsonb))
      with ordinality as shot(value, ordinality)
  ), integrity_checks as (
    select count(*)::bigint as violation_count
    from public.round_holes as holes
    left join public.rounds as rounds on rounds.id = holes.round_id
    where rounds.id is null or holes.user_id <> rounds.user_id
    union all
    select count(*)::bigint
    from public.round_shots as shots
    left join public.round_holes as holes
      on holes.round_id = shots.round_id and holes.hole_number = shots.hole_number
    where holes.round_id is null or shots.user_id <> holes.user_id
    union all
    select count(*)::bigint
    from public.club_distance_history as distances
    left join public.user_clubs as clubs on clubs.id = distances.club_id
    where clubs.id is null or distances.user_id <> clubs.user_id
    union all
    select count(*)::bigint
    from public.rounds as rounds
    join public.round_tombstones as tombstones on tombstones.round_id = rounds.id
    union all
    select count(*)::bigint
    from public.rounds as rounds
    where (select count(*) from public.round_holes where round_id = rounds.id)
      <> jsonb_array_length(coalesce(rounds.payload->'holes', '[]'::jsonb))
    union all
    select count(*)::bigint
    from public.rounds as rounds
    where (select count(*) from public.round_shots where round_id = rounds.id)
      <> (select coalesce(sum(jsonb_array_length(coalesce(hole.value->'shots', '[]'::jsonb))), 0)
        from jsonb_array_elements(coalesce(rounds.payload->'holes', '[]'::jsonb)) as hole(value))
    union all
    select count(*)::bigint
    from expected_holes
    full join public.round_holes as actual using (round_id, hole_number)
    where expected_holes.round_id is null or actual.round_id is null
    union all
    select count(*)::bigint
    from expected_shots
    full join public.round_shots as actual using (round_id, hole_number, shot_sequence)
    where expected_shots.round_id is null or actual.round_id is null
  )
  select coalesce(sum(violation_count), 0) into integrity_blockers
  from integrity_checks;

  if integrity_blockers <> 0 then
    raise exception using
      errcode = '23514',
      message = 'round_child_backfill_integrity_blocker';
  end if;
end;
$$;

create temporary table round_child_backfill_targets (
  round_id text primary key
) on commit drop;

insert into pg_temp.round_child_backfill_targets (round_id)
select distinct expected.round_id
from public.rounds as rounds
cross join lateral jsonb_array_elements(coalesce(rounds.payload->'holes', '[]'::jsonb))
  with ordinality as hole(value, ordinality)
cross join lateral (values (
  rounds.id,
  coalesce(nullif(hole.value->>'holeNumber', '')::smallint, hole.ordinality::smallint),
  nullif(hole.value->>'sourceOfficialHole', '')::smallint,
  nullif(hole.value->>'distance', '')::numeric
)) as expected(round_id, hole_number, official_hole_number, distance)
join public.round_holes as actual
  on actual.round_id = expected.round_id and actual.hole_number = expected.hole_number
where actual.official_hole_number is distinct from expected.official_hole_number
   or actual.distance is distinct from expected.distance;

-- Serialize writes to target source rows so an in-flight client save cannot
-- interleave between target capture and child regeneration. No row values are
-- emitted by this lock step.
do $$
begin
  perform 1
  from public.rounds as rounds
  join pg_temp.round_child_backfill_targets as targets on targets.round_id = rounds.id
  order by rounds.id
  for update of rounds;
end;
$$;

delete from public.round_shots
where round_id in (select round_id from pg_temp.round_child_backfill_targets);

delete from public.round_holes
where round_id in (select round_id from pg_temp.round_child_backfill_targets);

insert into public.round_holes (
  round_id, user_id, hole_number, official_hole_number, par, distance,
  score, swing_count, putts, payload, updated_at
)
select
  rounds.id,
  rounds.user_id,
  coalesce(nullif(hole.value->>'holeNumber', '')::smallint, hole.ordinality::smallint),
  nullif(hole.value->>'sourceOfficialHole', '')::smallint,
  nullif(hole.value->>'par', '')::smallint,
  nullif(hole.value->>'distance', '')::numeric,
  nullif(hole.value->>'score', '')::smallint,
  nullif(hole.value->>'swingCount', '')::smallint,
  nullif(hole.value->>'putts', '')::smallint,
  hole.value,
  rounds.updated_at
from public.rounds as rounds
join pg_temp.round_child_backfill_targets as targets on targets.round_id = rounds.id
cross join lateral jsonb_array_elements(coalesce(rounds.payload->'holes', '[]'::jsonb))
  with ordinality as hole(value, ordinality);

insert into public.round_shots (
  round_id, hole_number, user_id, shot_sequence, club, club_client_id,
  club_snapshot, remaining_distance, trouble_direction, trouble_type,
  ob_relief, payload, updated_at
)
select
  rounds.id,
  coalesce(nullif(hole.value->>'holeNumber', '')::smallint, hole.ordinality::smallint),
  rounds.user_id,
  coalesce(nullif(shot.value->>'sequence', '')::smallint, shot.ordinality::smallint),
  nullif(shot.value->>'club', ''),
  nullif(shot.value->>'clubId', ''),
  case when jsonb_typeof(shot.value->'clubSnapshot') = 'object'
    then shot.value->'clubSnapshot' else null end,
  nullif(shot.value->>'remainingDistance', '')::numeric,
  nullif(shot.value->>'troubleDirection', ''),
  nullif(shot.value->>'troubleType', ''),
  nullif(shot.value->>'obRelief', ''),
  shot.value,
  rounds.updated_at
from public.rounds as rounds
join pg_temp.round_child_backfill_targets as targets on targets.round_id = rounds.id
cross join lateral jsonb_array_elements(coalesce(rounds.payload->'holes', '[]'::jsonb))
  with ordinality as hole(value, ordinality)
cross join lateral jsonb_array_elements(coalesce(hole.value->'shots', '[]'::jsonb))
  with ordinality as shot(value, ordinality);

do $$
begin
  if exists (
    select 1
    from public.rounds as rounds
    cross join lateral jsonb_array_elements(coalesce(rounds.payload->'holes', '[]'::jsonb))
      with ordinality as hole(value, ordinality)
    join public.round_holes as actual
      on actual.round_id = rounds.id
     and actual.hole_number = coalesce(nullif(hole.value->>'holeNumber', '')::smallint,
       hole.ordinality::smallint)
    where actual.official_hole_number
        is distinct from nullif(hole.value->>'sourceOfficialHole', '')::smallint
       or actual.distance is distinct from nullif(hole.value->>'distance', '')::numeric
  ) then
    raise exception using
      errcode = '23514',
      message = 'round_child_backfill_postcondition_failed';
  end if;
end;
$$;

commit;
