-- Preview schema/data preflight for migration 202609030002.
-- Returns one catalog-only JSON value plus aggregate data counts.
-- It never returns application row values and never changes the database.

begin transaction read only;

with
expected_columns(column_name, data_type, not_null, default_kind) as (
  values
    ('payload', 'jsonb', true, 'none'),
    ('entered_holes', 'smallint', true, 'zero'),
    ('par_recorded_holes', 'smallint', true, 'zero'),
    ('total_score', 'smallint', false, 'none'),
    ('score_to_par', 'smallint', false, 'none'),
    ('total_putts', 'smallint', false, 'none'),
    ('putt_attempts', 'smallint', true, 'zero'),
    ('fir_hits', 'smallint', true, 'zero'),
    ('fir_attempts', 'smallint', true, 'zero'),
    ('gir_hits', 'smallint', true, 'zero'),
    ('gir_attempts', 'smallint', true, 'zero'),
    ('stats_summary', 'jsonb', true, 'empty_object')
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
      when attributes.attname is null then 'absent_blocker'
      when pg_catalog.format_type(attributes.atttypid, attributes.atttypmod) <> expected.data_type
        or attributes.attnotnull <> expected.not_null then 'definition_mismatch_blocker'
      when expected.default_kind = 'none' and defaults.adbin is not null
        then 'default_mismatch_blocker'
      when expected.default_kind = 'zero'
        and (defaults.adbin is null
          or pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid) not in ('0', '0::smallint'))
        then 'default_mismatch_blocker'
      when expected.default_kind = 'empty_object'
        and (defaults.adbin is null
          or pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid) <> '''{}''::jsonb')
        then 'default_mismatch_blocker'
      else 'exact_existing'
    end as status
  from expected_columns as expected
  left join pg_catalog.pg_namespace as schemas on schemas.nspname = 'public'
  left join pg_catalog.pg_class as tables
    on tables.relnamespace = schemas.oid
   and tables.relname = 'rounds'
   and tables.relkind in ('r', 'p')
  left join pg_catalog.pg_attribute as attributes
    on attributes.attrelid = tables.oid
   and attributes.attname = expected.column_name
   and attributes.attnum > 0
   and not attributes.attisdropped
  left join pg_catalog.pg_attrdef as defaults
    on defaults.adrelid = attributes.attrelid
   and defaults.adnum = attributes.attnum
),
expected_checks(constraint_name, definition_pattern) as (
  values
    ('rounds_entered_holes_check', 'entered_holes.*>= 0.*entered_holes.*<= 18'),
    ('rounds_par_recorded_holes_check', 'par_recorded_holes.*>= 0.*par_recorded_holes.*<= 18'),
    ('rounds_putt_attempts_check', 'putt_attempts.*>= 0.*putt_attempts.*<= 18'),
    ('rounds_fir_hits_check', 'fir_hits.*>= 0'),
    ('rounds_fir_attempts_check', 'fir_attempts.*>= 0'),
    ('rounds_gir_hits_check', 'gir_hits.*>= 0'),
    ('rounds_gir_attempts_check', 'gir_attempts.*>= 0')
),
check_constraint_checks as (
  select
    expected.constraint_name,
    pg_catalog.pg_get_constraintdef(constraints.oid, false) as actual_definition,
    constraints.convalidated,
    case
      when constraints.oid is null then 'absent_blocker'
      when constraints.contype <> 'c'
        or not constraints.convalidated
        or pg_catalog.pg_get_constraintdef(constraints.oid, false) !~ expected.definition_pattern
        then 'definition_mismatch_blocker'
      else 'exact_existing'
    end as status
  from expected_checks as expected
  left join pg_catalog.pg_constraint as constraints
    on constraints.conname = expected.constraint_name
   and constraints.conrelid = pg_catalog.to_regclass('public.rounds')
),
expected_002_indexes(index_name, table_name, key_columns) as (
  values
    ('rounds_id_user_uidx', 'rounds', array['id', 'user_id']::text[]),
    ('round_holes_round_hole_user_uidx', 'round_holes', array['round_id', 'hole_number', 'user_id']::text[]),
    ('user_clubs_id_user_uidx', 'user_clubs', array['id', 'user_id']::text[])
),
prerequisite_index_checks as (
  select
    expected.index_name,
    expected.table_name,
    expected.key_columns as expected_key_columns,
    indexed_tables.relname as actual_table_name,
    actual_keys.key_columns as actual_key_columns,
    case
      when indexes.oid is null then 'missing_002_blocker'
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
        then 'definition_mismatch_002_blocker'
      else 'exact_002'
    end as status
  from expected_002_indexes as expected
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
expected_002_constraints(
  constraint_name, table_name, key_columns, referenced_table_name, referenced_columns
) as (
  values
    ('round_holes_round_user_fkey', 'round_holes', array['round_id', 'user_id']::text[],
      'rounds', array['id', 'user_id']::text[]),
    ('round_shots_round_hole_user_fkey', 'round_shots', array['round_id', 'hole_number', 'user_id']::text[],
      'round_holes', array['round_id', 'hole_number', 'user_id']::text[]),
    ('club_distance_history_club_user_fkey', 'club_distance_history', array['club_id', 'user_id']::text[],
      'user_clubs', array['id', 'user_id']::text[])
),
prerequisite_constraint_checks as (
  select
    expected.constraint_name,
    expected.table_name,
    expected.key_columns as expected_key_columns,
    expected.referenced_table_name,
    expected.referenced_columns,
    actual_keys.key_columns as actual_key_columns,
    referenced_tables.relname as actual_referenced_table_name,
    referenced_keys.key_columns as actual_referenced_columns,
    constraints.convalidated,
    case
      when constraints.oid is null then 'missing_002_blocker'
      when constraints.contype <> 'f'
        or constraints.convalidated is not true
        or constraints.condeferrable is not false
        or constraints.condeferred is not false
        or constraints.confdeltype <> 'c'
        or constraints.confmatchtype <> 's'
        or actual_keys.key_columns is distinct from expected.key_columns
        or referenced_tables.relname is distinct from expected.referenced_table_name
        or referenced_keys.key_columns is distinct from expected.referenced_columns
        then 'definition_mismatch_002_blocker'
      else 'exact_002'
    end as status
  from expected_002_constraints as expected
  left join pg_catalog.pg_class as child_tables
    on child_tables.oid = pg_catalog.to_regclass(pg_catalog.format('public.%I', expected.table_name))
  left join pg_catalog.pg_constraint as constraints
    on constraints.conrelid = child_tables.oid
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
prerequisite_sync_function as (
  select
    count(functions.oid)::integer as function_count,
    min(pg_catalog.pg_get_userbyid(functions.proowner)) as owner_name,
    min(md5(pg_catalog.pg_get_functiondef(functions.oid))) as actual_definition_hash,
    '055b059c2c323c69234ba1ac2f526c95'::text as expected_definition_hash,
    case
      when count(functions.oid) <> 1 then 'missing_or_overloaded_002_blocker'
      when min(md5(pg_catalog.pg_get_functiondef(functions.oid))) <> '055b059c2c323c69234ba1ac2f526c95'
        then 'definition_mismatch_002_blocker'
      when not bool_and(functions.prosecdef
        and languages.lanname = 'plpgsql'
        and coalesce(functions.proconfig, array[]::text[])
          = array['search_path=pg_catalog, public']::text[])
        then 'security_property_002_blocker'
      when not bool_and(
        current_user = pg_catalog.pg_get_userbyid(functions.proowner)
        or executor.rolsuper
        or pg_catalog.pg_has_role(current_user, functions.proowner, 'USAGE')
      ) then 'executor_owner_002_blocker'
      else 'exact_002'
    end as status
  from pg_catalog.pg_roles as executor
  left join pg_catalog.pg_namespace as schemas on schemas.nspname = 'public'
  left join pg_catalog.pg_proc as functions
    on functions.pronamespace = schemas.oid
   and functions.proname = 'sync_round_children_from_payload'
   and pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
  left join pg_catalog.pg_language as languages on languages.oid = functions.prolang
  where executor.rolname = current_user
),
prerequisite_trigger as (
  select
    count(triggers.oid)::integer as trigger_count,
    min(triggers.tgenabled::text) as enabled_state,
    min(triggers.tgtype::integer) as trigger_type,
    min(functions.proname) as function_name,
    bool_and(updated_columns.column_names = array['payload']::text[]) as updated_columns_match,
    case
      when count(triggers.oid) <> 1 then 'missing_or_duplicate_002_blocker'
      when not bool_and(
        triggers.tgenabled = 'O'
        and triggers.tgtype = 21
        and functions.proname = 'sync_round_children_from_payload'
        and pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
        and updated_columns.column_names = array['payload']::text[]
      ) then 'definition_mismatch_002_blocker'
      else 'exact_002'
    end as status
  from pg_catalog.pg_namespace as schemas
  left join pg_catalog.pg_class as tables
    on tables.relnamespace = schemas.oid
   and tables.relname = 'rounds'
  left join pg_catalog.pg_trigger as triggers
    on triggers.tgrelid = tables.oid
   and triggers.tgname = 'rounds_sync_children'
   and not triggers.tgisinternal
  left join pg_catalog.pg_proc as functions on functions.oid = triggers.tgfoid
  left join lateral (
    select coalesce(array_agg(attributes.attname order by keys.ordinality), array[]::name[])::text[]
      as column_names
    from unnest(triggers.tgattr::smallint[]) with ordinality as keys(attnum, ordinality)
    join pg_catalog.pg_attribute as attributes
      on attributes.attrelid = triggers.tgrelid
     and attributes.attnum = keys.attnum
  ) as updated_columns on true
  where schemas.nspname = 'public'
),
prerequisite_child_write_checks as (
  select
    tables.table_name,
    privileges.privilege_name,
    pg_catalog.has_table_privilege(
      'authenticated',
      pg_catalog.format('%I.%I', 'public', tables.table_name),
      privileges.privilege_name
    ) as still_granted,
    case when pg_catalog.has_table_privilege(
      'authenticated',
      pg_catalog.format('%I.%I', 'public', tables.table_name),
      privileges.privilege_name
    ) then 'authenticated_write_002_blocker' else 'revoked_002' end as status
  from (values ('round_holes'), ('round_shots')) as tables(table_name)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as privileges(privilege_name)
),
expected_target_functions(
  function_name, identity_arguments, return_type, language_name, volatility,
  security_definer, settings, expected_definition_hash
) as (
  values
    ('calculate_round_stats_from_payload', 'p_payload jsonb', 'jsonb', 'sql', 'i', false,
      array['search_path=pg_catalog, public']::text[], 'f605526003886eb6d5c6961e783ba48a'),
    ('sync_round_summary_from_payload', '', 'trigger', 'plpgsql', 'v', false,
      array['search_path=pg_catalog, public']::text[], 'f3ada2a5cc35ff1b1e55a2c4f8bea295')
),
target_function_checks as (
  select
    expected.function_name,
    expected.identity_arguments,
    count(functions.oid)::integer as identity_count,
    (
      select count(*)::integer
      from pg_catalog.pg_proc as overloads
      join pg_catalog.pg_namespace as overload_schemas on overload_schemas.oid = overloads.pronamespace
      where overload_schemas.nspname = 'public'
        and overloads.proname = expected.function_name
        and pg_catalog.pg_get_function_identity_arguments(overloads.oid) <> expected.identity_arguments
    ) as other_overload_count,
    min(pg_catalog.pg_get_userbyid(functions.proowner)) as owner_name,
    min(pg_catalog.pg_get_function_result(functions.oid)) as actual_return_type,
    min(languages.lanname) as actual_language_name,
    min(functions.provolatile::text) as actual_volatility,
    bool_and(functions.prosecdef) as actual_security_definer,
    min(functions.proconfig) as actual_settings,
    min(md5(pg_catalog.pg_get_functiondef(functions.oid))) as actual_definition_hash,
    expected.expected_definition_hash,
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
          and pg_catalog.pg_get_function_identity_arguments(overloads.oid) <> expected.identity_arguments
      ) > 0 then 'overload_collision_blocker'
      when min(pg_catalog.pg_get_function_result(functions.oid)) <> expected.return_type
        or min(languages.lanname) <> expected.language_name
        or min(functions.provolatile::text) <> expected.volatility
        or bool_and(functions.prosecdef) <> expected.security_definer
        or min(functions.proconfig) is distinct from expected.settings
        or min(md5(pg_catalog.pg_get_functiondef(functions.oid))) <> expected.expected_definition_hash
        then 'definition_mismatch_blocker'
      when not bool_and(
        current_user = pg_catalog.pg_get_userbyid(functions.proowner)
        or executor.rolsuper
        or pg_catalog.pg_has_role(current_user, functions.proowner, 'USAGE')
      ) then 'executor_owner_blocker'
      else 'exact_existing'
    end as status
  from expected_target_functions as expected
  cross join pg_catalog.pg_roles as executor
  left join pg_catalog.pg_namespace as schemas on schemas.nspname = 'public'
  left join pg_catalog.pg_proc as functions
    on functions.pronamespace = schemas.oid
   and functions.proname = expected.function_name
   and pg_catalog.pg_get_function_identity_arguments(functions.oid) = expected.identity_arguments
  left join pg_catalog.pg_language as languages on languages.oid = functions.prolang
  where executor.rolname = current_user
  group by expected.function_name, expected.identity_arguments, expected.return_type,
    expected.language_name, expected.volatility, expected.security_definer,
    expected.settings, expected.expected_definition_hash
),
target_trigger_check as (
  select
    count(triggers.oid)::integer as trigger_count,
    min(triggers.tgenabled::text) as enabled_state,
    min(triggers.tgtype::integer) as trigger_type,
    min(functions.proname) as function_name,
    bool_and(updated_columns.column_names = array['payload']::text[]) as updated_columns_match,
    min(md5(pg_catalog.pg_get_triggerdef(triggers.oid, false))) as definition_hash,
    case
      when count(triggers.oid) = 0 then 'absent_expected'
      when count(triggers.oid) <> 1 then 'trigger_collision_blocker'
      when not bool_and(
        triggers.tgenabled = 'O'
        and triggers.tgtype = 23
        and functions.proname = 'sync_round_summary_from_payload'
        and pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
        and updated_columns.column_names = array['payload']::text[]
      ) then 'definition_mismatch_blocker'
      else 'exact_existing'
    end as status
  from pg_catalog.pg_namespace as schemas
  left join pg_catalog.pg_class as tables
    on tables.relnamespace = schemas.oid
   and tables.relname = 'rounds'
  left join pg_catalog.pg_trigger as triggers
    on triggers.tgrelid = tables.oid
   and triggers.tgname = 'rounds_sync_summary'
   and not triggers.tgisinternal
  left join pg_catalog.pg_proc as functions on functions.oid = triggers.tgfoid
  left join lateral (
    select coalesce(array_agg(attributes.attname order by keys.ordinality), array[]::name[])::text[]
      as column_names
    from unnest(triggers.tgattr::smallint[]) with ordinality as keys(attnum, ordinality)
    join pg_catalog.pg_attribute as attributes
      on attributes.attrelid = triggers.tgrelid
     and attributes.attnum = keys.attnum
  ) as updated_columns on true
  where schemas.nspname = 'public'
),
equivalent_other_triggers as (
  select triggers.tgname as trigger_name
  from pg_catalog.pg_trigger as triggers
  join pg_catalog.pg_class as tables on tables.oid = triggers.tgrelid
  join pg_catalog.pg_namespace as schemas on schemas.oid = tables.relnamespace
  join pg_catalog.pg_proc as functions on functions.oid = triggers.tgfoid
  where schemas.nspname = 'public'
    and tables.relname = 'rounds'
    and not triggers.tgisinternal
    and triggers.tgname <> 'rounds_sync_summary'
    and functions.proname = 'sync_round_summary_from_payload'
    and pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
),
payload_shape_counts as (
  select
    count(*) filter (
      where payload ? 'holes' and jsonb_typeof(payload->'holes') <> 'array'
    )::bigint as invalid_holes_container_count,
    count(*) filter (
      where exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(payload->'holes') = 'array'
            then payload->'holes' else '[]'::jsonb end
        ) as hole(value)
        cross join lateral (values
          ('score'), ('par'), ('officialPutts'), ('putts'), ('penaltyStrokes'),
          ('obCount'), ('penaltyCount')
        ) as fields(field_name)
        where jsonb_typeof(hole.value->fields.field_name) = 'number'
          and (
            hole.value->>fields.field_name !~ '^-?[0-9]+$'
            or (hole.value->>fields.field_name)::numeric not between -32768 and 32767
          )
      )
    )::bigint as unsafe_smallint_cast_round_count
  from public.rounds
),
safe_rounds as (
  select rounds.*
  from public.rounds as rounds
  where not (rounds.payload ? 'holes' and jsonb_typeof(rounds.payload->'holes') <> 'array')
    and not exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(rounds.payload->'holes') = 'array'
          then rounds.payload->'holes' else '[]'::jsonb end
      ) as hole(value)
      cross join lateral (values
        ('score'), ('par'), ('officialPutts'), ('putts'), ('penaltyStrokes'),
        ('obCount'), ('penaltyCount')
      ) as fields(field_name)
      where jsonb_typeof(hole.value->fields.field_name) = 'number'
        and (
          hole.value->>fields.field_name !~ '^-?[0-9]+$'
          or (hole.value->>fields.field_name)::numeric not between -32768 and 32767
        )
    )
),
expected_summaries as (
  select rounds.id, calculated.summary
  from safe_rounds as rounds
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
      from jsonb_array_elements(coalesce(rounds.payload->'holes', '[]'::jsonb))
        with ordinality as hole(value, ordinality)
    ), scored as (
      select * from holes where score is not null
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
),
cache_mismatch_counts as (
  select
    count(*) filter (where row(
      rounds.entered_holes, rounds.par_recorded_holes, rounds.total_score,
      rounds.score_to_par, rounds.total_putts, rounds.putt_attempts,
      rounds.fir_hits, rounds.fir_attempts, rounds.gir_hits, rounds.gir_attempts
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
    count(*) filter (where rounds.stats_summary is distinct from expected.summary)::bigint
      as stats_summary_mismatch_count,
    count(*) filter (where row(
      rounds.entered_holes, rounds.par_recorded_holes, rounds.total_score,
      rounds.score_to_par, rounds.total_putts, rounds.putt_attempts,
      rounds.fir_hits, rounds.fir_attempts, rounds.gir_hits, rounds.gir_attempts,
      rounds.stats_summary
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
      (expected.summary->>'girAttempts')::smallint,
      expected.summary
    ))::bigint as rows_requiring_backfill_count
  from safe_rounds as rounds
  join expected_summaries as expected using (id)
),
gate_counts as (
  select
    (select count(*) from column_checks where status <> 'exact_existing')::integer
      as column_blocker_count,
    (select count(*) from check_constraint_checks where status <> 'exact_existing')::integer
      as summary_check_blocker_count,
    (select count(*) from prerequisite_index_checks where status <> 'exact_002')::integer
      as prerequisite_index_blocker_count,
    (select count(*) from prerequisite_constraint_checks where status <> 'exact_002')::integer
      as prerequisite_constraint_blocker_count,
    (select count(*) from prerequisite_sync_function where status <> 'exact_002')::integer
      as prerequisite_function_blocker_count,
    (select count(*) from prerequisite_trigger where status <> 'exact_002')::integer
      as prerequisite_trigger_blocker_count,
    (select count(*) from prerequisite_child_write_checks where status <> 'revoked_002')::integer
      as prerequisite_privilege_blocker_count,
    (select count(*) from target_function_checks
      where status not in ('absent_expected', 'exact_existing'))::integer
      as target_function_blocker_count,
    (select count(*) from target_trigger_check
      where status not in ('absent_expected', 'exact_existing'))::integer
      as target_trigger_blocker_count,
    (select invalid_holes_container_count + unsafe_smallint_cast_round_count
      from payload_shape_counts)::bigint as payload_blocker_count,
    (select count(*) from equivalent_other_triggers)::integer
      as equivalent_trigger_advisory_count
)
select jsonb_build_object(
  'formatVersion', 1,
  'targetMigration', '202609030002_round_summary_sync.sql',
  'serverVersionNum', current_setting('server_version_num'),
  'gateStatus', case when
    column_blocker_count = 0
    and summary_check_blocker_count = 0
    and prerequisite_index_blocker_count = 0
    and prerequisite_constraint_blocker_count = 0
    and prerequisite_function_blocker_count = 0
    and prerequisite_trigger_blocker_count = 0
    and prerequisite_privilege_blocker_count = 0
    and target_function_blocker_count = 0
    and target_trigger_blocker_count = 0
    and payload_blocker_count = 0
    then 'READY'
    else 'BLOCKED'
  end,
  'blockerCounts', jsonb_build_object(
    'summaryColumns', column_blocker_count,
    'summaryChecks', summary_check_blocker_count,
    '002Indexes', prerequisite_index_blocker_count,
    '002Constraints', prerequisite_constraint_blocker_count,
    '002SyncFunction', prerequisite_function_blocker_count,
    '002SyncTrigger', prerequisite_trigger_blocker_count,
    '002ChildWritePrivileges', prerequisite_privilege_blocker_count,
    'targetFunctions', target_function_blocker_count,
    'targetTrigger', target_trigger_blocker_count,
    'payloadShapeOrCast', payload_blocker_count
  ),
  'advisoryCounts', jsonb_build_object(
    'equivalentTriggersWithOtherNames', equivalent_trigger_advisory_count,
    'rowsRequiringBackfill', (select rows_requiring_backfill_count from cache_mismatch_counts)
  ),
  'summaryColumns', coalesce((select jsonb_agg(to_jsonb(column_checks)
    order by column_name) from column_checks), '[]'::jsonb),
  'summaryCheckConstraints', coalesce((select jsonb_agg(to_jsonb(check_constraint_checks)
    order by constraint_name) from check_constraint_checks), '[]'::jsonb),
  'prerequisite002', jsonb_build_object(
    'indexes', coalesce((select jsonb_agg(to_jsonb(prerequisite_index_checks)
      order by index_name) from prerequisite_index_checks), '[]'::jsonb),
    'constraints', coalesce((select jsonb_agg(to_jsonb(prerequisite_constraint_checks)
      order by constraint_name) from prerequisite_constraint_checks), '[]'::jsonb),
    'syncFunction', (select to_jsonb(prerequisite_sync_function) from prerequisite_sync_function),
    'syncTrigger', (select to_jsonb(prerequisite_trigger) from prerequisite_trigger),
    'childWritePrivileges', coalesce((select jsonb_agg(to_jsonb(prerequisite_child_write_checks)
      order by table_name, privilege_name) from prerequisite_child_write_checks), '[]'::jsonb)
  ),
  'targetFunctions', coalesce((select jsonb_agg(to_jsonb(target_function_checks)
    order by function_name) from target_function_checks), '[]'::jsonb),
  'targetTrigger', (select to_jsonb(target_trigger_check) from target_trigger_check),
  'equivalentOtherTriggers', coalesce((select jsonb_agg(to_jsonb(equivalent_other_triggers)
    order by trigger_name) from equivalent_other_triggers), '[]'::jsonb),
  'payloadValidationCounts', (select to_jsonb(payload_shape_counts) from payload_shape_counts),
  'cacheMismatchCounts', (select to_jsonb(cache_mismatch_counts) from cache_mismatch_counts)
) as migration_003_preflight
from gate_counts;

commit;
