-- Preview schema/privilege preflight for migration 202609010005.
-- Returns catalog metadata and aggregate privilege counts only.
-- It never reads application rows and never changes the database.

begin transaction read only;

with
target_table as (
  select
    count(relations.oid)::integer as relation_count,
    min(relations.relkind::text) as relation_kind,
    bool_and(relations.relrowsecurity) as rls_enabled,
    min((
      select count(*)::integer
      from pg_catalog.pg_attribute as attributes
      where attributes.attrelid = relations.oid
        and attributes.attnum > 0
        and not attributes.attisdropped
    )) as user_column_count,
    case
      when count(relations.oid) = 0 then 'absent_expected'
      when count(relations.oid) <> 1 or min(relations.relkind::text) not in ('r', 'p')
        then 'relation_collision_blocker'
      when not bool_and(relations.relrowsecurity) then 'rls_disabled_blocker'
      when min((
        select count(*)::integer
        from pg_catalog.pg_attribute as attributes
        where attributes.attrelid = relations.oid
          and attributes.attnum > 0
          and not attributes.attisdropped
      )) <> 3 then 'unexpected_column_count_blocker'
      else 'exact_existing'
    end as status
  from pg_catalog.pg_namespace as schemas
  left join pg_catalog.pg_class as relations
    on relations.relnamespace = schemas.oid
   and relations.relname = 'round_tombstones'
  where schemas.nspname = 'public'
),
expected_columns(column_name, data_type, not_null, default_kind) as (
  values
    ('round_id', 'text', true, 'none'),
    ('user_id', 'uuid', true, 'none'),
    ('deleted_at', 'timestamp with time zone', true, 'clock_timestamp')
),
column_checks as (
  select
    expected.column_name,
    expected.data_type as expected_data_type,
    expected.not_null as expected_not_null,
    expected.default_kind,
    pg_catalog.format_type(attributes.atttypid, attributes.atttypmod) as actual_data_type,
    attributes.attnotnull as actual_not_null,
    pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid) as actual_default,
    case
      when (select relation_count from target_table) = 0 then 'absent_with_table'
      when attributes.attname is null then 'absent_blocker'
      when pg_catalog.format_type(attributes.atttypid, attributes.atttypmod) <> expected.data_type
        or attributes.attnotnull <> expected.not_null then 'definition_mismatch_blocker'
      when expected.default_kind = 'none' and defaults.adbin is not null
        then 'default_mismatch_blocker'
      when expected.default_kind = 'clock_timestamp'
        and (defaults.adbin is null
          or pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid) <> 'clock_timestamp()')
        then 'default_mismatch_blocker'
      else 'exact_existing'
    end as status
  from expected_columns as expected
  left join pg_catalog.pg_attribute as attributes
    on attributes.attrelid = pg_catalog.to_regclass('public.round_tombstones')
   and attributes.attname = expected.column_name
   and attributes.attnum > 0
   and not attributes.attisdropped
  left join pg_catalog.pg_attrdef as defaults
    on defaults.adrelid = attributes.attrelid
   and defaults.adnum = attributes.attnum
),
primary_key_check as (
  select
    count(constraints.oid)::integer as constraint_count,
    min(constraints.convalidated::text)::boolean as validated,
    actual_keys.key_columns,
    case
      when (select relation_count from target_table) = 0 then 'absent_with_table'
      when count(constraints.oid) <> 1 then 'missing_or_duplicate_blocker'
      when min(constraints.contype) <> 'p'
        or min(constraints.convalidated::text)::boolean is not true
        or actual_keys.key_columns is distinct from array['round_id']::text[]
        then 'definition_mismatch_blocker'
      else 'exact_existing'
    end as status
  from pg_catalog.pg_constraint as constraints
  left join lateral (
    select array_agg(attributes.attname order by keys.ordinality)::text[] as key_columns
    from unnest(constraints.conkey::smallint[]) with ordinality as keys(attnum, ordinality)
    join pg_catalog.pg_attribute as attributes
      on attributes.attrelid = constraints.conrelid
     and attributes.attnum = keys.attnum
  ) as actual_keys on true
  where constraints.conrelid = pg_catalog.to_regclass('public.round_tombstones')
    and constraints.conname = 'round_tombstones_pkey'
  group by actual_keys.key_columns
),
foreign_key_check as (
  select
    count(constraints.oid)::integer as constraint_count,
    min(constraints.convalidated::text)::boolean as validated,
    actual_keys.key_columns,
    min(parent_tables.relname) as referenced_table,
    referenced_keys.key_columns as referenced_columns,
    case
      when (select relation_count from target_table) = 0 then 'absent_with_table'
      when count(constraints.oid) <> 1 then 'missing_or_duplicate_blocker'
      when min(constraints.contype) <> 'f'
        or min(constraints.convalidated::text)::boolean is not true
        or min(constraints.confdeltype) <> 'c'
        or min(constraints.confmatchtype) <> 's'
        or bool_or(constraints.condeferrable)
        or actual_keys.key_columns is distinct from array['user_id']::text[]
        or min(parent_schemas.nspname) <> 'auth'
        or min(parent_tables.relname) <> 'users'
        or referenced_keys.key_columns is distinct from array['id']::text[]
        then 'definition_mismatch_blocker'
      else 'exact_existing'
    end as status
  from pg_catalog.pg_constraint as constraints
  left join pg_catalog.pg_class as parent_tables on parent_tables.oid = constraints.confrelid
  left join pg_catalog.pg_namespace as parent_schemas on parent_schemas.oid = parent_tables.relnamespace
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
  where constraints.conrelid = pg_catalog.to_regclass('public.round_tombstones')
    and constraints.conname = 'round_tombstones_user_id_fkey'
  group by actual_keys.key_columns, referenced_keys.key_columns
),
index_check as (
  select
    count(indexes.oid)::integer as index_count,
    indexed_tables.relname as table_name,
    metadata.indisunique,
    metadata.indisvalid,
    metadata.indisready,
    access_methods.amname as access_method,
    actual_keys.key_columns,
    case
      when (select relation_count from target_table) = 0 then 'absent_with_table'
      when count(indexes.oid) <> 1 then 'missing_or_duplicate_blocker'
      when indexed_tables.relname <> 'round_tombstones'
        or metadata.indisunique
        or not metadata.indisvalid
        or not metadata.indisready
        or metadata.indnkeyatts <> 3
        or metadata.indnatts <> 3
        or metadata.indexprs is not null
        or metadata.indpred is not null
        or access_methods.amname <> 'btree'
        or actual_keys.key_columns is distinct from array['user_id', 'deleted_at', 'round_id']::text[]
        or pg_catalog.pg_get_indexdef(indexes.oid)
          !~ '\(user_id, deleted_at DESC, round_id\)'
        then 'definition_mismatch_blocker'
      else 'exact_existing'
    end as status
  from pg_catalog.pg_namespace as schemas
  left join pg_catalog.pg_class as indexes
    on indexes.relnamespace = schemas.oid
   and indexes.relname = 'round_tombstones_user_deleted_idx'
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
  where schemas.nspname = 'public'
  group by indexes.oid, indexed_tables.relname, metadata.indisunique, metadata.indisvalid,
    metadata.indisready, metadata.indnkeyatts, metadata.indnatts,
    metadata.indexprs, metadata.indpred, metadata.indoption,
    access_methods.amname, actual_keys.key_columns
),
policy_check as (
  select
    count(policies.oid)::integer as policy_count,
    min(policies.polcmd::text) as command,
    min(pg_catalog.pg_get_expr(policies.polqual, policies.polrelid)) as using_expression,
    bool_and(policies.polroles = array[
      (select oid from pg_catalog.pg_roles where rolname = 'authenticated')
    ]::oid[]) as roles_match,
    case
      when (select relation_count from target_table) = 0 then 'absent_with_table'
      when count(policies.oid) <> 1 then 'missing_or_duplicate_blocker'
      when min(policies.polcmd::text) <> 'r'
        or not bool_and(policies.polroles = array[
          (select oid from pg_catalog.pg_roles where rolname = 'authenticated')
        ]::oid[])
        or min(pg_catalog.pg_get_expr(policies.polqual, policies.polrelid))
          not in ('(auth.uid() = user_id)', '(user_id = auth.uid())')
        then 'definition_mismatch_blocker'
      else 'exact_existing'
    end as status
  from pg_catalog.pg_policy as policies
  where policies.polrelid = pg_catalog.to_regclass('public.round_tombstones')
    and policies.polname = 'round_tombstones_select_own'
),
target_privilege_checks as (
  select
    roles.role_name,
    privileges.privilege_name,
    case when pg_catalog.to_regclass('public.round_tombstones') is null then null
      else pg_catalog.has_table_privilege(
        roles.role_name,
        'public.round_tombstones',
        privileges.privilege_name
      ) end as allowed,
    case
      when pg_catalog.to_regclass('public.round_tombstones') is null then 'absent_with_table'
      when roles.role_name = 'authenticated' and privileges.privilege_name = 'SELECT'
        and pg_catalog.has_table_privilege(roles.role_name, 'public.round_tombstones', privileges.privilege_name)
        then 'exact_existing'
      when not (roles.role_name = 'authenticated' and privileges.privilege_name = 'SELECT')
        and not pg_catalog.has_table_privilege(roles.role_name, 'public.round_tombstones', privileges.privilege_name)
        then 'exact_existing'
      else 'privilege_mismatch_blocker'
    end as status
  from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
  cross join (values
    ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
    ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
  ) as privileges(privilege_name)
),
expected_functions(
  function_name, expected_hash
) as (
  values
    ('record_round_tombstone_before_delete', 'eb89388ca6e924490945b3b3cfea423f'),
    ('reject_tombstoned_round_write', '0c86baea5e633a1d5d5982bb212cbb20')
),
function_checks as (
  select
    expected.function_name,
    count(functions.oid)::integer as identity_count,
    (
      select count(*)::integer
      from pg_catalog.pg_proc as overloads
      join pg_catalog.pg_namespace as overload_schemas on overload_schemas.oid = overloads.pronamespace
      where overload_schemas.nspname = 'public'
        and overloads.proname = expected.function_name
        and pg_catalog.pg_get_function_identity_arguments(overloads.oid) <> ''
    ) as other_overload_count,
    min(pg_catalog.pg_get_userbyid(functions.proowner)) as owner_name,
    min(md5(pg_catalog.pg_get_functiondef(functions.oid))) as actual_definition_hash,
    expected.expected_hash as expected_definition_hash,
    case
      when count(functions.oid) = 0 and (
        select count(*)
        from pg_catalog.pg_proc as overloads
        join pg_catalog.pg_namespace as overload_schemas on overload_schemas.oid = overloads.pronamespace
        where overload_schemas.nspname = 'public'
          and overloads.proname = expected.function_name
      ) = 0 then 'absent_expected'
      when count(functions.oid) <> 1 then 'identity_collision_blocker'
      when (
        select count(*)
        from pg_catalog.pg_proc as overloads
        join pg_catalog.pg_namespace as overload_schemas on overload_schemas.oid = overloads.pronamespace
        where overload_schemas.nspname = 'public'
          and overloads.proname = expected.function_name
          and pg_catalog.pg_get_function_identity_arguments(overloads.oid) <> ''
      ) > 0 then 'overload_collision_blocker'
      when min(pg_catalog.pg_get_function_result(functions.oid)) <> 'trigger'
        or min(languages.lanname) <> 'plpgsql'
        or not bool_and(functions.prosecdef)
        or min(functions.proconfig) is distinct from array['search_path=pg_catalog, public']::text[]
        or min(md5(pg_catalog.pg_get_functiondef(functions.oid))) <> expected.expected_hash
        then 'definition_mismatch_blocker'
      when bool_or(pg_catalog.has_function_privilege('anon', functions.oid, 'EXECUTE'))
        or bool_or(pg_catalog.has_function_privilege('authenticated', functions.oid, 'EXECUTE'))
        or bool_or(pg_catalog.has_function_privilege('service_role', functions.oid, 'EXECUTE'))
        then 'execute_privilege_blocker'
      else 'exact_existing'
    end as status
  from expected_functions as expected
  left join pg_catalog.pg_namespace as schemas on schemas.nspname = 'public'
  left join pg_catalog.pg_proc as functions
    on functions.pronamespace = schemas.oid
   and functions.proname = expected.function_name
   and pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
  left join pg_catalog.pg_language as languages on languages.oid = functions.prolang
  group by expected.function_name, expected.expected_hash
),
expected_triggers(trigger_name, function_name, trigger_type) as (
  values
    ('rounds_00_reject_tombstoned_write', 'reject_tombstoned_round_write', 23),
    ('rounds_00_record_tombstone_before_delete', 'record_round_tombstone_before_delete', 11)
),
trigger_checks as (
  select
    expected.trigger_name,
    expected.function_name,
    expected.trigger_type,
    count(triggers.oid)::integer as trigger_count,
    min(triggers.tgenabled::text) as enabled_state,
    min(triggers.tgtype::integer) as actual_trigger_type,
    min(functions.proname) as actual_function_name,
    case
      when count(triggers.oid) = 0 then 'absent_expected'
      when count(triggers.oid) <> 1 then 'trigger_collision_blocker'
      when not bool_and(
        triggers.tgenabled = 'O'
        and triggers.tgtype = expected.trigger_type
        and functions.proname = expected.function_name
        and pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
      ) then 'definition_mismatch_blocker'
      else 'exact_existing'
    end as status
  from expected_triggers as expected
  left join pg_catalog.pg_class as tables on tables.oid = pg_catalog.to_regclass('public.rounds')
  left join pg_catalog.pg_trigger as triggers
    on triggers.tgrelid = tables.oid
   and triggers.tgname = expected.trigger_name
   and not triggers.tgisinternal
  left join pg_catalog.pg_proc as functions on functions.oid = triggers.tgfoid
  group by expected.trigger_name, expected.function_name, expected.trigger_type
),
rounds_prerequisite as (
  select
    pg_catalog.to_regclass('public.rounds') is not null as rounds_exists,
    pg_catalog.has_table_privilege('authenticated', 'public.rounds', 'DELETE') as authenticated_delete,
    exists (
      select 1
      from pg_catalog.pg_policy as policies
      where policies.polrelid = pg_catalog.to_regclass('public.rounds')
        and policies.polname = 'rounds_delete_own'
        and policies.polcmd = 'd'
        and pg_catalog.pg_get_expr(policies.polqual, policies.polrelid)
          in ('(auth.uid() = user_id)', '(user_id = auth.uid())')
    ) as owner_delete_policy,
    case when pg_catalog.to_regclass('public.rounds') is not null
      and pg_catalog.has_table_privilege('authenticated', 'public.rounds', 'DELETE')
      and exists (
        select 1 from pg_catalog.pg_policy as policies
        where policies.polrelid = pg_catalog.to_regclass('public.rounds')
          and policies.polname = 'rounds_delete_own'
          and policies.polcmd = 'd'
          and pg_catalog.pg_get_expr(policies.polqual, policies.polrelid)
            in ('(auth.uid() = user_id)', '(user_id = auth.uid())')
      ) then 'exact_existing' else 'rounds_delete_prerequisite_blocker' end as status
),
runtime_004_status as (
  select
    count(*)::integer as risky_privilege_count,
    case when count(*) = 0 then 'APPLIED_VERIFIED' else 'MISSING_OR_DRIFT' end as status
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
    (select count(*) from target_table
      where status not in ('absent_expected', 'exact_existing'))::integer
      as table_blockers,
    (select count(*) from column_checks
      where status not in ('absent_with_table', 'exact_existing'))::integer
      as column_blockers,
    ((select count(*) from primary_key_check
      where status not in ('absent_with_table', 'exact_existing'))
      + case when (select relation_count from target_table) = 1
          and not exists (select 1 from primary_key_check) then 1 else 0 end)::integer
      as primary_key_blockers,
    ((select count(*) from foreign_key_check
      where status not in ('absent_with_table', 'exact_existing'))
      + case when (select relation_count from target_table) = 1
          and not exists (select 1 from foreign_key_check) then 1 else 0 end)::integer
      as foreign_key_blockers,
    (select count(*) from index_check
      where status not in ('absent_with_table', 'exact_existing'))::integer
      as index_blockers,
    (select count(*) from policy_check
      where status not in ('absent_with_table', 'exact_existing'))::integer
      as policy_blockers,
    (select count(*) from target_privilege_checks
      where status not in ('absent_with_table', 'exact_existing'))::integer
      as privilege_blockers,
    (select count(*) from function_checks
      where status not in ('absent_expected', 'exact_existing'))::integer
      as function_blockers,
    (select count(*) from trigger_checks
      where status not in ('absent_expected', 'exact_existing'))::integer
      as trigger_blockers,
    (select count(*) from rounds_prerequisite where status <> 'exact_existing')::integer
      as prerequisite_blockers,
    (select risky_privilege_count from runtime_004_status)::integer as runtime_004_blockers
)
select jsonb_build_object(
  'formatVersion', 1,
  'targetMigration', '202609010005_round_deletion_tombstones.sql',
  'serverVersionNum', current_setting('server_version_num'),
  'gateStatus', case when
    table_blockers = 0
    and column_blockers = 0
    and primary_key_blockers = 0
    and foreign_key_blockers = 0
    and index_blockers = 0
    and policy_blockers = 0
    and privilege_blockers = 0
    and function_blockers = 0
    and trigger_blockers = 0
    and prerequisite_blockers = 0
    and runtime_004_blockers = 0
    then 'READY' else 'BLOCKED' end,
  'blockerCounts', jsonb_build_object(
    'targetTable', table_blockers,
    'columns', column_blockers,
    'primaryKey', primary_key_blockers,
    'foreignKey', foreign_key_blockers,
    'index', index_blockers,
    'policy', policy_blockers,
    'targetPrivileges', privilege_blockers,
    'functions', function_blockers,
    'triggers', trigger_blockers,
    'roundsDeletePrerequisite', prerequisite_blockers,
    'runtime004RiskyPrivileges', runtime_004_blockers
  ),
  'targetTable', (select to_jsonb(target_table) from target_table),
  'columns', coalesce((select jsonb_agg(to_jsonb(column_checks)
    order by column_name) from column_checks), '[]'::jsonb),
  'primaryKey', (select to_jsonb(primary_key_check) from primary_key_check),
  'foreignKey', (select to_jsonb(foreign_key_check) from foreign_key_check),
  'index', (select to_jsonb(index_check) from index_check),
  'policy', (select to_jsonb(policy_check) from policy_check),
  'targetPrivileges', coalesce((select jsonb_agg(to_jsonb(target_privilege_checks)
    order by role_name, privilege_name) from target_privilege_checks), '[]'::jsonb),
  'functions', coalesce((select jsonb_agg(to_jsonb(function_checks)
    order by function_name) from function_checks), '[]'::jsonb),
  'triggers', coalesce((select jsonb_agg(to_jsonb(trigger_checks)
    order by trigger_name) from trigger_checks), '[]'::jsonb),
  'roundsDeletePrerequisite', (select to_jsonb(rounds_prerequisite) from rounds_prerequisite),
  'runtime004', (select to_jsonb(runtime_004_status) from runtime_004_status)
) as migration_005_preflight
from gate_counts;

commit;
