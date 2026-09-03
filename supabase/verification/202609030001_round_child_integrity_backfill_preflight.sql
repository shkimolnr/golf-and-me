-- READ ONLY gate for 202609030001_round_child_integrity_backfill.sql.
-- Returns aggregate counts and catalog status only, never application row values.

begin transaction read only;

with
prerequisite_checks as (
  select
    (select count(*) from pg_catalog.pg_constraint
      where conname in (
        'round_holes_round_user_fkey',
        'round_shots_round_hole_user_fkey',
        'club_distance_history_club_user_fkey'
      ) and convalidated)::integer as validated_constraint_count,
    (select count(*) from pg_catalog.pg_indexes
      where schemaname = 'public' and indexname in (
        'rounds_id_user_uidx',
        'round_holes_round_hole_user_uidx',
        'user_clubs_id_user_uidx'
      ))::integer as target_index_count,
    (select count(*) from pg_catalog.pg_proc as functions
      join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
      join pg_catalog.pg_language as languages on languages.oid = functions.prolang
      where schemas.nspname = 'public'
        and functions.proname = 'sync_round_children_from_payload'
        and pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
        and functions.prosecdef
        and languages.lanname = 'plpgsql'
        and coalesce(functions.proconfig, array[]::text[])
          = array['search_path=pg_catalog, public']::text[])::integer
      as sync_function_count,
    (select count(*) from (values
      ('round_holes', 'INSERT'), ('round_holes', 'UPDATE'), ('round_holes', 'DELETE'),
      ('round_shots', 'INSERT'), ('round_shots', 'UPDATE'), ('round_shots', 'DELETE')
    ) as forbidden(table_name, privilege_name)
    where pg_catalog.has_table_privilege('authenticated',
      pg_catalog.format('public.%I', table_name), privilege_name))::integer
      as forbidden_child_dml_count,
    (pg_catalog.to_regclass('public.round_tombstones') is not null) as tombstone_table_exists
),
holes as (
  select rounds.id as round_id, hole.value, hole.ordinality
  from public.rounds as rounds
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(rounds.payload->'holes') = 'array'
      then rounds.payload->'holes' else '[]'::jsonb end
  ) with ordinality as hole(value, ordinality)
),
shots as (
  select holes.round_id, holes.value as hole_value, holes.ordinality as hole_ordinality,
    shot.value, shot.ordinality
  from holes
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(holes.value->'shots') = 'array'
      then holes.value->'shots' else '[]'::jsonb end
  ) with ordinality as shot(value, ordinality)
),
invalid_payload_checks as (
  select 'invalid_holes_container' as check_name, count(*)::bigint as violation_count
  from public.rounds
  where payload ? 'holes' and jsonb_typeof(payload->'holes') <> 'array'
  union all
  select 'invalid_hole_scalar', count(*)::bigint
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
  select 'invalid_shot_scalar', count(*)::bigint
  from shots
  where jsonb_typeof(value) <> 'object'
    or (nullif(value->>'sequence', '') is not null
      and not pg_catalog.pg_input_is_valid(value->>'sequence', 'smallint'))
    or (nullif(value->>'remainingDistance', '') is not null
      and not pg_catalog.pg_input_is_valid(value->>'remainingDistance', 'numeric'))
),
normalized_holes as (
  select round_id,
    case when nullif(value->>'holeNumber', '') is null then ordinality::numeric
      when pg_catalog.pg_input_is_valid(value->>'holeNumber', 'smallint')
        then (value->>'holeNumber')::smallint::numeric end as hole_number,
    case when nullif(value->>'par', '') is not null
      and pg_catalog.pg_input_is_valid(value->>'par', 'smallint')
      then (value->>'par')::smallint end as par,
    case when nullif(value->>'distance', '') is not null
      and pg_catalog.pg_input_is_valid(value->>'distance', 'numeric')
      then (value->>'distance')::numeric end as distance,
    case when nullif(value->>'score', '') is not null
      and pg_catalog.pg_input_is_valid(value->>'score', 'smallint')
      then (value->>'score')::smallint end as score,
    case when nullif(value->>'putts', '') is not null
      and pg_catalog.pg_input_is_valid(value->>'putts', 'smallint')
      then (value->>'putts')::smallint end as putts
  from holes
),
normalized_shots as (
  select round_id,
    case when nullif(hole_value->>'holeNumber', '') is null then hole_ordinality::numeric
      when pg_catalog.pg_input_is_valid(hole_value->>'holeNumber', 'smallint')
        then (hole_value->>'holeNumber')::smallint::numeric end as hole_number,
    case when nullif(value->>'sequence', '') is null then ordinality::numeric
      when pg_catalog.pg_input_is_valid(value->>'sequence', 'smallint')
        then (value->>'sequence')::smallint::numeric end as shot_sequence,
    case when nullif(value->>'remainingDistance', '') is not null
      and pg_catalog.pg_input_is_valid(value->>'remainingDistance', 'numeric')
      then (value->>'remainingDistance')::numeric end as remaining_distance
  from shots
),
ambiguous_payload_checks as (
  select 'invalid_hole_range' as check_name, count(*)::bigint as violation_count
  from normalized_holes
  where hole_number not between 1 and 18
    or (par is not null and par not between 3 and 6)
    or (distance is not null and distance < 0)
    or (score is not null and score < 0)
    or (putts is not null and putts < 0)
  union all
  select 'invalid_shot_range', count(*)::bigint
  from normalized_shots
  where shot_sequence not between 1 and 32767
    or (remaining_distance is not null and remaining_distance < 0)
  union all
  select 'duplicate_hole_key', count(*)::bigint from (
    select round_id, hole_number from normalized_holes
    where hole_number is not null
    group by round_id, hole_number having count(*) > 1
  ) as duplicates
  union all
  select 'duplicate_shot_key', count(*)::bigint from (
    select round_id, hole_number, shot_sequence from normalized_shots
    where hole_number is not null and shot_sequence is not null
    group by round_id, hole_number, shot_sequence having count(*) > 1
  ) as duplicates
),
payload_blocker_checks as (
  select * from invalid_payload_checks
  union all
  select * from ambiguous_payload_checks
),
integrity_checks as (
  select 'round_hole_parent_or_owner' as check_name, count(*)::bigint as violation_count
  from public.round_holes as child
  left join public.rounds as parent on parent.id = child.round_id
  where parent.id is null or parent.user_id <> child.user_id
  union all
  select 'round_shot_parent_or_owner', count(*)::bigint
  from public.round_shots as child
  left join public.round_holes as parent
    on parent.round_id = child.round_id and parent.hole_number = child.hole_number
  where parent.round_id is null or parent.user_id <> child.user_id
  union all
  select 'club_distance_parent_or_owner', count(*)::bigint
  from public.club_distance_history as child
  left join public.user_clubs as parent on parent.id = child.club_id
  where parent.id is null or parent.user_id <> child.user_id
  union all
  select 'tombstone_overlap', count(*)::bigint
  from public.rounds as rounds
  join public.round_tombstones as tombstones on tombstones.round_id = rounds.id
  union all
  select 'round_hole_count_mismatch', count(*)::bigint
  from public.rounds as rounds
  where (select count(*) from public.round_holes where round_id = rounds.id)
    <> case when jsonb_typeof(rounds.payload->'holes') = 'array'
      then jsonb_array_length(rounds.payload->'holes') else 0 end
  union all
  select 'round_shot_count_mismatch', count(*)::bigint
  from public.rounds as rounds
  where (select count(*) from public.round_shots where round_id = rounds.id)
    <> (select coalesce(sum(case when jsonb_typeof(hole.value->'shots') = 'array'
      then jsonb_array_length(hole.value->'shots') else 0 end), 0)
      from jsonb_array_elements(case when jsonb_typeof(rounds.payload->'holes') = 'array'
        then rounds.payload->'holes' else '[]'::jsonb end) as hole(value))
  union all
  select 'round_hole_key_mismatch', count(*)::bigint
  from normalized_holes as expected
  full join public.round_holes as actual
    on actual.round_id = expected.round_id and actual.hole_number = expected.hole_number
  where expected.round_id is null or actual.round_id is null
  union all
  select 'round_shot_key_mismatch', count(*)::bigint
  from normalized_shots as expected
  full join public.round_shots as actual
    on actual.round_id = expected.round_id
   and actual.hole_number = expected.hole_number
   and actual.shot_sequence = expected.shot_sequence
  where expected.round_id is null or actual.round_id is null
),
target_holes as (
  select expected.round_id,
    actual.official_hole_number is distinct from expected.official_hole_number
      as official_hole_mismatch,
    actual.distance is distinct from expected.distance as distance_mismatch
  from (
    select rounds.id as round_id,
      case when nullif(hole.value->>'holeNumber', '') is null then hole.ordinality::numeric
        when pg_catalog.pg_input_is_valid(hole.value->>'holeNumber', 'smallint')
          then (hole.value->>'holeNumber')::smallint::numeric end as hole_number,
      case when nullif(hole.value->>'sourceOfficialHole', '') is not null
        and pg_catalog.pg_input_is_valid(hole.value->>'sourceOfficialHole', 'smallint')
        then (hole.value->>'sourceOfficialHole')::smallint end as official_hole_number,
      case when nullif(hole.value->>'distance', '') is not null
        and pg_catalog.pg_input_is_valid(hole.value->>'distance', 'numeric')
        then (hole.value->>'distance')::numeric end as distance
    from public.rounds as rounds
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(rounds.payload->'holes') = 'array'
        then rounds.payload->'holes' else '[]'::jsonb end
    ) with ordinality as hole(value, ordinality)
  ) as expected
  join public.round_holes as actual
    on actual.round_id = expected.round_id and actual.hole_number = expected.hole_number
  where actual.official_hole_number is distinct from expected.official_hole_number
     or actual.distance is distinct from expected.distance
),
gate as (
  select
    (select case when validated_constraint_count = 3 and target_index_count = 3
      and sync_function_count = 1 and forbidden_child_dml_count = 0
      and tombstone_table_exists then 0 else 1 end from prerequisite_checks)::integer
      as prerequisite_blocker_count,
    (select coalesce(sum(violation_count), 0) from payload_blocker_checks)::bigint
      as invalid_payload_blocker_count,
    (select coalesce(sum(violation_count), 0) from integrity_checks)::bigint
      as integrity_blocker_count,
    (select count(*) from target_holes)::bigint as target_hole_count,
    (select count(distinct round_id) from target_holes)::bigint as target_round_count,
    (select count(*) from target_holes where official_hole_mismatch)::bigint
      as official_hole_count,
    (select count(distinct round_id) from target_holes where official_hole_mismatch)::bigint
      as official_round_count,
    (select count(*) from target_holes where distance_mismatch)::bigint as distance_hole_count,
    (select count(distinct round_id) from target_holes where distance_mismatch)::bigint
      as distance_round_count
)
select jsonb_build_object(
  'formatVersion', 1,
  'targetMigration', '202609030001_round_child_integrity_backfill.sql',
  'gateStatus', case when prerequisite_blocker_count = 0
    and invalid_payload_blocker_count = 0 and integrity_blocker_count = 0
    then 'READY' else 'BLOCKED' end,
  'blockerCounts', jsonb_build_object(
    'prerequisites', prerequisite_blocker_count,
    'invalidPayload', invalid_payload_blocker_count,
    'integrity', integrity_blocker_count
  ),
  'targetCounts', jsonb_build_object(
    'rounds', target_round_count,
    'holes', target_hole_count,
    'officialHoleNumberRounds', official_round_count,
    'officialHoleNumberHoles', official_hole_count,
    'distanceRounds', distance_round_count,
    'distanceHoles', distance_hole_count
  ),
  'prerequisites', (select to_jsonb(prerequisite_checks) from prerequisite_checks),
  'invalidPayloadCounts', (select jsonb_object_agg(check_name, violation_count)
    from payload_blocker_checks),
  'integrityCounts', (select jsonb_object_agg(check_name, violation_count)
    from integrity_checks)
) as round_child_backfill_preflight
from gate;

commit;
