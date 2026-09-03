begin transaction read only;

with target_function_catalog as (
  select
    functions.oid,
    functions.prosecdef,
    functions.provolatile,
    functions.proowner,
    pg_catalog.pg_get_userbyid(functions.proowner) as owner_name,
    pg_catalog.pg_get_function_identity_arguments(functions.oid) as identity_arguments,
    md5(pg_catalog.pg_get_functiondef(functions.oid)) as definition_hash,
    coalesce(functions.proconfig, array[]::text[]) as settings,
    has_function_privilege('public', functions.oid, 'EXECUTE') as public_execute,
    has_function_privilege('anon', functions.oid, 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', functions.oid, 'EXECUTE') as authenticated_execute
  from pg_catalog.pg_proc as functions
  join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
  where schemas.nspname = 'public'
    and functions.proname = 'get_home_round_state'
), target_function as (
  select
    case
      when count(*) = 0 then 'absent_expected'
      when count(*) = 1
        and bool_and(identity_arguments = 'p_limit integer, p_cursor jsonb')
        and bool_and(not prosecdef)
        and bool_and(provolatile = 's')
        and bool_and(owner_name = 'postgres')
        and bool_and(definition_hash = 'e43f9ab00acc164c18ca3c38cc8f059d')
        and bool_and(settings @> array['search_path=pg_catalog, public, auth'])
        and bool_and(not public_execute)
        and bool_and(not anon_execute)
        and bool_and(authenticated_execute)
        then 'exact_existing'
      else 'collision_blocker'
    end as status,
    count(*)::integer as function_count,
    max(definition_hash) as definition_hash
  from target_function_catalog
), target_index_catalog as (
  select
    indexes.indisvalid,
    indexes.indisready,
    indexes.indisunique,
    pg_catalog.pg_get_indexdef(indexes.indexrelid) as definition
  from pg_catalog.pg_class as index_relations
  join pg_catalog.pg_namespace as schemas on schemas.oid = index_relations.relnamespace
  join pg_catalog.pg_index as indexes on indexes.indexrelid = index_relations.oid
  where schemas.nspname = 'public'
    and index_relations.relname = 'rounds_user_status_played_updated_id_idx'
), target_index as (
  select
    case
      when count(*) = 0 then 'absent_expected'
      when count(*) = 1
        and bool_and(indisvalid and indisready and not indisunique)
        and bool_and(definition = 'CREATE INDEX rounds_user_status_played_updated_id_idx ON public.rounds USING btree (user_id, status, played_at_local DESC, updated_at DESC, id)')
        then 'exact_existing'
      else 'collision_blocker'
    end as status,
    count(*)::integer as index_count,
    max(definition) as definition
  from target_index_catalog
), prerequisites as (
  select
    count(*) filter (
      where functions.proname = 'calculate_round_stats_from_payload'
        and pg_catalog.pg_get_function_identity_arguments(functions.oid) = 'p_payload jsonb'
        and md5(pg_catalog.pg_get_functiondef(functions.oid)) = 'f605526003886eb6d5c6961e783ba48a'
    ) = 1
    and count(*) filter (
      where functions.proname = 'sync_round_summary_from_payload'
        and pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
        and md5(pg_catalog.pg_get_functiondef(functions.oid)) = 'f3ada2a5cc35ff1b1e55a2c4f8bea295'
    ) = 1 as summary_functions_exact
  from pg_catalog.pg_proc as functions
  join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
  where schemas.nspname = 'public'
    and functions.proname in ('calculate_round_stats_from_payload', 'sync_round_summary_from_payload')
), summary_trigger as (
  select count(*) = 1
    and bool_and(not triggers.tgisinternal)
    and bool_and(triggers.tgenabled = 'O')
    and bool_and(md5(pg_catalog.pg_get_triggerdef(triggers.oid, false)) = 'f3ad12dc7f57ec0506fd992887426b83')
    as exact
  from pg_catalog.pg_trigger as triggers
  where triggers.tgrelid = 'public.rounds'::regclass
    and triggers.tgname = 'rounds_sync_summary'
), data_counts as (
  select
    count(*)::bigint as round_count,
    count(*) filter (where status = 'in_progress')::bigint as draft_count,
    count(*) filter (where status = 'completed')::bigint as completed_count,
    count(*) filter (
      where status = 'completed'
        and (stats_summary is null or entered_holes is null)
    )::bigint as missing_summary_count
  from public.rounds
), blockers as (
  select
    ((select status from target_function) = 'collision_blocker')::integer as target_function,
    ((select status from target_index) = 'collision_blocker')::integer as target_index,
    (not (select summary_functions_exact from prerequisites))::integer as summary_functions,
    (not (select exact from summary_trigger))::integer as summary_trigger,
    ((select missing_summary_count from data_counts) > 0)::integer as missing_summary
)
select jsonb_build_object(
  'formatVersion', 1,
  'targetMigration', '202609030003_home_round_state.sql',
  'gateStatus', case when
    blocker_values.target_function + blocker_values.target_index + blocker_values.summary_functions
      + blocker_values.summary_trigger + blocker_values.missing_summary = 0
    then 'READY' else 'BLOCKED' end,
  'blockerCounts', jsonb_build_object(
    'targetFunction', blocker_values.target_function,
    'targetIndex', blocker_values.target_index,
    'summaryFunctions', blocker_values.summary_functions,
    'summaryTrigger', blocker_values.summary_trigger,
    'missingSummary', blocker_values.missing_summary
  ),
  'targetFunction', to_jsonb(target_function_state),
  'targetIndex', to_jsonb(target_index_state),
  'prerequisites', jsonb_build_object(
    'summaryFunctionsExact', prerequisites.summary_functions_exact,
    'summaryTriggerExact', summary_trigger.exact
  ),
  'impactCounts', to_jsonb(data_counts)
)
from target_function as target_function_state
cross join target_index as target_index_state
cross join prerequisites
cross join summary_trigger
cross join data_counts
cross join blockers as blocker_values;

rollback;
