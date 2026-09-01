-- Golf&Me Preview 전용 읽기 전용 카탈로그 감사
-- Production에서 실행하지 않는다.
-- 행 데이터 값은 반환하지 않으며 schema metadata와 집계 건수만 반환한다.

begin transaction read only;

-- 1. 컬럼
select
  columns.table_name,
  columns.ordinal_position,
  columns.column_name,
  columns.data_type,
  columns.udt_schema,
  columns.udt_name,
  columns.is_nullable,
  columns.is_identity,
  columns.identity_generation,
  columns.is_generated,
  columns.generation_expression,
  columns.column_default
from information_schema.columns
where columns.table_schema = 'public'
  and columns.table_name in (
    'profiles', 'rounds', 'round_holes', 'round_shots',
    'user_clubs', 'club_distance_history', 'app_diagnostics'
  )
order by columns.table_name, columns.ordinal_position;

-- 2. 제약
select
  tables.relname as table_name,
  constraints.conname as constraint_name,
  case constraints.contype
    when 'p' then 'PRIMARY KEY'
    when 'f' then 'FOREIGN KEY'
    when 'u' then 'UNIQUE'
    when 'c' then 'CHECK'
    when 'x' then 'EXCLUSION'
    else constraints.contype::text
  end as constraint_type,
  constraints.convalidated as validated,
  constraints.condeferrable as deferrable,
  constraints.condeferred as initially_deferred,
  pg_get_constraintdef(constraints.oid, true) as constraint_definition
from pg_catalog.pg_constraint as constraints
join pg_catalog.pg_class as tables on tables.oid = constraints.conrelid
join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
where schemas.nspname = 'public'
  and tables.relname in (
    'profiles', 'rounds', 'round_holes', 'round_shots',
    'user_clubs', 'club_distance_history', 'app_diagnostics'
  )
order by tables.relname, constraint_type, constraints.conname;

-- 3. 인덱스
select
  tables.relname as table_name,
  indexes.relname as index_name,
  index_metadata.indisprimary as is_primary,
  index_metadata.indisunique as is_unique,
  index_metadata.indisvalid as is_valid,
  index_metadata.indisready as is_ready,
  pg_get_indexdef(index_metadata.indexrelid) as index_definition
from pg_catalog.pg_index as index_metadata
join pg_catalog.pg_class as tables on tables.oid = index_metadata.indrelid
join pg_catalog.pg_class as indexes on indexes.oid = index_metadata.indexrelid
join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
where schemas.nspname = 'public'
  and tables.relname in (
    'profiles', 'rounds', 'round_holes', 'round_shots',
    'user_clubs', 'club_distance_history', 'app_diagnostics'
  )
order by tables.relname, indexes.relname;

-- 4. RLS 활성 상태와 policy
select
  tables.relname as table_name,
  tables.relrowsecurity as rls_enabled,
  tables.relforcerowsecurity as rls_forced
from pg_catalog.pg_class as tables
join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
where schemas.nspname = 'public'
  and tables.relkind in ('r', 'p')
  and tables.relname in (
    'profiles', 'rounds', 'round_holes', 'round_shots',
    'user_clubs', 'club_distance_history', 'app_diagnostics'
  )
order by tables.relname;

select
  policies.tablename as table_name,
  policies.policyname as policy_name,
  policies.permissive,
  policies.roles,
  policies.cmd,
  policies.qual as using_expression,
  policies.with_check as check_expression
from pg_catalog.pg_policies as policies
where policies.schemaname = 'public'
  and policies.tablename in (
    'profiles', 'rounds', 'round_holes', 'round_shots',
    'user_clubs', 'club_distance_history', 'app_diagnostics'
  )
order by policies.tablename, policies.policyname;

-- 5. anon/authenticated/service_role의 effective table 권한
with audited_roles(role_name) as (
  values ('anon'), ('authenticated'), ('service_role')
), audited_tables(table_name) as (
  values
    ('profiles'), ('rounds'), ('round_holes'), ('round_shots'),
    ('user_clubs'), ('club_distance_history'), ('app_diagnostics')
), audited_privileges(privilege_name) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
)
select
  roles.role_name,
  tables.table_name,
  privileges.privilege_name,
  has_table_privilege(
    roles.role_name,
    format('%I.%I', 'public', tables.table_name),
    privileges.privilege_name
  ) as allowed
from audited_roles as roles
cross join audited_tables as tables
cross join audited_privileges as privileges
where exists (select 1 from pg_catalog.pg_roles where rolname = roles.role_name)
order by roles.role_name, tables.table_name, privileges.privilege_name;

-- 6. public sequence 권한
with audited_roles(role_name) as (
  values ('anon'), ('authenticated'), ('service_role')
), audited_privileges(privilege_name) as (
  values ('USAGE'), ('SELECT'), ('UPDATE')
)
select
  roles.role_name,
  sequences.relname as sequence_name,
  privileges.privilege_name,
  has_sequence_privilege(
    roles.role_name,
    format('%I.%I', schemas.nspname, sequences.relname),
    privileges.privilege_name
  ) as allowed
from audited_roles as roles
cross join audited_privileges as privileges
cross join pg_catalog.pg_class as sequences
join pg_catalog.pg_namespace as schemas on schemas.oid = sequences.relnamespace
where schemas.nspname = 'public'
  and sequences.relkind = 'S'
  and exists (select 1 from pg_catalog.pg_roles where rolname = roles.role_name)
order by roles.role_name, sequences.relname, privileges.privilege_name;

-- 7. 함수 존재, 보안 속성, owner, 설정과 정의 hash
with expected_functions(function_name) as (
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
)
select
  expected.function_name,
  count(functions.oid)::integer as overload_count
from expected_functions as expected
left join pg_catalog.pg_proc as functions
  on functions.proname = expected.function_name
 and functions.pronamespace = (
   select oid from pg_catalog.pg_namespace where nspname = 'public'
 )
group by expected.function_name
order by expected.function_name;

select
  functions.proname as function_name,
  pg_get_function_identity_arguments(functions.oid) as identity_arguments,
  pg_get_userbyid(functions.proowner) as owner_name,
  languages.lanname as language_name,
  functions.prosecdef as security_definer,
  functions.proleakproof as leakproof,
  functions.provolatile as volatility,
  functions.proparallel as parallel_safety,
  coalesce(array_to_string(functions.proconfig, ', '), '') as function_settings,
  md5(pg_get_functiondef(functions.oid)) as definition_hash
from pg_catalog.pg_proc as functions
join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
join pg_catalog.pg_language as languages on languages.oid = functions.prolang
where schemas.nspname = 'public'
  and functions.proname in (
    'calculate_round_stats_from_payload',
    'delete_own_account',
    'handle_new_user',
    'keep_newest_round_version',
    'purge_expired_app_diagnostics',
    'record_app_diagnostic',
    'rls_auto_enable',
    'sync_round_children_from_payload',
    'sync_round_summary_from_payload'
  )
order by functions.proname, identity_arguments;

-- 8. 대상 함수의 effective EXECUTE 권한
with audited_roles(role_name) as (
  values ('anon'), ('authenticated'), ('service_role')
)
select
  roles.role_name,
  functions.proname as function_name,
  pg_get_function_identity_arguments(functions.oid) as identity_arguments,
  has_function_privilege(roles.role_name, functions.oid, 'EXECUTE') as execute_allowed
from audited_roles as roles
cross join pg_catalog.pg_proc as functions
join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
where schemas.nspname = 'public'
  and functions.proname in (
    'calculate_round_stats_from_payload',
    'delete_own_account',
    'handle_new_user',
    'keep_newest_round_version',
    'purge_expired_app_diagnostics',
    'record_app_diagnostic',
    'rls_auto_enable',
    'sync_round_children_from_payload',
    'sync_round_summary_from_payload'
  )
  and exists (select 1 from pg_catalog.pg_roles where rolname = roles.role_name)
order by roles.role_name, functions.proname, identity_arguments;

-- 9. rls_auto_enable 전용 요약. 정의 원문은 반환하지 않는다.
select
  functions.proname as function_name,
  pg_get_function_identity_arguments(functions.oid) as identity_arguments,
  pg_get_userbyid(functions.proowner) as owner_name,
  functions.prosecdef as security_definer,
  coalesce(array_to_string(functions.proconfig, ', '), '') as function_settings,
  md5(pg_get_functiondef(functions.oid)) as definition_hash,
  has_function_privilege('anon', functions.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', functions.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', functions.oid, 'EXECUTE') as service_role_execute
from pg_catalog.pg_proc as functions
join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
where schemas.nspname = 'public'
  and functions.proname = 'rls_auto_enable'
order by identity_arguments;

-- 10. trigger 구조. 함수/trigger 정의 원문 대신 hash만 반환한다.
select
  tables.relname as table_name,
  triggers.tgname as trigger_name,
  triggers.tgenabled as enabled_state,
  functions.proname as function_name,
  md5(pg_get_triggerdef(triggers.oid, true)) as trigger_definition_hash
from pg_catalog.pg_trigger as triggers
join pg_catalog.pg_class as tables on tables.oid = triggers.tgrelid
join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
join pg_catalog.pg_proc as functions on functions.oid = triggers.tgfoid
where schemas.nspname in ('public', 'auth')
  and not triggers.tgisinternal
  and (
    (schemas.nspname = 'public' and tables.relname = 'rounds')
    or (schemas.nspname = 'auth' and tables.relname = 'users')
  )
order by schemas.nspname, tables.relname, triggers.tgname;

-- 11. orphan과 소유자 불일치. 결과는 집계 건수만 반환한다.
select 'profiles_auth_orphan' as check_name, count(*)::bigint as violation_count
from public.profiles as profiles
left join auth.users as users on users.id = profiles.id
where users.id is null
union all
select 'rounds_auth_orphan', count(*)::bigint
from public.rounds as rounds
left join auth.users as users on users.id = rounds.user_id
where users.id is null
union all
select 'round_holes_auth_orphan', count(*)::bigint
from public.round_holes as holes
left join auth.users as users on users.id = holes.user_id
where users.id is null
union all
select 'round_shots_auth_orphan', count(*)::bigint
from public.round_shots as shots
left join auth.users as users on users.id = shots.user_id
where users.id is null
union all
select 'user_clubs_auth_orphan', count(*)::bigint
from public.user_clubs as clubs
left join auth.users as users on users.id = clubs.user_id
where users.id is null
union all
select 'club_distance_auth_orphan', count(*)::bigint
from public.club_distance_history as distances
left join auth.users as users on users.id = distances.user_id
where users.id is null
union all
select 'round_holes_parent_orphan', count(*)::bigint
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
order by check_name;

-- 12. payload와 홀·샷 파생 cache의 개수 및 필드 불일치 건수
with safe_round_payloads as (
  select
    rounds.id as round_id,
    case when jsonb_typeof(rounds.payload->'holes') = 'array'
      then rounds.payload->'holes' else '[]'::jsonb end as holes
  from public.rounds as rounds
), expected_holes as (
  select
    payloads.round_id,
    case
      when jsonb_typeof(hole.value->'holeNumber') = 'number'
        and (hole.value->>'holeNumber')::numeric between 1 and 18
        then (hole.value->>'holeNumber')::smallint
      else hole.ordinality::smallint
    end as hole_number,
    hole.value as payload
  from safe_round_payloads as payloads
  cross join lateral jsonb_array_elements(payloads.holes)
    with ordinality as hole(value, ordinality)
), expected_shots as (
  select
    holes.round_id,
    holes.hole_number,
    case
      when jsonb_typeof(shot.value->'sequence') = 'number'
        and (shot.value->>'sequence')::numeric between 1 and 32767
        then (shot.value->>'sequence')::smallint
      else shot.ordinality::smallint
    end as shot_sequence,
    shot.value as payload
  from expected_holes as holes
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(holes.payload->'shots') = 'array'
      then holes.payload->'shots' else '[]'::jsonb end
  ) with ordinality as shot(value, ordinality)
), expected_counts as (
  select
    payloads.round_id,
    jsonb_array_length(payloads.holes)::bigint as hole_count,
    coalesce(sum(
      case when jsonb_typeof(hole.value->'shots') = 'array'
        then jsonb_array_length(hole.value->'shots') else 0 end
    ), 0)::bigint as shot_count
  from safe_round_payloads as payloads
  left join lateral jsonb_array_elements(payloads.holes) as hole(value) on true
  group by payloads.round_id, payloads.holes
), actual_hole_counts as (
  select round_id, count(*)::bigint as hole_count
  from public.round_holes
  group by round_id
), actual_shot_counts as (
  select round_id, count(*)::bigint as shot_count
  from public.round_shots
  group by round_id
)
select 'invalid_holes_container' as check_name, count(*)::bigint as mismatch_count
from public.rounds
where payload ? 'holes' and jsonb_typeof(payload->'holes') <> 'array'
union all
select 'round_hole_count_mismatch', count(*)::bigint
from expected_counts as expected
left join actual_hole_counts as actual using (round_id)
where expected.hole_count is distinct from coalesce(actual.hole_count, 0)
union all
select 'round_shot_count_mismatch', count(*)::bigint
from expected_counts as expected
left join actual_shot_counts as actual using (round_id)
where expected.shot_count is distinct from coalesce(actual.shot_count, 0)
union all
select 'round_hole_field_mismatch', count(*)::bigint
from expected_holes as expected
join public.round_holes as actual
  on actual.round_id = expected.round_id
 and actual.hole_number = expected.hole_number
where actual.payload is distinct from expected.payload
  or to_jsonb(actual)->'official_hole_number' is distinct from expected.payload->'sourceOfficialHole'
  or to_jsonb(actual)->'distance' is distinct from expected.payload->'distance'
  or to_jsonb(actual)->'score' is distinct from expected.payload->'score'
  or to_jsonb(actual)->'swing_count' is distinct from expected.payload->'swingCount'
  or to_jsonb(actual)->'putts' is distinct from expected.payload->'putts'
union all
select 'round_shot_field_mismatch', count(*)::bigint
from expected_shots as expected
join public.round_shots as actual
  on actual.round_id = expected.round_id
 and actual.hole_number = expected.hole_number
 and actual.shot_sequence = expected.shot_sequence
where actual.payload is distinct from expected.payload
  or to_jsonb(actual)->'club_client_id' is distinct from case
    when nullif(expected.payload->>'clubId', '') is not null
      then to_jsonb(nullif(expected.payload->>'clubId', '')) else null end
  or to_jsonb(actual)->'club_snapshot' is distinct from case
    when jsonb_typeof(expected.payload->'clubSnapshot') = 'object'
      then expected.payload->'clubSnapshot' else null end
  or to_jsonb(actual)->'remaining_distance' is distinct from expected.payload->'remainingDistance'
  or to_jsonb(actual)->'trouble_direction' is distinct from case
    when nullif(expected.payload->>'troubleDirection', '') is not null
      then to_jsonb(nullif(expected.payload->>'troubleDirection', '')) else null end
  or to_jsonb(actual)->'trouble_type' is distinct from case
    when nullif(expected.payload->>'troubleType', '') is not null
      then to_jsonb(nullif(expected.payload->>'troubleType', '')) else null end
  or to_jsonb(actual)->'ob_relief' is distinct from case
    when nullif(expected.payload->>'obRelief', '') is not null
      then to_jsonb(nullif(expected.payload->>'obRelief', '')) else null end
order by check_name;

-- 13. rounds.payload와 요약 cache의 의미적 불일치 건수
with expected_summaries as (
  select
    rounds.id,
    calculated.summary
  from public.rounds as rounds
  cross join lateral (
    with holes as (
      select
        hole.ordinality,
        case when jsonb_typeof(hole.value->'score') = 'number'
          then (hole.value->>'score')::smallint end as score,
        case when jsonb_typeof(hole.value->'par') = 'number'
          then (hole.value->>'par')::smallint end as par,
        case
          when jsonb_typeof(hole.value->'officialPutts') = 'number'
            then (hole.value->>'officialPutts')::smallint
          when jsonb_typeof(hole.value->'putts') = 'number'
            then (hole.value->>'putts')::smallint
        end as putts,
        case when jsonb_typeof(hole.value->'penaltyStrokes') = 'number'
          then (hole.value->>'penaltyStrokes')::smallint else 0 end as penalty_strokes,
        case when jsonb_typeof(hole.value->'obCount') = 'number'
          then (hole.value->>'obCount')::smallint else 0 end as ob_count,
        case when jsonb_typeof(hole.value->'penaltyCount') = 'number'
          then (hole.value->>'penaltyCount')::smallint else 0 end as penalty_count,
        case when jsonb_typeof(hole.value->'fir') = 'boolean'
          then (hole.value->>'fir')::boolean end as fir,
        case when jsonb_typeof(hole.value->'gir') = 'boolean'
          then (hole.value->>'gir')::boolean end as gir
      from jsonb_array_elements(
        case when jsonb_typeof(rounds.payload->'holes') = 'array'
          then rounds.payload->'holes' else '[]'::jsonb end
      ) with ordinality as hole(value, ordinality)
    ), scored as (
      select
        ordinality, score, par, putts, penalty_strokes, ob_count, penalty_count, fir, gir
      from holes
      where score is not null
    ), aggregate_values as (
      select
        count(*)::integer as entered_holes,
        count(par)::integer as par_recorded_holes,
        coalesce(sum(score), 0)::integer as total_score,
        coalesce(sum(par) filter (where par is not null), 0)::integer as total_par,
        case when count(par) > 0
          then sum(score - par) filter (where par is not null)::integer end as score_to_par,
        coalesce(sum(score) filter (where ordinality <= 9), 0)::integer as front_score,
        coalesce(sum(score) filter (where ordinality > 9 and ordinality <= 18), 0)::integer as back_score,
        case when count(par) filter (where ordinality <= 9) > 0
          then sum(score - par) filter (where ordinality <= 9 and par is not null)::integer end as front_to_par,
        case when count(par) filter (where ordinality > 9 and ordinality <= 18) > 0
          then sum(score - par) filter (where ordinality > 9 and ordinality <= 18 and par is not null)::integer end as back_to_par,
        count(*) filter (where par is not null and score - par = 0)::integer as par_count,
        count(*) filter (where par is not null and score - par = 1)::integer as bogey_count,
        count(*) filter (where par is not null and score - par = 2)::integer as double_bogey_count,
        count(*) filter (where par is not null and score - par >= 3)::integer as triple_plus_count,
        count(*) filter (where score = 1)::integer as hole_in_one_count,
        coalesce(sum(putts) filter (where putts is not null), 0)::integer as total_putts,
        count(putts)::integer as putt_attempts,
        count(*) filter (where putts = 1)::integer as one_putt_count,
        count(*) filter (where putts = 2)::integer as two_putt_count,
        count(*) filter (where putts >= 3)::integer as three_plus_putt_count,
        coalesce(sum(penalty_strokes), 0)::integer as penalty_strokes,
        coalesce(sum(ob_count), 0)::integer as ob_count,
        coalesce(sum(penalty_count), 0)::integer as penalty_count,
        count(*) filter (where par is distinct from 3 and fir is true)::integer as fir_hits,
        count(*) filter (where par is distinct from 3 and fir is not null)::integer as fir_attempts,
        count(*) filter (where gir is true)::integer as gir_hits,
        count(*) filter (where gir is not null)::integer as gir_attempts
      from scored
    ), outcome_counts as (
      select
        case when score - par >= 3 then 'triplePlus' else (score - par)::text end as key,
        case when score - par >= 3 then 3 else score - par end as value,
        count(*)::integer as count
      from scored
      where par is not null
      group by 1, 2
    ), outcomes as (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'key', key,
            'value', value,
            'label', case
              when key = 'triplePlus' then '트리플+'
              when value <= -4 then value::text
              when value = -3 then '알바트로스'
              when value = -2 then '이글'
              when value = -1 then '버디'
              when value = 0 then '파'
              when value = 1 then '보기'
              else '더블'
            end,
            'count', count
          ) order by value
        ),
        '[]'::jsonb
      ) as score_outcomes
      from outcome_counts
    )
    select jsonb_build_object(
      'enteredHoles', aggregates.entered_holes,
      'parRecordedHoles', aggregates.par_recorded_holes,
      'missingParHoles', aggregates.entered_holes - aggregates.par_recorded_holes,
      'totalScore', aggregates.total_score,
      'totalPar', aggregates.total_par,
      'toPar', aggregates.score_to_par,
      'frontScore', aggregates.front_score,
      'backScore', aggregates.back_score,
      'frontToPar', aggregates.front_to_par,
      'backToPar', aggregates.back_to_par,
      'parCount', aggregates.par_count,
      'bogeyCount', aggregates.bogey_count,
      'doubleBogeyCount', aggregates.double_bogey_count,
      'triplePlusCount', aggregates.triple_plus_count,
      'scoreOutcomes', outcomes.score_outcomes,
      'holeInOneCount', aggregates.hole_in_one_count,
      'totalPutts', aggregates.total_putts,
      'puttAttempts', aggregates.putt_attempts,
      'averagePutts', case when aggregates.putt_attempts > 0
        then aggregates.total_putts::numeric / aggregates.putt_attempts end,
      'onePuttCount', aggregates.one_putt_count,
      'twoPuttCount', aggregates.two_putt_count,
      'threePlusPuttCount', aggregates.three_plus_putt_count,
      'penaltyStrokes', aggregates.penalty_strokes,
      'obCount', aggregates.ob_count,
      'penaltyCount', aggregates.penalty_count,
      'firHits', aggregates.fir_hits,
      'firAttempts', aggregates.fir_attempts,
      'girHits', aggregates.gir_hits,
      'girAttempts', aggregates.gir_attempts
    ) as summary
    from aggregate_values as aggregates
    cross join outcomes
  ) as calculated
)
select
  count(*) filter (where row(
    (to_jsonb(rounds)->>'entered_holes')::smallint,
    (to_jsonb(rounds)->>'par_recorded_holes')::smallint,
    (to_jsonb(rounds)->>'total_score')::smallint,
    (to_jsonb(rounds)->>'score_to_par')::smallint,
    (to_jsonb(rounds)->>'total_putts')::smallint,
    (to_jsonb(rounds)->>'putt_attempts')::smallint,
    (to_jsonb(rounds)->>'fir_hits')::smallint,
    (to_jsonb(rounds)->>'fir_attempts')::smallint,
    (to_jsonb(rounds)->>'gir_hits')::smallint,
    (to_jsonb(rounds)->>'gir_attempts')::smallint
  ) is distinct from row(
    (expected.summary->>'enteredHoles')::smallint,
    (expected.summary->>'parRecordedHoles')::smallint,
    case when (expected.summary->>'enteredHoles')::smallint > 0
      then (expected.summary->>'totalScore')::smallint end,
    (expected.summary->>'toPar')::smallint,
    case when (expected.summary->>'puttAttempts')::smallint > 0
      then (expected.summary->>'totalPutts')::smallint end,
    (expected.summary->>'puttAttempts')::smallint,
    (expected.summary->>'firHits')::smallint,
    (expected.summary->>'firAttempts')::smallint,
    (expected.summary->>'girHits')::smallint,
    (expected.summary->>'girAttempts')::smallint
  ))::bigint as summary_column_mismatch_count,
  count(*) filter (
    where to_jsonb(rounds)->'stats_summary' is distinct from expected.summary
  )::bigint as stats_summary_mismatch_count
from public.rounds as rounds
join expected_summaries as expected using (id);

commit;
