-- Schema-only checks. These queries never read application rows.

begin transaction read only;

-- 1. Direct ACL sources for the three risky privileges. Run before and after
-- the migration to distinguish direct, PUBLIC, and inherited grants.
select
  tables.relname as table_name,
  case when access.grantee = 0 then 'PUBLIC'
    else coalesce(grantees.rolname, '<dropped-role-oid:' || access.grantee::text || '>') end as grantee,
  access.privilege_type,
  access.is_grantable
from pg_catalog.pg_class as tables
join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
cross join lateral pg_catalog.aclexplode(coalesce(
  tables.relacl,
  pg_catalog.acldefault('r', tables.relowner)
)) as access
left join pg_catalog.pg_roles as grantees on grantees.oid = access.grantee
where schemas.nspname = 'public'
  and tables.relname in (
    'profiles', 'rounds', 'round_holes', 'round_shots',
    'user_clubs', 'club_distance_history', 'app_diagnostics'
  )
  and access.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
order by tables.relname, grantee, access.privilege_type;

-- 2. Effective privilege matrix. Every allowed value must be false after the
-- migration, and violation_count must be 0.
with effective_privileges as (
  select
    roles.role_name,
    tables.table_name,
    privileges.privilege_name,
    pg_catalog.has_table_privilege(
      roles.role_name,
      pg_catalog.format('%I.%I', 'public', tables.table_name),
      privileges.privilege_name
    ) as allowed
  from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
  cross join (values
    ('profiles'), ('rounds'), ('round_holes'), ('round_shots'),
    ('user_clubs'), ('club_distance_history'), ('app_diagnostics')
  ) as tables(table_name)
  cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as privileges(privilege_name)
)
select role_name, table_name, privilege_name, allowed
from effective_privileges
order by role_name, table_name, privilege_name;

with effective_privileges as (
  select pg_catalog.has_table_privilege(
    roles.role_name,
    pg_catalog.format('%I.%I', 'public', tables.table_name),
    privileges.privilege_name
  ) as allowed
  from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
  cross join (values
    ('profiles'), ('rounds'), ('round_holes'), ('round_shots'),
    ('user_clubs'), ('club_distance_history'), ('app_diagnostics')
  ) as tables(table_name)
  cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as privileges(privilege_name)
)
select count(*) filter (where allowed)::integer as violation_count
from effective_privileges;

-- 3. Required browser DML remains available. round_holes and round_shots only
-- require SELECT after migration 002; this check works before or after 002.
with required_privileges(role_name, table_name, privilege_name) as (
  values
    ('authenticated', 'profiles', 'SELECT'),
    ('authenticated', 'profiles', 'INSERT'),
    ('authenticated', 'profiles', 'UPDATE'),
    ('authenticated', 'rounds', 'SELECT'),
    ('authenticated', 'rounds', 'INSERT'),
    ('authenticated', 'rounds', 'UPDATE'),
    ('authenticated', 'rounds', 'DELETE'),
    ('authenticated', 'round_holes', 'SELECT'),
    ('authenticated', 'round_shots', 'SELECT'),
    ('authenticated', 'user_clubs', 'SELECT'),
    ('authenticated', 'user_clubs', 'INSERT'),
    ('authenticated', 'user_clubs', 'UPDATE'),
    ('authenticated', 'user_clubs', 'DELETE'),
    ('authenticated', 'club_distance_history', 'SELECT'),
    ('authenticated', 'club_distance_history', 'INSERT'),
    ('authenticated', 'club_distance_history', 'UPDATE'),
    ('authenticated', 'club_distance_history', 'DELETE')
)
select
  role_name,
  table_name,
  privilege_name,
  pg_catalog.has_table_privilege(
    role_name,
    pg_catalog.format('%I.%I', 'public', table_name),
    privilege_name
  ) as allowed
from required_privileges
order by table_name, privilege_name;

with required_privileges(role_name, table_name, privilege_name) as (
  values
    ('authenticated', 'profiles', 'SELECT'),
    ('authenticated', 'profiles', 'INSERT'),
    ('authenticated', 'profiles', 'UPDATE'),
    ('authenticated', 'rounds', 'SELECT'),
    ('authenticated', 'rounds', 'INSERT'),
    ('authenticated', 'rounds', 'UPDATE'),
    ('authenticated', 'rounds', 'DELETE'),
    ('authenticated', 'round_holes', 'SELECT'),
    ('authenticated', 'round_shots', 'SELECT'),
    ('authenticated', 'user_clubs', 'SELECT'),
    ('authenticated', 'user_clubs', 'INSERT'),
    ('authenticated', 'user_clubs', 'UPDATE'),
    ('authenticated', 'user_clubs', 'DELETE'),
    ('authenticated', 'club_distance_history', 'SELECT'),
    ('authenticated', 'club_distance_history', 'INSERT'),
    ('authenticated', 'club_distance_history', 'UPDATE'),
    ('authenticated', 'club_distance_history', 'DELETE')
)
select count(*) filter (where not pg_catalog.has_table_privilege(
  role_name,
  pg_catalog.format('%I.%I', 'public', table_name),
  privilege_name
))::integer as required_privilege_missing_count
from required_privileges;

-- 4. The current application service role only needs diagnostic RPC EXECUTE.
-- Both values must remain true; direct table DML is intentionally unchanged.
select
  pg_catalog.has_function_privilege(
    'service_role',
    'public.record_app_diagnostic(text, uuid, text, text, smallint, text, text, boolean, timestamptz, timestamptz, integer, timestamptz, integer)'::regprocedure,
    'EXECUTE'
  ) as record_diagnostic_execute,
  pg_catalog.has_function_privilege(
    'service_role',
    'public.purge_expired_app_diagnostics(timestamptz)'::regprocedure,
    'EXECUTE'
  ) as purge_diagnostics_execute;

-- 5. Record the remaining CRUD matrix without reading any table rows.
with effective_privileges as (
  select
    roles.role_name,
    tables.table_name,
    privileges.privilege_name,
    pg_catalog.has_table_privilege(
      roles.role_name,
      pg_catalog.format('%I.%I', 'public', tables.table_name),
      privileges.privilege_name
    ) as allowed
  from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
  cross join (values
    ('profiles'), ('rounds'), ('round_holes'), ('round_shots'),
    ('user_clubs'), ('club_distance_history'), ('app_diagnostics')
  ) as tables(table_name)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as privileges(privilege_name)
)
select role_name, table_name, privilege_name, allowed
from effective_privileges
order by role_name, table_name, privilege_name;

with anon_crud as (
  select pg_catalog.has_table_privilege(
    'anon',
    pg_catalog.format('%I.%I', 'public', tables.table_name),
    privileges.privilege_name
  ) as allowed
  from (values
    ('profiles'), ('rounds'), ('round_holes'), ('round_shots'),
    ('user_clubs'), ('club_distance_history'), ('app_diagnostics')
  ) as tables(table_name)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as privileges(privilege_name)
)
select count(*) filter (where allowed)::integer as anon_crud_violation_count
from anon_crud;

commit;
