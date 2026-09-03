-- READ ONLY gate for 202609030001_round_child_integrity_backfill.sql.
-- Returns aggregate counts and catalog status only, never application row values.

begin transaction read only;

with
expected_constraints(name, source_table, target_table, definition_hash) as (
  values
    ('round_holes_round_user_fkey', 'public.round_holes', 'public.rounds',
      'e3b623f516c684668621ccd632836397'),
    ('round_shots_round_hole_user_fkey', 'public.round_shots', 'public.round_holes',
      '1bf16d147e147d6f71d140b23437af1d'),
    ('club_distance_history_club_user_fkey', 'public.club_distance_history',
      'public.user_clubs', '170720a3019599ad3bc4deb65af12b71')
),
constraint_checks as (
  select expected.name,
    count(constraints.oid)::integer as named_count,
    count(constraints.oid) filter (where
      constraints.conrelid = pg_catalog.to_regclass(expected.source_table)
      and constraints.confrelid = pg_catalog.to_regclass(expected.target_table)
      and constraints.contype = 'f' and constraints.confdeltype = 'c'
      and constraints.convalidated
      and md5(pg_catalog.pg_get_constraintdef(constraints.oid, false))
        = expected.definition_hash)::integer as exact_count,
    expected.definition_hash as expected_definition_hash,
    min(md5(pg_catalog.pg_get_constraintdef(constraints.oid, false)))
      as actual_definition_hash
  from expected_constraints as expected
  left join pg_catalog.pg_namespace as schemas on schemas.nspname = 'public'
  left join pg_catalog.pg_constraint as constraints
    on constraints.connamespace = schemas.oid and constraints.conname = expected.name
  group by expected.name, expected.source_table, expected.target_table,
    expected.definition_hash
),
expected_indexes(name, source_table, definition_hash) as (
  values
    ('rounds_id_user_uidx', 'public.rounds', '0f19e9b0fd53196aa331e7b5adbd7465'),
    ('round_holes_round_hole_user_uidx', 'public.round_holes',
      'b1ebee28c4c609f5fd381a6b1b84f14f'),
    ('user_clubs_id_user_uidx', 'public.user_clubs',
      'df2e9cd4a2f585f8d6760caa7896d819')
),
index_checks as (
  select expected.name,
    count(indexes.oid)::integer as named_count,
    count(indexes.oid) filter (where
      definitions.indrelid = pg_catalog.to_regclass(expected.source_table)
      and definitions.indisunique and definitions.indisvalid and definitions.indisready
      and definitions.indpred is null and definitions.indexprs is null
      and definitions.indnatts = definitions.indnkeyatts
      and md5(pg_catalog.pg_get_indexdef(indexes.oid)) = expected.definition_hash)::integer
      as exact_count,
    expected.definition_hash as expected_definition_hash,
    min(md5(pg_catalog.pg_get_indexdef(indexes.oid))) as actual_definition_hash
  from expected_indexes as expected
  left join pg_catalog.pg_namespace as schemas on schemas.nspname = 'public'
  left join pg_catalog.pg_class as indexes
    on indexes.relnamespace = schemas.oid and indexes.relname = expected.name
  left join pg_catalog.pg_index as definitions on definitions.indexrelid = indexes.oid
  group by expected.name, expected.source_table, expected.definition_hash
),
sync_function_checks as (
  select count(functions.oid)::integer as named_count,
    count(functions.oid) filter (where
      pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
      and functions.prosecdef and languages.lanname = 'plpgsql'
      and functions.proconfig = array['search_path=pg_catalog, public']::text[]
      and md5(pg_catalog.pg_get_functiondef(functions.oid))
        = '055b059c2c323c69234ba1ac2f526c95')::integer as exact_count,
    '055b059c2c323c69234ba1ac2f526c95'::text as expected_definition_hash,
    min(md5(pg_catalog.pg_get_functiondef(functions.oid))) as actual_definition_hash
  from pg_catalog.pg_namespace as schemas
  left join pg_catalog.pg_proc as functions
    on functions.pronamespace = schemas.oid
   and functions.proname = 'sync_round_children_from_payload'
  left join pg_catalog.pg_language as languages on languages.oid = functions.prolang
  where schemas.nspname = 'public'
),
expected_tombstone_functions(name, definition_hash) as (
  values
    ('record_round_tombstone_before_delete', 'eb89388ca6e924490945b3b3cfea423f'),
    ('reject_tombstoned_round_write', '0c86baea5e633a1d5d5982bb212cbb20')
),
tombstone_function_checks as (
  select expected.name, count(functions.oid)::integer as named_count,
    count(functions.oid) filter (where
      pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
      and md5(pg_catalog.pg_get_functiondef(functions.oid))
        = expected.definition_hash)::integer as exact_count,
    expected.definition_hash as expected_definition_hash,
    min(md5(pg_catalog.pg_get_functiondef(functions.oid))) as actual_definition_hash
  from expected_tombstone_functions as expected
  left join pg_catalog.pg_namespace as schemas on schemas.nspname = 'public'
  left join pg_catalog.pg_proc as functions
    on functions.pronamespace = schemas.oid and functions.proname = expected.name
  group by expected.name, expected.definition_hash
),
expected_tombstone_triggers(name, definition_hash) as (
  values
    ('rounds_00_record_tombstone_before_delete', '8f146f8e85b30643fd57dfb0ad23fbf1'),
    ('rounds_00_reject_tombstoned_write', '1b8785b648e166ce876e4a978adf3a19')
),
tombstone_trigger_checks as (
  select expected.name, count(triggers.oid)::integer as named_count,
    count(triggers.oid) filter (where triggers.tgenabled = 'O'
      and md5(pg_catalog.pg_get_triggerdef(triggers.oid, false))
        = expected.definition_hash)::integer as exact_count,
    expected.definition_hash as expected_definition_hash,
    min(md5(pg_catalog.pg_get_triggerdef(triggers.oid, false))) as actual_definition_hash
  from expected_tombstone_triggers as expected
  left join pg_catalog.pg_trigger as triggers
    on triggers.tgrelid = pg_catalog.to_regclass('public.rounds')
   and triggers.tgname = expected.name and not triggers.tgisinternal
  group by expected.name, expected.definition_hash
),
summary_precedence_check as (
  select
    (select count(*) from pg_catalog.pg_proc as functions
      join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
      where schemas.nspname = 'public'
        and functions.proname in (
          'calculate_round_stats_from_payload', 'sync_round_summary_from_payload'
        ))::integer as known_function_count,
    (select count(*) from pg_catalog.pg_trigger
      where tgrelid = pg_catalog.to_regclass('public.rounds')
        and tgname = 'rounds_sync_summary' and not tgisinternal)::integer
      as known_trigger_count
),
prerequisite_checks as (
  select
    (select count(*) from constraint_checks
      where named_count = 1 and exact_count = 1)::integer as exact_constraint_count,
    (select count(*) from index_checks
      where named_count = 1 and exact_count = 1)::integer as exact_index_count,
    (select exact_count from sync_function_checks
      where named_count = 1)::integer as exact_sync_function_count,
    (select count(*) from tombstone_function_checks
      where named_count = 1 and exact_count = 1)::integer as exact_tombstone_function_count,
    (select count(*) from tombstone_trigger_checks
      where named_count = 1 and exact_count = 1)::integer as exact_tombstone_trigger_count,
    (select count(*) from (values
      ('round_holes', 'INSERT'), ('round_holes', 'UPDATE'), ('round_holes', 'DELETE'),
      ('round_shots', 'INSERT'), ('round_shots', 'UPDATE'), ('round_shots', 'DELETE')
    ) as forbidden(table_name, privilege_name)
    where pg_catalog.has_table_privilege('authenticated',
      pg_catalog.format('public.%I', table_name), privilege_name))::integer
      as forbidden_child_dml_count,
    exists (select 1 from pg_catalog.pg_class as tables
      join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
      where schemas.nspname = 'public' and tables.relname = 'round_tombstones'
        and tables.relkind = 'r') as tombstone_table_exact,
    (select known_function_count + known_trigger_count from summary_precedence_check)::integer
      as summary_precedence_object_count
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
    (select case when exact_constraint_count = 3 and exact_index_count = 3
      and exact_sync_function_count = 1 and forbidden_child_dml_count = 0
      and tombstone_table_exact and exact_tombstone_function_count = 2
      and exact_tombstone_trigger_count = 2 and summary_precedence_object_count = 0
      then 0 else 1 end from prerequisite_checks)::integer
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
  'catalogChecks', jsonb_build_object(
    'constraints', (select jsonb_agg(to_jsonb(constraint_checks) order by name)
      from constraint_checks),
    'indexes', (select jsonb_agg(to_jsonb(index_checks) order by name)
      from index_checks),
    'syncFunction', (select to_jsonb(sync_function_checks) from sync_function_checks),
    'tombstoneFunctions', (select jsonb_agg(to_jsonb(tombstone_function_checks) order by name)
      from tombstone_function_checks),
    'tombstoneTriggers', (select jsonb_agg(to_jsonb(tombstone_trigger_checks) order by name)
      from tombstone_trigger_checks),
    'summaryPrecedence', (select to_jsonb(summary_precedence_check)
      from summary_precedence_check)
  ),
  'invalidPayloadCounts', (select jsonb_object_agg(check_name, violation_count)
    from payload_blocker_checks),
  'integrityCounts', (select jsonb_object_agg(check_name, violation_count)
    from integrity_checks)
) as round_child_backfill_preflight
from gate;

commit;
