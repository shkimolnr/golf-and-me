-- Golf&Me schema-only catalog snapshot.
-- This returns one JSON value and never reads application table rows.
-- Run only in the approved Preview project, never in Production.

begin transaction read only;

with
audited_tables(table_name) as (
  values
    ('app_diagnostics'), ('club_distance_history'), ('profiles'),
    ('round_holes'), ('round_shots'), ('rounds'), ('user_clubs')
),
audited_roles(role_name) as (
  values ('anon'), ('authenticated'), ('service_role')
),
audited_functions(function_name) as (
  values
    ('calculate_round_stats_from_payload'),
    ('delete_own_account'),
    ('handle_new_user'),
    ('keep_newest_round_version'),
    ('purge_expired_app_diagnostics'),
    ('record_app_diagnostic'),
    ('rls_auto_enable'),
    ('sync_round_children_from_payload'),
    ('sync_round_summary_from_payload')
),
table_rows as (
  select jsonb_build_object(
    'tableName', tables.relname,
    'rlsEnabled', tables.relrowsecurity,
    'rlsForced', tables.relforcerowsecurity
  ) as item
  from pg_catalog.pg_class as tables
  join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
  join audited_tables on audited_tables.table_name = tables.relname
  where schemas.nspname = 'public'
    and tables.relkind in ('r', 'p')
  order by tables.relname
),
column_rows as (
  select jsonb_build_object(
    'tableName', tables.relname,
    'ordinalPosition', attributes.attnum,
    'columnName', attributes.attname,
    'dataType', pg_catalog.format_type(attributes.atttypid, attributes.atttypmod),
    'notNull', attributes.attnotnull,
    'identity', attributes.attidentity,
    'generated', attributes.attgenerated,
    'defaultExpression', pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid, false)
  ) as item
  from pg_catalog.pg_attribute as attributes
  join pg_catalog.pg_class as tables on tables.oid = attributes.attrelid
  join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
  join audited_tables on audited_tables.table_name = tables.relname
  left join pg_catalog.pg_attrdef as defaults
    on defaults.adrelid = attributes.attrelid
   and defaults.adnum = attributes.attnum
  where schemas.nspname = 'public'
    and attributes.attnum > 0
    and not attributes.attisdropped
  order by tables.relname, attributes.attnum
),
constraint_rows as (
  select jsonb_build_object(
    'tableName', tables.relname,
    'constraintName', constraints.conname,
    'constraintType', constraints.contype,
    'validated', constraints.convalidated,
    'deferrable', constraints.condeferrable,
    'initiallyDeferred', constraints.condeferred,
    'definition', pg_catalog.pg_get_constraintdef(constraints.oid, false)
  ) as item
  from pg_catalog.pg_constraint as constraints
  join pg_catalog.pg_class as tables on tables.oid = constraints.conrelid
  join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
  join audited_tables on audited_tables.table_name = tables.relname
  where schemas.nspname = 'public'
  order by tables.relname, constraints.conname
),
index_rows as (
  select jsonb_build_object(
    'tableName', tables.relname,
    'indexName', indexes.relname,
    'primary', metadata.indisprimary,
    'unique', metadata.indisunique,
    'valid', metadata.indisvalid,
    'ready', metadata.indisready,
    'definition', pg_catalog.pg_get_indexdef(metadata.indexrelid, 0, false)
  ) as item
  from pg_catalog.pg_index as metadata
  join pg_catalog.pg_class as tables on tables.oid = metadata.indrelid
  join pg_catalog.pg_class as indexes on indexes.oid = metadata.indexrelid
  join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
  join audited_tables on audited_tables.table_name = tables.relname
  where schemas.nspname = 'public'
  order by tables.relname, indexes.relname
),
policy_rows as (
  select jsonb_build_object(
    'tableName', policies.tablename,
    'policyName', policies.policyname,
    'permissive', policies.permissive,
    'roles', to_jsonb(policies.roles),
    'command', policies.cmd,
    'usingExpression', policies.qual,
    'checkExpression', policies.with_check
  ) as item
  from pg_catalog.pg_policies as policies
  join audited_tables on audited_tables.table_name = policies.tablename
  where policies.schemaname = 'public'
  order by policies.tablename, policies.policyname
),
role_rows as (
  select jsonb_build_object(
    'roleName', roles.rolname,
    'superuser', roles.rolsuper,
    'inherit', roles.rolinherit,
    'createRole', roles.rolcreaterole,
    'createDatabase', roles.rolcreatedb,
    'canLogin', roles.rolcanlogin,
    'replication', roles.rolreplication,
    'bypassRls', roles.rolbypassrls
  ) as item
  from pg_catalog.pg_roles as roles
  join audited_roles on audited_roles.role_name = roles.rolname
  order by roles.rolname
),
schema_privilege_rows as (
  select jsonb_build_object(
    'roleName', roles.role_name,
    'privilege', privileges.privilege_name,
    'allowed', pg_catalog.has_schema_privilege(roles.role_name, 'public', privileges.privilege_name)
  ) as item
  from audited_roles as roles
  cross join (values ('USAGE'), ('CREATE')) as privileges(privilege_name)
  where exists (select 1 from pg_catalog.pg_roles where rolname = roles.role_name)
  order by roles.role_name, privileges.privilege_name
),
table_privilege_rows as (
  select jsonb_build_object(
    'roleName', roles.role_name,
    'tableName', tables.table_name,
    'privilege', privileges.privilege_name,
    'allowed', pg_catalog.has_table_privilege(
      roles.role_name,
      pg_catalog.format('%I.%I', 'public', tables.table_name),
      privileges.privilege_name
    )
  ) as item
  from audited_roles as roles
  cross join audited_tables as tables
  cross join (
    values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
  ) as privileges(privilege_name)
  where exists (select 1 from pg_catalog.pg_roles where rolname = roles.role_name)
    and to_regclass(pg_catalog.format('%I.%I', 'public', tables.table_name)) is not null
  order by roles.role_name, tables.table_name, privileges.privilege_name
),
sequence_privilege_rows as (
  select jsonb_build_object(
    'roleName', roles.role_name,
    'sequenceName', sequences.relname,
    'privilege', privileges.privilege_name,
    'allowed', pg_catalog.has_sequence_privilege(
      roles.role_name,
      pg_catalog.format('%I.%I', schemas.nspname, sequences.relname),
      privileges.privilege_name
    )
  ) as item
  from audited_roles as roles
  cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) as privileges(privilege_name)
  cross join pg_catalog.pg_class as sequences
  join pg_catalog.pg_namespace as schemas on schemas.oid = sequences.relnamespace
  where schemas.nspname = 'public'
    and sequences.relkind = 'S'
    and exists (select 1 from pg_catalog.pg_roles where rolname = roles.role_name)
  order by roles.role_name, sequences.relname, privileges.privilege_name
),
function_rows as (
  select jsonb_build_object(
    'functionIdentity', functions.proname || '(' ||
      pg_catalog.pg_get_function_identity_arguments(functions.oid) || ')',
    'ownerName', pg_catalog.pg_get_userbyid(functions.proowner),
    'languageName', languages.lanname,
    'securityDefiner', functions.prosecdef,
    'leakproof', functions.proleakproof,
    'volatility', functions.provolatile,
    'parallelSafety', functions.proparallel,
    'settings', coalesce(to_jsonb(functions.proconfig), '[]'::jsonb),
    'definitionHash', md5(pg_catalog.pg_get_functiondef(functions.oid))
  ) as item
  from pg_catalog.pg_proc as functions
  join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
  join pg_catalog.pg_language as languages on languages.oid = functions.prolang
  join audited_functions on audited_functions.function_name = functions.proname
  where schemas.nspname = 'public'
  order by functions.proname, pg_catalog.pg_get_function_identity_arguments(functions.oid)
),
function_privilege_rows as (
  select jsonb_build_object(
    'roleName', roles.role_name,
    'functionIdentity', functions.proname || '(' ||
      pg_catalog.pg_get_function_identity_arguments(functions.oid) || ')',
    'executeAllowed', pg_catalog.has_function_privilege(roles.role_name, functions.oid, 'EXECUTE')
  ) as item
  from audited_roles as roles
  cross join pg_catalog.pg_proc as functions
  join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
  join audited_functions on audited_functions.function_name = functions.proname
  where schemas.nspname = 'public'
    and exists (select 1 from pg_catalog.pg_roles where rolname = roles.role_name)
  order by roles.role_name, functions.proname,
    pg_catalog.pg_get_function_identity_arguments(functions.oid)
),
trigger_rows as (
  select jsonb_build_object(
    'schemaName', schemas.nspname,
    'tableName', tables.relname,
    'triggerName', triggers.tgname,
    'enabledState', triggers.tgenabled,
    'functionIdentity', functions.proname || '(' ||
      pg_catalog.pg_get_function_identity_arguments(functions.oid) || ')',
    'definitionHash', md5(pg_catalog.pg_get_triggerdef(triggers.oid, false))
  ) as item
  from pg_catalog.pg_trigger as triggers
  join pg_catalog.pg_class as tables on tables.oid = triggers.tgrelid
  join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
  join pg_catalog.pg_proc as functions on functions.oid = triggers.tgfoid
  where not triggers.tgisinternal
    and (
      (schemas.nspname = 'public' and tables.relname = 'rounds')
      or (schemas.nspname = 'auth' and tables.relname = 'users')
    )
  order by schemas.nspname, tables.relname, triggers.tgname
),
event_trigger_rows as (
  select jsonb_build_object(
    'triggerName', event_triggers.evtname,
    'event', event_triggers.evtevent,
    'enabledState', event_triggers.evtenabled,
    'tags', coalesce(to_jsonb(event_triggers.evttags), '[]'::jsonb),
    'functionIdentity', functions.proname || '(' ||
      pg_catalog.pg_get_function_identity_arguments(functions.oid) || ')',
    'definitionHash', md5(concat_ws(E'\n',
      event_triggers.evtname,
      event_triggers.evtevent,
      event_triggers.evtenabled::text,
      coalesce(array_to_string(event_triggers.evttags, ','), ''),
      functions.proname || '(' ||
        pg_catalog.pg_get_function_identity_arguments(functions.oid) || ')'
    ))
  ) as item
  from pg_catalog.pg_event_trigger as event_triggers
  join pg_catalog.pg_proc as functions on functions.oid = event_triggers.evtfoid
  join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
  where schemas.nspname = 'public'
  order by event_triggers.evtname
),
extension_rows as (
  select to_jsonb(extensions.extname) as item
  from pg_catalog.pg_extension as extensions
  order by extensions.extname
)
select jsonb_build_object(
  'formatVersion', 1,
  'serverVersionNum', current_setting('server_version_num'),
  'tables', coalesce((select jsonb_agg(item) from table_rows), '[]'::jsonb),
  'columns', coalesce((select jsonb_agg(item) from column_rows), '[]'::jsonb),
  'constraints', coalesce((select jsonb_agg(item) from constraint_rows), '[]'::jsonb),
  'indexes', coalesce((select jsonb_agg(item) from index_rows), '[]'::jsonb),
  'policies', coalesce((select jsonb_agg(item) from policy_rows), '[]'::jsonb),
  'roles', coalesce((select jsonb_agg(item) from role_rows), '[]'::jsonb),
  'schemaPrivileges', coalesce((select jsonb_agg(item) from schema_privilege_rows), '[]'::jsonb),
  'tablePrivileges', coalesce((select jsonb_agg(item) from table_privilege_rows), '[]'::jsonb),
  'sequencePrivileges', coalesce((select jsonb_agg(item) from sequence_privilege_rows), '[]'::jsonb),
  'functions', coalesce((select jsonb_agg(item) from function_rows), '[]'::jsonb),
  'functionPrivileges', coalesce((select jsonb_agg(item) from function_privilege_rows), '[]'::jsonb),
  'triggers', coalesce((select jsonb_agg(item) from trigger_rows), '[]'::jsonb),
  'eventTriggers', coalesce((select jsonb_agg(item) from event_trigger_rows), '[]'::jsonb),
  'extensions', coalesce((select jsonb_agg(item) from extension_rows), '[]'::jsonb)
) as schema_only_snapshot;

commit;
