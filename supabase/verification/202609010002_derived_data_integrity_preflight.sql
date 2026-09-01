-- Preview schema/data preflight for migration 202609010002.
-- Returns one schema-only JSON value plus aggregate violation counts.
-- It never returns application row values and never changes the database.

begin transaction read only;

with
expected_columns(table_name, column_name, data_type, not_null, may_be_added) as (
  values
    ('rounds', 'id', 'text', true, false),
    ('rounds', 'user_id', 'uuid', true, false),
    ('round_holes', 'round_id', 'text', true, false),
    ('round_holes', 'hole_number', 'smallint', true, false),
    ('round_holes', 'user_id', 'uuid', true, false),
    ('round_holes', 'official_hole_number', 'smallint', false, false),
    ('round_holes', 'distance', 'numeric', false, false),
    ('round_holes', 'score', 'smallint', false, false),
    ('round_holes', 'swing_count', 'smallint', false, true),
    ('round_holes', 'putts', 'smallint', false, false),
    ('round_holes', 'payload', 'jsonb', true, false),
    ('round_holes', 'updated_at', 'timestamp with time zone', true, false),
    ('round_shots', 'round_id', 'text', true, false),
    ('round_shots', 'hole_number', 'smallint', true, false),
    ('round_shots', 'user_id', 'uuid', true, false),
    ('round_shots', 'shot_sequence', 'smallint', true, false),
    ('round_shots', 'club', 'text', false, false),
    ('round_shots', 'club_client_id', 'text', false, false),
    ('round_shots', 'club_snapshot', 'jsonb', false, false),
    ('round_shots', 'remaining_distance', 'numeric', false, false),
    ('round_shots', 'trouble_direction', 'text', false, false),
    ('round_shots', 'trouble_type', 'text', false, false),
    ('round_shots', 'ob_relief', 'text', false, false),
    ('round_shots', 'payload', 'jsonb', true, false),
    ('round_shots', 'updated_at', 'timestamp with time zone', true, false),
    ('user_clubs', 'id', 'uuid', true, false),
    ('user_clubs', 'user_id', 'uuid', true, false),
    ('club_distance_history', 'club_id', 'uuid', true, false),
    ('club_distance_history', 'user_id', 'uuid', true, false)
),
column_checks as (
  select
    expected.table_name,
    expected.column_name,
    expected.data_type as expected_data_type,
    expected.not_null as expected_not_null,
    expected.may_be_added,
    pg_catalog.format_type(attributes.atttypid, attributes.atttypmod) as actual_data_type,
    attributes.attnotnull as actual_not_null,
    case
      when attributes.attname is null and expected.may_be_added then 'absent_additive'
      when attributes.attname is null then 'absent_blocker'
      when pg_catalog.format_type(attributes.atttypid, attributes.atttypmod) = expected.data_type
        and attributes.attnotnull = expected.not_null then 'exact'
      else 'mismatch'
    end as status
  from expected_columns as expected
  left join pg_catalog.pg_namespace as schemas on schemas.nspname = 'public'
  left join pg_catalog.pg_class as tables
    on tables.relnamespace = schemas.oid
   and tables.relname = expected.table_name
  left join pg_catalog.pg_attribute as attributes
    on attributes.attrelid = tables.oid
   and attributes.attname = expected.column_name
   and attributes.attnum > 0
   and not attributes.attisdropped
),
expected_indexes(index_name, table_name, key_columns) as (
  values
    ('rounds_id_user_uidx', 'rounds', array['id', 'user_id']::text[]),
    ('round_holes_round_hole_user_uidx', 'round_holes', array['round_id', 'hole_number', 'user_id']::text[]),
    ('user_clubs_id_user_uidx', 'user_clubs', array['id', 'user_id']::text[])
),
named_index_objects as (
  select
    expected.index_name,
    expected.table_name as expected_table_name,
    expected.key_columns as expected_key_columns,
    indexes.oid as index_oid,
    indexes.relkind as index_relkind,
    indexed_tables.relname as actual_table_name,
    metadata.indisunique,
    metadata.indisvalid,
    metadata.indisready,
    metadata.indnkeyatts,
    metadata.indnatts,
    metadata.indexprs,
    metadata.indpred,
    access_methods.amname,
    actual_keys.key_columns as actual_key_columns,
    case
      when indexes.oid is null then 'absent_expected'
      when indexes.relkind <> 'i'
        or indexed_tables.relname is distinct from expected.table_name
        or metadata.indisunique is not true
        or metadata.indisvalid is not true
        or metadata.indisready is not true
        or metadata.indnkeyatts <> cardinality(expected.key_columns)
        or metadata.indnatts <> cardinality(expected.key_columns)
        or metadata.indexprs is not null
        or metadata.indpred is not null
        or access_methods.amname <> 'btree'
        or actual_keys.key_columns is distinct from expected.key_columns
        then 'mismatch_blocker'
      else 'exact_existing'
    end as status
  from expected_indexes as expected
  left join pg_catalog.pg_namespace as schemas on schemas.nspname = 'public'
  left join pg_catalog.pg_class as indexes
    on indexes.relnamespace = schemas.oid
   and indexes.relname = expected.index_name
  left join pg_catalog.pg_index as metadata on metadata.indexrelid = indexes.oid
  left join pg_catalog.pg_class as indexed_tables on indexed_tables.oid = metadata.indrelid
  left join pg_catalog.pg_am as access_methods on access_methods.oid = indexes.relam
  left join lateral (
    select array_agg(attributes.attname order by keys.ordinality)::text[] as key_columns
    from unnest(metadata.indkey::smallint[]) with ordinality as keys(attnum, ordinality)
    join pg_catalog.pg_attribute as attributes
      on attributes.attrelid = metadata.indrelid
     and attributes.attnum = keys.attnum
    where keys.ordinality <= metadata.indnkeyatts
  ) as actual_keys on true
),
equivalent_other_indexes as (
  select
    expected.index_name as expected_index_name,
    indexes.relname as equivalent_index_name
  from expected_indexes as expected
  join pg_catalog.pg_namespace as schemas on schemas.nspname = 'public'
  join pg_catalog.pg_class as tables
    on tables.relnamespace = schemas.oid
   and tables.relname = expected.table_name
  join pg_catalog.pg_index as metadata on metadata.indrelid = tables.oid
  join pg_catalog.pg_class as indexes on indexes.oid = metadata.indexrelid
  join pg_catalog.pg_am as access_methods on access_methods.oid = indexes.relam
  cross join lateral (
    select array_agg(attributes.attname order by keys.ordinality)::text[] as key_columns
    from unnest(metadata.indkey::smallint[]) with ordinality as keys(attnum, ordinality)
    join pg_catalog.pg_attribute as attributes
      on attributes.attrelid = metadata.indrelid
     and attributes.attnum = keys.attnum
    where keys.ordinality <= metadata.indnkeyatts
  ) as actual_keys
  where indexes.relname <> expected.index_name
    and metadata.indisunique
    and metadata.indisvalid
    and metadata.indisready
    and metadata.indnkeyatts = cardinality(expected.key_columns)
    and metadata.indnatts = cardinality(expected.key_columns)
    and metadata.indexprs is null
    and metadata.indpred is null
    and access_methods.amname = 'btree'
    and actual_keys.key_columns = expected.key_columns
),
expected_constraints(
  constraint_name, table_name, key_columns, referenced_table_name,
  referenced_columns
) as (
  values
    ('round_holes_round_user_fkey', 'round_holes', array['round_id', 'user_id']::text[],
      'rounds', array['id', 'user_id']::text[]),
    ('round_shots_round_hole_user_fkey', 'round_shots', array['round_id', 'hole_number', 'user_id']::text[],
      'round_holes', array['round_id', 'hole_number', 'user_id']::text[]),
    ('club_distance_history_club_user_fkey', 'club_distance_history', array['club_id', 'user_id']::text[],
      'user_clubs', array['id', 'user_id']::text[])
),
constraint_checks as (
  select
    expected.constraint_name,
    expected.table_name,
    expected.key_columns as expected_key_columns,
    expected.referenced_table_name,
    expected.referenced_columns as expected_referenced_columns,
    constraints.convalidated as actual_validated,
    constraints.condeferrable as actual_deferrable,
    constraints.condeferred as actual_initially_deferred,
    constraints.confdeltype as actual_delete_action,
    constraints.confmatchtype as actual_match_type,
    actual_keys.key_columns as actual_key_columns,
    referenced_tables.relname as actual_referenced_table_name,
    referenced_keys.key_columns as actual_referenced_columns,
    case
      when constraints.oid is null then 'absent_expected'
      when constraints.contype <> 'f'
        or constraints.condeferrable
        or constraints.condeferred
        or constraints.confdeltype <> 'c'
        or constraints.confmatchtype <> 's'
        or actual_keys.key_columns is distinct from expected.key_columns
        or referenced_tables.relname is distinct from expected.referenced_table_name
        or referenced_keys.key_columns is distinct from expected.referenced_columns
        then 'mismatch_blocker'
      when constraints.convalidated then 'exact_validated'
      else 'exact_pending_validation'
    end as status
  from expected_constraints as expected
  join pg_catalog.pg_namespace as schemas on schemas.nspname = 'public'
  join pg_catalog.pg_class as tables
    on tables.relnamespace = schemas.oid
   and tables.relname = expected.table_name
  left join pg_catalog.pg_constraint as constraints
    on constraints.conrelid = tables.oid
   and constraints.conname = expected.constraint_name
  left join pg_catalog.pg_class as referenced_tables on referenced_tables.oid = constraints.confrelid
  left join lateral (
    select array_agg(attributes.attname order by keys.ordinality)::text[] as key_columns
    from unnest(constraints.conkey::smallint[]) with ordinality as keys(attnum, ordinality)
    join pg_catalog.pg_attribute as attributes
      on attributes.attrelid = constraints.conrelid
     and attributes.attnum = keys.attnum
  ) as actual_keys on true
  left join lateral (
    select array_agg(attributes.attname order by keys.ordinality)::text[] as key_columns
    from unnest(constraints.confkey::smallint[]) with ordinality as keys(attnum, ordinality)
    join pg_catalog.pg_attribute as attributes
      on attributes.attrelid = constraints.confrelid
     and attributes.attnum = keys.attnum
  ) as referenced_keys on true
),
equivalent_other_constraints as (
  select
    expected.constraint_name as expected_constraint_name,
    constraints.conname as equivalent_constraint_name
  from expected_constraints as expected
  join pg_catalog.pg_namespace as schemas on schemas.nspname = 'public'
  join pg_catalog.pg_class as tables
    on tables.relnamespace = schemas.oid
   and tables.relname = expected.table_name
  join pg_catalog.pg_constraint as constraints
    on constraints.conrelid = tables.oid
   and constraints.contype = 'f'
   and constraints.conname <> expected.constraint_name
  join pg_catalog.pg_class as referenced_tables on referenced_tables.oid = constraints.confrelid
  cross join lateral (
    select array_agg(attributes.attname order by keys.ordinality)::text[] as key_columns
    from unnest(constraints.conkey::smallint[]) with ordinality as keys(attnum, ordinality)
    join pg_catalog.pg_attribute as attributes
      on attributes.attrelid = constraints.conrelid
     and attributes.attnum = keys.attnum
  ) as actual_keys
  cross join lateral (
    select array_agg(attributes.attname order by keys.ordinality)::text[] as key_columns
    from unnest(constraints.confkey::smallint[]) with ordinality as keys(attnum, ordinality)
    join pg_catalog.pg_attribute as attributes
      on attributes.attrelid = constraints.confrelid
     and attributes.attnum = keys.attnum
  ) as referenced_keys
  where constraints.condeferrable is false
    and constraints.condeferred is false
    and constraints.confdeltype = 'c'
    and constraints.confmatchtype = 's'
    and actual_keys.key_columns = expected.key_columns
    and referenced_tables.relname = expected.referenced_table_name
    and referenced_keys.key_columns = expected.referenced_columns
),
function_checks as (
  select
    count(*)::integer as overload_count,
    min(pg_catalog.pg_get_userbyid(functions.proowner)) as owner_name,
    bool_and(functions.prosecdef) as security_definer,
    bool_and(languages.lanname = 'plpgsql') as language_matches,
    bool_and(coalesce(functions.proconfig, array[]::text[]) = array['search_path=public']::text[]) as settings_match,
    min(md5(pg_catalog.pg_get_functiondef(functions.oid))) as actual_definition_hash,
    '117d20b5e9c660b31d6a8fefcd8354da'::text as expected_definition_hash,
    bool_and(
      current_user = pg_catalog.pg_get_userbyid(functions.proowner)
      or executor.rolsuper
      or pg_catalog.pg_has_role(current_user, functions.proowner, 'USAGE')
    ) as executor_can_replace,
    case
      when count(*) <> 1 then 'overload_count_blocker'
      when min(md5(pg_catalog.pg_get_functiondef(functions.oid)))
        <> '117d20b5e9c660b31d6a8fefcd8354da' then 'definition_hash_blocker'
      when not bool_and(functions.prosecdef
        and languages.lanname = 'plpgsql'
        and coalesce(functions.proconfig, array[]::text[]) = array['search_path=public']::text[])
        then 'security_property_blocker'
      when not bool_and(
        current_user = pg_catalog.pg_get_userbyid(functions.proowner)
        or executor.rolsuper
        or pg_catalog.pg_has_role(current_user, functions.proowner, 'USAGE')
      ) then 'executor_owner_blocker'
      else 'exact_baseline'
    end as status
  from pg_catalog.pg_proc as functions
  join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
  join pg_catalog.pg_language as languages on languages.oid = functions.prolang
  cross join pg_catalog.pg_roles as executor
  where schemas.nspname = 'public'
    and functions.proname = 'sync_round_children_from_payload'
    and pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
    and executor.rolname = current_user
),
trigger_checks as (
  select
    count(*)::integer as trigger_count,
    min(triggers.tgenabled::text) as enabled_state,
    min(triggers.tgtype::integer) as trigger_type,
    min(functions.proname) as function_name,
    min(md5(pg_catalog.pg_get_triggerdef(triggers.oid, false))) as definition_hash,
    bool_and(attributes.updated_columns = array['payload']::text[]) as updated_columns_match,
    case
      when count(*) <> 1 then 'trigger_count_blocker'
      when not bool_and(
        triggers.tgenabled = 'O'
        and triggers.tgtype = 21
        and functions.proname = 'sync_round_children_from_payload'
        and pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
        and attributes.updated_columns = array['payload']::text[]
      ) then 'trigger_definition_blocker'
      else 'exact_existing'
    end as status
  from pg_catalog.pg_trigger as triggers
  join pg_catalog.pg_class as tables on tables.oid = triggers.tgrelid
  join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
  join pg_catalog.pg_proc as functions on functions.oid = triggers.tgfoid
  left join lateral (
    select coalesce(array_agg(columns.attname order by keys.ordinality), array[]::name[])::text[]
      as updated_columns
    from unnest(triggers.tgattr::smallint[]) with ordinality as keys(attnum, ordinality)
    join pg_catalog.pg_attribute as columns
      on columns.attrelid = triggers.tgrelid
     and columns.attnum = keys.attnum
  ) as attributes on true
  where schemas.nspname = 'public'
    and tables.relname = 'rounds'
    and triggers.tgname = 'rounds_sync_children'
    and not triggers.tgisinternal
),
data_violation_checks as (
  select 'round_holes_parent_orphan' as check_name, count(*)::bigint as violation_count
  from public.round_holes as holes
  left join public.rounds as rounds on rounds.id = holes.round_id
  where rounds.id is null
  union all
  select 'round_shots_parent_orphan', count(*)::bigint
  from public.round_shots as shots
  left join public.round_holes as holes
    on holes.round_id = shots.round_id
   and holes.hole_number = shots.hole_number
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
    on holes.round_id = shots.round_id
   and holes.hole_number = shots.hole_number
  where shots.user_id <> holes.user_id
  union all
  select 'club_distance_owner_mismatch', count(*)::bigint
  from public.club_distance_history as distances
  join public.user_clubs as clubs on clubs.id = distances.club_id
  where distances.user_id <> clubs.user_id
),
risky_privilege_checks as (
  select count(*)::integer as violation_count
  from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
  cross join (values
    ('profiles'), ('rounds'), ('round_holes'), ('round_shots'),
    ('user_clubs'), ('club_distance_history'), ('app_diagnostics')
  ) as tables(table_name)
  cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as privileges(privilege_name)
  where pg_catalog.has_table_privilege(
    roles.role_name,
    pg_catalog.format('%I.%I', 'public', tables.table_name),
    privileges.privilege_name
  )
),
gate_counts as (
  select
    (select count(*) from column_checks where status in ('absent_blocker', 'mismatch'))::integer
      as column_blocker_count,
    (select count(*) from named_index_objects where status = 'mismatch_blocker')::integer
      as index_blocker_count,
    (select count(*) from constraint_checks where status = 'mismatch_blocker')::integer
      as constraint_blocker_count,
    (select count(*) from function_checks where status <> 'exact_baseline')::integer
      as function_blocker_count,
    (select count(*) from trigger_checks where status <> 'exact_existing')::integer
      as trigger_blocker_count,
    (select coalesce(sum(violation_count), 0) from data_violation_checks)::bigint
      as data_violation_count,
    (select violation_count from risky_privilege_checks)::integer
      as risky_privilege_violation_count,
    (select count(*) from equivalent_other_indexes)::integer
      + (select count(*) from equivalent_other_constraints)::integer
      as equivalent_object_advisory_count
)
select jsonb_build_object(
  'formatVersion', 1,
  'targetMigration', '202609010002_derived_data_integrity.sql',
  'serverVersionNum', current_setting('server_version_num'),
  'gateStatus', case when
    column_blocker_count = 0
    and index_blocker_count = 0
    and constraint_blocker_count = 0
    and function_blocker_count = 0
    and trigger_blocker_count = 0
    and data_violation_count = 0
    and risky_privilege_violation_count = 0
    then 'READY'
    else 'BLOCKED'
  end,
  'blockerCounts', jsonb_build_object(
    'columns', column_blocker_count,
    'namedIndexes', index_blocker_count,
    'namedConstraints', constraint_blocker_count,
    'functionBaseline', function_blocker_count,
    'roundsSyncTrigger', trigger_blocker_count,
    'dataViolations', data_violation_count,
    'riskyRuntimePrivileges', risky_privilege_violation_count
  ),
  'advisoryCounts', jsonb_build_object(
    'equivalentObjectsWithOtherNames', equivalent_object_advisory_count
  ),
  'columns', coalesce((select jsonb_agg(to_jsonb(column_checks)
    order by table_name, column_name) from column_checks), '[]'::jsonb),
  'namedIndexes', coalesce((select jsonb_agg(to_jsonb(named_index_objects)
    order by index_name) from named_index_objects), '[]'::jsonb),
  'equivalentOtherIndexes', coalesce((select jsonb_agg(to_jsonb(equivalent_other_indexes)
    order by expected_index_name, equivalent_index_name) from equivalent_other_indexes), '[]'::jsonb),
  'namedConstraints', coalesce((select jsonb_agg(to_jsonb(constraint_checks)
    order by constraint_name) from constraint_checks), '[]'::jsonb),
  'equivalentOtherConstraints', coalesce((select jsonb_agg(to_jsonb(equivalent_other_constraints)
    order by expected_constraint_name, equivalent_constraint_name) from equivalent_other_constraints), '[]'::jsonb),
  'functionBaseline', (select to_jsonb(function_checks) from function_checks),
  'roundsSyncTrigger', (select to_jsonb(trigger_checks) from trigger_checks),
  'dataViolationCounts', coalesce((select jsonb_agg(to_jsonb(data_violation_checks)
    order by check_name) from data_violation_checks), '[]'::jsonb)
) as migration_002_preflight
from gate_counts;

commit;
