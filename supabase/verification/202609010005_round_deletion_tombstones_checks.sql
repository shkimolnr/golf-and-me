-- Post-apply READ ONLY checks for migration 202609010005.
-- Returns catalog metadata and aggregate counts only; no application row values.

begin transaction read only;

with
data_counts as (
  select
    (select count(*)::bigint
      from public.round_tombstones as tombstones
      join public.rounds as rounds on rounds.id = tombstones.round_id)
      as active_tombstone_overlap_count,
    (select count(*)::bigint
      from public.round_tombstones as tombstones
      left join auth.users as users on users.id = tombstones.user_id
      where users.id is null)
      as tombstone_user_orphan_count
),
privilege_checks as (
  select
    count(*) filter (where
      case
        when roles.role_name = 'authenticated' and privileges.privilege_name = 'SELECT'
          then not pg_catalog.has_table_privilege(
            roles.role_name, 'public.round_tombstones', privileges.privilege_name)
        else pg_catalog.has_table_privilege(
          roles.role_name, 'public.round_tombstones', privileges.privilege_name)
      end
    )::integer as privilege_violation_count
  from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
  cross join (values
    ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
    ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
  ) as privileges(privilege_name)
),
object_counts as (
  select
    (select count(*)::integer
      from pg_catalog.pg_proc as functions
      join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
      where schemas.nspname = 'public'
        and functions.proname in (
          'record_round_tombstone_before_delete',
          'reject_tombstoned_round_write'
        )
        and pg_catalog.pg_get_function_identity_arguments(functions.oid) = '')
      as function_count,
    (select count(*)::integer
      from pg_catalog.pg_trigger as triggers
      where triggers.tgrelid = 'public.rounds'::regclass
        and triggers.tgname in (
          'rounds_00_record_tombstone_before_delete',
          'rounds_00_reject_tombstoned_write'
        )
        and not triggers.tgisinternal
        and triggers.tgenabled = 'O')
      as enabled_trigger_count,
    (select count(*)::integer
      from pg_catalog.pg_policy as policies
      where policies.polrelid = 'public.round_tombstones'::regclass
        and policies.polname = 'round_tombstones_select_own')
      as policy_count
)
select jsonb_build_object(
  'activeTombstoneOverlapCount', active_tombstone_overlap_count,
  'tombstoneUserOrphanCount', tombstone_user_orphan_count,
  'privilegeViolationCount', privilege_violation_count,
  'functionCount', function_count,
  'enabledTriggerCount', enabled_trigger_count,
  'policyCount', policy_count
) as migration_005_checks
from data_counts
cross join privilege_checks
cross join object_counts;

commit;
