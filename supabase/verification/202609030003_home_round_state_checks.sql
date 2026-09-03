begin transaction read only;

select jsonb_build_object(
  'functionCount', count(*),
  'securityInvoker', bool_and(not functions.prosecdef),
  'volatilityStable', bool_and(functions.provolatile = 's'),
  'authenticatedExecute', bool_and(has_function_privilege(
    'authenticated',
    'public.get_home_round_state(integer, jsonb)',
    'EXECUTE'
  )),
  'anonExecute', bool_or(has_function_privilege(
    'anon',
    'public.get_home_round_state(integer, jsonb)',
    'EXECUTE'
  ))
)
from pg_catalog.pg_proc as functions
where functions.oid = 'public.get_home_round_state(integer, jsonb)'::regprocedure;

select jsonb_build_object(
  'completedTotal', count(*) filter (where status = 'completed'),
  'missingSummary', count(*) filter (
    where status = 'completed'
      and (stats_summary is null or entered_holes is null)
  )
)
from public.rounds
where user_id = auth.uid();

rollback;
