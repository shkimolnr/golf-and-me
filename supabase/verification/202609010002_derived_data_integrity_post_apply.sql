-- Post-apply verification for migration 202609010002.
-- Returns catalog metadata and aggregate counts only; never application row values.

begin transaction read only;

with
entity_counts(check_name, row_count) as (
  select 'rounds', count(*)::bigint from public.rounds
  union all select 'round_holes', count(*)::bigint from public.round_holes
  union all select 'round_shots', count(*)::bigint from public.round_shots
  union all select 'round_tombstones', count(*)::bigint from public.round_tombstones
),
data_integrity_checks(check_name, violation_count) as (
  select 'round_holes_parent_orphan', count(*)::bigint
  from public.round_holes as holes
  left join public.rounds as rounds on rounds.id = holes.round_id
  where rounds.id is null
  union all
  select 'round_shots_parent_orphan', count(*)::bigint
  from public.round_shots as shots
  left join public.round_holes as holes
    on holes.round_id = shots.round_id and holes.hole_number = shots.hole_number
  where holes.round_id is null
  union all
  select 'club_distance_parent_orphan', count(*)::bigint
  from public.club_distance_history as distances
  left join public.user_clubs as clubs on clubs.id = distances.club_id
  where clubs.id is null
  union all
  select 'round_holes_owner_mismatch', count(*)::bigint
  from public.round_holes as holes
  join public.rounds as rounds on rounds.id = holes.round_id
  where holes.user_id <> rounds.user_id
  union all
  select 'round_shots_owner_mismatch', count(*)::bigint
  from public.round_shots as shots
  join public.round_holes as holes
    on holes.round_id = shots.round_id and holes.hole_number = shots.hole_number
  where shots.user_id <> holes.user_id
  union all
  select 'club_distance_owner_mismatch', count(*)::bigint
  from public.club_distance_history as distances
  join public.user_clubs as clubs on clubs.id = distances.club_id
  where distances.user_id <> clubs.user_id
  union all
  select 'round_tombstone_overlap', count(*)::bigint
  from public.rounds as rounds
  join public.round_tombstones as tombstones on tombstones.round_id = rounds.id
  union all
  select 'invalid_holes_container', count(*)::bigint
  from public.rounds
  where payload ? 'holes' and jsonb_typeof(payload->'holes') <> 'array'
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
    <> (
      select coalesce(sum(case when jsonb_typeof(hole.value->'shots') = 'array'
        then jsonb_array_length(hole.value->'shots') else 0 end), 0)
      from jsonb_array_elements(case when jsonb_typeof(rounds.payload->'holes') = 'array'
        then rounds.payload->'holes' else '[]'::jsonb end) as hole(value)
    )
  union all
  select 'round_hole_field_mismatch', count(*)::bigint
  from public.round_holes as holes
  where exists (
    select 1
    from (values
      (holes.official_hole_number::numeric, holes.payload->'sourceOfficialHole'),
      (holes.distance, holes.payload->'distance'),
      (holes.swing_count::numeric, holes.payload->'swingCount'),
      (holes.score::numeric, holes.payload->'score'),
      (holes.putts::numeric, holes.payload->'putts')
    ) as fields(actual_value, raw_value)
    cross join lateral (
      select
        case
          when fields.raw_value is null
            or jsonb_typeof(fields.raw_value) = 'null'
            or (jsonb_typeof(fields.raw_value) = 'string'
              and fields.raw_value #>> '{}' = '') then null::numeric
          when jsonb_typeof(fields.raw_value) in ('number', 'string')
            and fields.raw_value #>> '{}'
              ~ '^[[:space:]]*[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?[[:space:]]*$'
            then (fields.raw_value #>> '{}')::numeric
          else null::numeric
        end as expected_value,
        not (
          fields.raw_value is null
          or jsonb_typeof(fields.raw_value) = 'null'
          or (jsonb_typeof(fields.raw_value) = 'string'
            and fields.raw_value #>> '{}' = '')
          or (jsonb_typeof(fields.raw_value) in ('number', 'string')
            and fields.raw_value #>> '{}'
              ~ '^[[:space:]]*[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?[[:space:]]*$')
        ) as invalid_value
    ) as normalized
    where normalized.invalid_value
       or fields.actual_value is distinct from normalized.expected_value
  )
  union all
  select 'round_shot_field_mismatch', count(*)::bigint
  from public.round_shots as shots
  where shots.club is distinct from nullif(shots.payload->>'club', '')
     or shots.club_client_id is distinct from nullif(shots.payload->>'clubId', '')
     or shots.club_snapshot is distinct from case
       when jsonb_typeof(shots.payload->'clubSnapshot') = 'object'
         then shots.payload->'clubSnapshot' else null end
     or (
       select normalized.invalid_value
         or shots.remaining_distance is distinct from normalized.expected_value
       from (
         select
           case
             when shots.payload->'remainingDistance' is null
               or jsonb_typeof(shots.payload->'remainingDistance') = 'null'
               or (jsonb_typeof(shots.payload->'remainingDistance') = 'string'
                 and shots.payload->'remainingDistance' #>> '{}' = '') then null::numeric
             when jsonb_typeof(shots.payload->'remainingDistance') in ('number', 'string')
               and shots.payload->'remainingDistance' #>> '{}'
                 ~ '^[[:space:]]*[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?[[:space:]]*$'
               then (shots.payload->'remainingDistance' #>> '{}')::numeric
             else null::numeric
           end as expected_value,
           not (
             shots.payload->'remainingDistance' is null
             or jsonb_typeof(shots.payload->'remainingDistance') = 'null'
             or (jsonb_typeof(shots.payload->'remainingDistance') = 'string'
               and shots.payload->'remainingDistance' #>> '{}' = '')
             or (jsonb_typeof(shots.payload->'remainingDistance') in ('number', 'string')
               and shots.payload->'remainingDistance' #>> '{}'
                 ~ '^[[:space:]]*[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?[[:space:]]*$')
           ) as invalid_value
       ) as normalized
     )
),
index_checks as (
  select
    expected.index_name,
    indexes.indisunique,
    indexes.indisvalid,
    indexes.indisready,
    pg_catalog.pg_get_indexdef(classes.oid) as definition,
    case when classes.oid is not null
      and indexes.indisunique and indexes.indisvalid and indexes.indisready
      then 'present_valid' else 'missing_or_invalid' end as status
  from (values
    ('rounds_id_user_uidx'),
    ('round_holes_round_hole_user_uidx'),
    ('user_clubs_id_user_uidx')
  ) as expected(index_name)
  left join pg_catalog.pg_namespace as schemas on schemas.nspname = 'public'
  left join pg_catalog.pg_class as classes
    on classes.relnamespace = schemas.oid and classes.relname = expected.index_name
  left join pg_catalog.pg_index as indexes on indexes.indexrelid = classes.oid
),
constraint_checks as (
  select
    expected.constraint_name,
    constraints.convalidated,
    pg_catalog.pg_get_constraintdef(constraints.oid, true) as definition,
    case when constraints.oid is not null and constraints.convalidated
      then 'present_validated' else 'missing_or_unvalidated' end as status
  from (values
    ('round_holes_round_user_fkey'),
    ('round_shots_round_hole_user_fkey'),
    ('club_distance_history_club_user_fkey')
  ) as expected(constraint_name)
  left join pg_catalog.pg_constraint as constraints
    on constraints.conname = expected.constraint_name
),
function_check as (
  select
    count(*)::integer as function_count,
    bool_and(functions.prosecdef) as security_definer,
    bool_and(languages.lanname = 'plpgsql') as language_matches,
    bool_and(coalesce(functions.proconfig, array[]::text[])
      = array['search_path=pg_catalog, public']::text[]) as settings_match,
    min(md5(pg_catalog.pg_get_functiondef(functions.oid))) as definition_hash
  from pg_catalog.pg_proc as functions
  join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
  join pg_catalog.pg_language as languages on languages.oid = functions.prolang
  where schemas.nspname = 'public'
    and functions.proname = 'sync_round_children_from_payload'
    and pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
),
trigger_check as (
  select
    count(*)::integer as trigger_count,
    bool_and(triggers.tgenabled = 'O' and triggers.tgtype = 21
      and functions.proname = 'sync_round_children_from_payload') as definition_matches,
    min(md5(pg_catalog.pg_get_triggerdef(triggers.oid, false))) as definition_hash
  from pg_catalog.pg_trigger as triggers
  join pg_catalog.pg_class as tables on tables.oid = triggers.tgrelid
  join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
  join pg_catalog.pg_proc as functions on functions.oid = triggers.tgfoid
  where schemas.nspname = 'public'
    and tables.relname = 'rounds'
    and triggers.tgname = 'rounds_sync_children'
    and not triggers.tgisinternal
),
privilege_checks as (
  select
    (select count(*) from (values
      ('round_holes', 'INSERT'), ('round_holes', 'UPDATE'), ('round_holes', 'DELETE'),
      ('round_shots', 'INSERT'), ('round_shots', 'UPDATE'), ('round_shots', 'DELETE')
    ) as forbidden(table_name, privilege_name)
    where pg_catalog.has_table_privilege('authenticated',
      pg_catalog.format('public.%I', table_name), privilege_name))::integer
      as forbidden_child_dml_count,
    (select count(*) from (values
      ('rounds', 'SELECT'), ('rounds', 'INSERT'), ('rounds', 'UPDATE'), ('rounds', 'DELETE'),
      ('round_holes', 'SELECT'), ('round_shots', 'SELECT')
    ) as required(table_name, privilege_name)
    where not pg_catalog.has_table_privilege('authenticated',
      pg_catalog.format('public.%I', table_name), privilege_name))::integer
      as required_privilege_missing_count
),
tombstone_check as (
  select
    (pg_catalog.to_regclass('public.round_tombstones') is not null) as table_exists,
    (select count(*) from pg_catalog.pg_trigger as triggers
      join pg_catalog.pg_class as tables on tables.oid = triggers.tgrelid
      join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
      where schemas.nspname = 'public' and tables.relname = 'rounds'
        and triggers.tgname in (
          'rounds_00_reject_tombstoned_write',
          'rounds_00_record_tombstone_before_delete'
        ) and not triggers.tgisinternal)::integer as trigger_count,
    (select count(*) from pg_catalog.pg_proc as functions
      join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
      where schemas.nspname = 'public' and functions.proname in (
        'record_round_tombstone_before_delete',
        'reject_tombstoned_round_write'
      ) and functions.prosecdef)::integer as security_definer_function_count
),
gate as (
  select
    (select coalesce(sum(violation_count), 0) from data_integrity_checks)::bigint
      as data_violation_count,
    (select count(*) from index_checks where status <> 'present_valid')::integer
      as index_blocker_count,
    (select count(*) from constraint_checks where status <> 'present_validated')::integer
      as constraint_blocker_count,
    (select case when function_count = 1 and security_definer and language_matches
      and settings_match then 0 else 1 end from function_check)::integer
      as function_blocker_count,
    (select case when trigger_count = 1 and definition_matches then 0 else 1 end
      from trigger_check)::integer as trigger_blocker_count,
    (select forbidden_child_dml_count from privilege_checks)::integer
      as forbidden_child_dml_count,
    (select required_privilege_missing_count from privilege_checks)::integer
      as required_privilege_missing_count,
    (select case when table_exists and trigger_count = 2
      and security_definer_function_count = 2 then 0 else 1 end from tombstone_check)::integer
      as tombstone_blocker_count
)
select jsonb_build_object(
  'formatVersion', 1,
  'targetMigration', '202609010002_derived_data_integrity.sql',
  'serverVersionNum', current_setting('server_version_num'),
  'gateStatus', case when data_violation_count = 0
    and index_blocker_count = 0 and constraint_blocker_count = 0
    and function_blocker_count = 0 and trigger_blocker_count = 0
    and forbidden_child_dml_count = 0 and required_privilege_missing_count = 0
    and tombstone_blocker_count = 0 then 'PASS' else 'BLOCKED' end,
  'blockerCounts', jsonb_build_object(
    'dataViolations', data_violation_count,
    'indexes', index_blocker_count,
    'constraints', constraint_blocker_count,
    'function', function_blocker_count,
    'trigger', trigger_blocker_count,
    'forbiddenChildDml', forbidden_child_dml_count,
    'requiredPrivileges', required_privilege_missing_count,
    'tombstones', tombstone_blocker_count
  ),
  'entityCounts', (select jsonb_object_agg(check_name, row_count) from entity_counts),
  'dataIntegrityCounts', (select jsonb_object_agg(check_name, violation_count)
    from data_integrity_checks),
  'indexes', (select jsonb_agg(to_jsonb(index_checks) order by index_name) from index_checks),
  'constraints', (select jsonb_agg(to_jsonb(constraint_checks) order by constraint_name)
    from constraint_checks),
  'function', (select to_jsonb(function_check) from function_check),
  'trigger', (select to_jsonb(trigger_check) from trigger_check),
  'privileges', (select to_jsonb(privilege_checks) from privilege_checks),
  'tombstones', (select to_jsonb(tombstone_check) from tombstone_check)
) as migration_002_post_apply
from gate;

commit;
