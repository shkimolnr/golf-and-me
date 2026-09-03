-- READ ONLY aggregate state for comparing TASK-051 backfill before and after.
-- Returns counts and one-way fingerprints only; no row identifiers or payloads.

begin transaction read only;

with
source_holes as (
  select rounds.id as round_id,
    coalesce(nullif(hole.value->>'holeNumber', '')::smallint,
      hole.ordinality::smallint) as hole_number,
    case when nullif(hole.value->>'distance', '') is not null
      and pg_catalog.pg_input_is_valid(hole.value->>'distance', 'numeric')
      then (hole.value->>'distance')::numeric end as expected_distance,
    nullif(hole.value->>'distance', '') is null as distance_missing
  from public.rounds as rounds
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(rounds.payload->'holes') = 'array'
      then rounds.payload->'holes' else '[]'::jsonb end
  ) with ordinality as hole(value, ordinality)
),
round_distance_profiles as (
  select round_id, count(*)::integer as hole_count,
    count(expected_distance)::integer as valid_distance_count,
    count(*) filter (where distance_missing)::integer as missing_distance_count
  from source_holes
  group by round_id
),
field_rounds as (
  select round_id from round_distance_profiles
  where hole_count = 18 and valid_distance_count = 16 and missing_distance_count = 2
),
full_distance_rounds as (
  select round_id from round_distance_profiles
  where hole_count = 18 and valid_distance_count = 18 and missing_distance_count = 0
),
field_distance_evidence as (
  select
    (select count(*) from field_rounds)::integer as candidate_round_count,
    count(*)::integer as payload_hole_count,
    count(source.expected_distance)::integer as payload_valid_distance_count,
    count(*) filter (where source.distance_missing)::integer as payload_missing_distance_count,
    count(actual.distance)::integer as child_valid_distance_count,
    count(*) filter (where actual.distance is null)::integer as child_null_distance_count,
    count(*) filter (where actual.distance is distinct from source.expected_distance)::integer
      as distance_mismatch_count
  from source_holes as source
  join field_rounds using (round_id)
  left join public.round_holes as actual
    on actual.round_id = source.round_id and actual.hole_number = source.hole_number
),
full_distance_evidence as (
  select
    (select count(*) from full_distance_rounds)::integer as candidate_round_count,
    count(source.expected_distance)::integer as payload_valid_distance_count,
    count(actual.distance)::integer as child_valid_distance_count,
    count(*) filter (where actual.distance is distinct from source.expected_distance)::integer
      as distance_mismatch_count
  from source_holes as source
  join full_distance_rounds using (round_id)
  left join public.round_holes as actual
    on actual.round_id = source.round_id and actual.hole_number = source.hole_number
),
entity_counts as (
  select
    (select count(*) from public.rounds)::bigint as rounds,
    (select count(*) from public.round_holes)::bigint as round_holes,
    (select count(*) from public.round_shots)::bigint as round_shots,
    (select count(*) from public.round_tombstones)::bigint as round_tombstones
),
data_fingerprints as (
  select
    (select md5(coalesce(string_agg(
      md5(rounds.id || E'\x1f' || rounds.payload::text || E'\x1f' || rounds.updated_at::text),
      '' order by rounds.id), 'empty')) from public.rounds) as rounds_source,
    (select md5(coalesce(string_agg(md5(to_jsonb(holes)::text), ''
      order by holes.round_id, holes.hole_number), 'empty'))
      from public.round_holes as holes) as round_holes,
    (select md5(coalesce(string_agg(md5(to_jsonb(shots)::text), ''
      order by shots.round_id, shots.hole_number, shots.shot_sequence), 'empty'))
      from public.round_shots as shots) as round_shots
),
runtime_004 as (
  select count(*)::integer as risky_privilege_count
  from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
  cross join (values
    ('profiles'), ('rounds'), ('round_holes'), ('round_shots'),
    ('user_clubs'), ('club_distance_history'), ('app_diagnostics')
  ) as tables(table_name)
  cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as privileges(privilege_name)
  where pg_catalog.has_table_privilege(
    roles.role_name,
    pg_catalog.format('public.%I', tables.table_name),
    privileges.privilege_name
  )
),
function_fingerprints as (
  select jsonb_object_agg(functions.proname,
    md5(pg_catalog.pg_get_functiondef(functions.oid)) order by functions.proname) as fingerprints
  from pg_catalog.pg_proc as functions
  join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
  where schemas.nspname = 'public'
    and functions.proname in (
      'sync_round_children_from_payload',
      'record_round_tombstone_before_delete',
      'reject_tombstoned_round_write'
    )
    and pg_catalog.pg_get_function_identity_arguments(functions.oid) = ''
),
trigger_fingerprints as (
  select jsonb_object_agg(triggers.tgname,
    md5(pg_catalog.pg_get_triggerdef(triggers.oid, false)) order by triggers.tgname) as fingerprints
  from pg_catalog.pg_trigger as triggers
  where triggers.tgrelid = 'public.rounds'::regclass
    and triggers.tgname in (
      'rounds_sync_children',
      'rounds_00_record_tombstone_before_delete',
      'rounds_00_reject_tombstoned_write'
    )
    and not triggers.tgisinternal
)
select jsonb_build_object(
  'formatVersion', 1,
  'entityCounts', (select to_jsonb(entity_counts) from entity_counts),
  'dataFingerprints', (select to_jsonb(data_fingerprints) from data_fingerprints),
  'runtime004RiskyPrivilegeCount', (select risky_privilege_count from runtime_004),
  'functionFingerprints', (select fingerprints from function_fingerprints),
  'triggerFingerprints', (select fingerprints from trigger_fingerprints),
  'fieldDistanceEvidence', (select to_jsonb(field_distance_evidence)
    from field_distance_evidence),
  'fullDistanceEvidence', (select to_jsonb(full_distance_evidence)
    from full_distance_evidence)
) as round_child_backfill_state;

commit;
