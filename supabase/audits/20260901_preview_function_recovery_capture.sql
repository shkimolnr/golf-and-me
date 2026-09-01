-- Capture the existing Preview function as a schema-only recovery bundle.
-- The result contains function DDL and ACL metadata, but no application rows.
-- Run only in the approved Preview project, never in Production.

begin transaction read only;

with target as (
  select
    functions.oid,
    functions.proowner,
    functions.proacl,
    functions.proname || '(' ||
      pg_catalog.pg_get_function_identity_arguments(functions.oid) || ')' as function_identity,
    pg_catalog.pg_get_userbyid(functions.proowner) as owner_name,
    functions.prosecdef as security_definer,
    functions.proleakproof as leakproof,
    functions.provolatile as volatility,
    functions.proparallel as parallel_safety,
    coalesce(to_jsonb(functions.proconfig), '[]'::jsonb) as settings,
    pg_catalog.pg_get_functiondef(functions.oid) as definition_sql
  from pg_catalog.pg_proc as functions
  join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
  where schemas.nspname = 'public'
    and functions.proname = 'sync_round_children_from_payload'
    and pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
), acl_entries as (
  select
    target.oid,
    case
      when access.grantee = 0 then 'PUBLIC'
      else coalesce(grantees.rolname, '<dropped-role-oid:' || access.grantee::text || '>')
    end as grantee,
    access.privilege_type,
    access.is_grantable
  from target
  cross join lateral pg_catalog.aclexplode(
    coalesce(target.proacl, pg_catalog.acldefault('f', target.proowner))
  ) as access
  left join pg_catalog.pg_roles as grantees on grantees.oid = access.grantee
)
select jsonb_pretty(jsonb_build_object(
  'formatVersion', 1,
  'serverVersionNum', current_setting('server_version_num'),
  'functionIdentity', target.function_identity,
  'ownerName', target.owner_name,
  'securityDefiner', target.security_definer,
  'leakproof', target.leakproof,
  'volatility', target.volatility,
  'parallelSafety', target.parallel_safety,
  'settings', target.settings,
  'definitionHash', md5(target.definition_sql),
  'definitionSql', target.definition_sql,
  'acl', coalesce((
    select jsonb_agg(jsonb_build_object(
      'grantee', acl_entries.grantee,
      'privilege', acl_entries.privilege_type,
      'grantable', acl_entries.is_grantable
    ) order by acl_entries.grantee, acl_entries.privilege_type)
    from acl_entries
    where acl_entries.oid = target.oid
  ), '[]'::jsonb)
)) as schema_only_recovery_bundle
from target;

commit;
