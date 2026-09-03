import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const postgresImage = process.env.GOLF_AND_ME_POSTGRES_IMAGE || 'postgres:17.6'
const containerName = `golf-me-derived-integrity-${process.pid}`
const migrationDirectory = join(repositoryRoot, 'supabase', 'migrations')
const rollbackPath = join(
  repositoryRoot,
  'supabase',
  'rollbacks',
  '202609010002_derived_data_integrity_rollback.sql',
)
const preflightPath = join(
  repositoryRoot,
  'supabase',
  'verification',
  '202609010002_derived_data_integrity_preflight.sql',
)
const postApplyPath = join(
  repositoryRoot,
  'supabase',
  'verification',
  '202609010002_derived_data_integrity_post_apply.sql',
)
const backfillMigration = '202609030001_round_child_integrity_backfill.sql'
const backfillPreflightPath = join(
  repositoryRoot,
  'supabase',
  'verification',
  '202609030001_round_child_integrity_backfill_preflight.sql',
)
const backfillRollbackPath = join(
  repositoryRoot,
  'supabase',
  'rollbacks',
  '202609030001_round_child_integrity_backfill_rollback.sql',
)
const backfillStatePath = join(
  repositoryRoot,
  'supabase',
  'verification',
  '202609030001_round_child_integrity_backfill_state.sql',
)
const baseMigrations = [
  '202608300001_initial_golf_schema.sql',
  '202608300002_club_bag_sync.sql',
  '202608300003_delete_own_account.sql',
  '202608300004_round_shot_club_snapshot.sql',
  '202608300005_profile_default_distance_unit.sql',
  '202608310001_round_holes_swing_count.sql',
  '202608310002_app_diagnostics.sql',
  '202608310003_round_summary_columns.sql',
  '202609010001_authenticated_table_privileges.sql',
]
const migration002 = '202609010002_derived_data_integrity.sql'
const migration004 = '202609010004_runtime_table_least_privilege.sql'
const migration005 = '202609010005_round_deletion_tombstones.sql'
let containerStarted = false

function docker(argumentsList, options = {}) {
  return execFileSync('docker', argumentsList, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  })
}

function runSql(database, sql) {
  return docker([
    'exec', '-i', containerName,
    'psql', '-U', 'postgres', '-d', database,
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  ], { input: sql })
}

function waitForPostgres() {
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4))
  let consecutiveConnections = 0
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = spawnSync('docker', [
      'exec', containerName,
      'psql', '-U', 'postgres', '-X', '-qAt', '-c', 'select 1',
    ], { cwd: repositoryRoot, stdio: 'ignore' })
    consecutiveConnections = result.status === 0 ? consecutiveConnections + 1 : 0
    if (consecutiveConnections >= 2) return
    Atomics.wait(waitBuffer, 0, 0, 250)
  }
  throw new Error('로컬 PostgreSQL 컨테이너가 30초 안에 준비되지 않았습니다.')
}

const globalRoleSql = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
`

const bootstrapSql = `
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid()
returns uuid
language sql
stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`

function migrationSql(fileName) {
  return readFileSync(join(migrationDirectory, fileName), 'utf8')
}

function simulateSupabaseDefaultRiskyPrivileges(database) {
  runSql(database, `
    grant truncate, references, trigger on all tables in schema public
      to anon, authenticated, service_role;
  `)
}

function createDatabase(database, orderedMigrations) {
  docker(['exec', containerName, 'createdb', '-U', 'postgres', database])
  runSql(database, bootstrapSql)
  for (const migration of [...baseMigrations, ...orderedMigrations]) {
    if (migration === migration004) simulateSupabaseDefaultRiskyPrivileges(database)
    runSql(database, migrationSql(migration))
  }
}

function scalar(database, sql) {
  return runSql(database, sql).trim()
}

function count(database, relationExpression) {
  return Number(scalar(database, `select count(*) from ${relationExpression};`))
}

function integrityBoundaryFingerprint(database) {
  return scalar(database, `
    select md5(concat_ws(E'\\n',
      pg_catalog.pg_get_functiondef(
        'public.sync_round_children_from_payload()'::regprocedure
      ),
      (select string_agg(
        role_name || ':' || table_name || ':' || privilege_name || ':'
          || pg_catalog.has_table_privilege(
            role_name, pg_catalog.format('public.%I', table_name), privilege_name
          )::text,
        '|' order by role_name, table_name, privilege_name
      ) from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
        cross join (values
          ('profiles'), ('rounds'), ('round_holes'), ('round_shots'),
          ('user_clubs'), ('club_distance_history'), ('app_diagnostics'),
          ('round_tombstones')
        ) as tables(table_name)
        cross join (values
          ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
          ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
        ) as privileges(privilege_name)),
      (select string_agg(pg_catalog.pg_get_triggerdef(triggers.oid, false), '|'
        order by triggers.tgname)
       from pg_catalog.pg_trigger as triggers
       where triggers.tgrelid = 'public.rounds'::regclass
         and not triggers.tgisinternal)
    ));
  `)
}

function runPreflight(database) {
  return JSON.parse(runSql(database, readFileSync(preflightPath, 'utf8')).trim())
}

function assertReadyPreflight(result) {
  assert.equal(result.gateStatus, 'READY', JSON.stringify(result, null, 2))
  assert.deepEqual(result.blockerCounts, {
    columns: 0,
    dataViolations: 0,
    functionBaseline: 0,
    namedConstraints: 0,
    namedIndexes: 0,
    riskyRuntimePrivileges: 0,
    roundsSyncTrigger: 0,
  })
  assert.deepEqual(result.advisoryCounts, { equivalentObjectsWithOtherNames: 0 })
}

function backfillPreflightResult(database) {
  return JSON.parse(runSql(database, readFileSync(backfillPreflightPath, 'utf8')).trim())
}

function backfillStateResult(database) {
  return JSON.parse(runSql(database, readFileSync(backfillStatePath, 'utf8')).trim())
}

function assertBackfillReady(database, expectedRounds, expectedHoles, expectedFields = {}) {
  const result = backfillPreflightResult(database)
  assert.equal(result.gateStatus, 'READY', JSON.stringify(result, null, 2))
  assert.deepEqual(result.blockerCounts, {
    integrity: 0,
    invalidPayload: 0,
    prerequisites: 0,
  })
  assert.equal(result.targetCounts.rounds, expectedRounds)
  assert.equal(result.targetCounts.holes, expectedHoles)
  for (const [field, expected] of Object.entries(expectedFields)) {
    assert.equal(result.targetCounts[field], expected)
  }
  return result
}

function postApplyResult(database) {
  return JSON.parse(runSql(database, readFileSync(postApplyPath, 'utf8')).trim())
}

function assertPostApplyPass(database) {
  const result = postApplyResult(database)
  assert.equal(result.gateStatus, 'PASS', JSON.stringify(result, null, 2))
  assert.deepEqual(result.blockerCounts, {
    constraints: 0,
    dataViolations: 0,
    forbiddenChildDml: 0,
    function: 0,
    indexes: 0,
    requiredPrivileges: 0,
    tombstones: 0,
    trigger: 0,
  })
  return result
}

function verifyFieldParityNormalization(database, suffix) {
  const { userA } = insertSyntheticUsers(database, suffix)
  const roundId = `parity-${suffix}`
  runSql(database, `
    insert into public.rounds (
      id, user_id, course_name, front_course_name, back_course_name,
      tee, status, payload, updated_at
    ) values (
      '${roundId}', '${userA}', 'synthetic', 'front', 'back',
      '화이트', 'in_progress',
      jsonb_build_object('id', '${roundId}', 'holes', jsonb_build_array(
        jsonb_build_object(
          'holeNumber', 1, 'sourceOfficialHole', 7, 'distance', 365.5,
          'score', 5, 'swingCount', 3, 'putts', 2,
          'shots', jsonb_build_array(jsonb_build_object(
            'sequence', 1, 'club', 'D', 'clubId', 'numeric',
            'clubSnapshot', jsonb_build_object('label', 'D'), 'remainingDistance', 140.5
          ))
        ),
        jsonb_build_object(
          'holeNumber', 2, 'sourceOfficialHole', '8', 'distance', '400.5',
          'score', '4', 'swingCount', '3', 'putts', '1',
          'shots', jsonb_build_array(jsonb_build_object(
            'sequence', '1', 'club', '7I', 'clubId', 'numeric-string',
            'clubSnapshot', jsonb_build_object('label', '7I'), 'remainingDistance', '90.25'
          ))
        ),
        jsonb_build_object(
          'holeNumber', 3, 'sourceOfficialHole', null, 'distance', null,
          'score', null, 'swingCount', null, 'putts', null,
          'shots', jsonb_build_array(jsonb_build_object(
            'sequence', 1, 'club', null, 'clubId', null,
            'clubSnapshot', null, 'remainingDistance', null
          ))
        ),
        jsonb_build_object(
          'holeNumber', 4, 'sourceOfficialHole', '', 'distance', '',
          'score', '', 'swingCount', '', 'putts', '',
          'shots', jsonb_build_array(jsonb_build_object(
            'sequence', 1, 'club', '', 'clubId', '',
            'clubSnapshot', null, 'remainingDistance', ''
          ))
        )
      )),
      '2026-09-03T00:00:00Z'
    );
  `)

  let result = assertPostApplyPass(database)
  assert.equal(result.dataIntegrityCounts.round_hole_field_mismatch, 0)
  assert.equal(result.dataIntegrityCounts.round_shot_field_mismatch, 0)

  runSql(database, `
    update public.round_holes
    set payload = jsonb_set(payload, '{distance}', to_jsonb('401'::text))
    where round_id = '${roundId}' and hole_number = 2;
  `)
  result = postApplyResult(database)
  assert.equal(result.gateStatus, 'BLOCKED')
  assert.equal(result.dataIntegrityCounts.round_hole_field_mismatch, 1)

  runSql(database, `
    update public.round_holes
    set payload = jsonb_set(payload, '{distance}', to_jsonb('not-a-number'::text))
    where round_id = '${roundId}' and hole_number = 2;
  `)
  result = postApplyResult(database)
  assert.equal(result.gateStatus, 'BLOCKED')
  assert.equal(result.dataIntegrityCounts.round_hole_field_mismatch, 1)

  runSql(database, `
    update public.round_holes
    set payload = jsonb_set(payload, '{distance}', to_jsonb('400.5'::text))
    where round_id = '${roundId}' and hole_number = 2;
    update public.round_shots
    set payload = jsonb_set(payload, '{remainingDistance}', to_jsonb('91'::text))
    where round_id = '${roundId}' and hole_number = 2 and shot_sequence = 1;
  `)
  result = postApplyResult(database)
  assert.equal(result.gateStatus, 'BLOCKED')
  assert.equal(result.dataIntegrityCounts.round_hole_field_mismatch, 0)
  assert.equal(result.dataIntegrityCounts.round_shot_field_mismatch, 1)

  runSql(database, `
    update public.round_shots
    set payload = jsonb_set(payload, '{remainingDistance}', to_jsonb('not-a-number'::text))
    where round_id = '${roundId}' and hole_number = 2 and shot_sequence = 1;
  `)
  result = postApplyResult(database)
  assert.equal(result.gateStatus, 'BLOCKED')
  assert.equal(result.dataIntegrityCounts.round_shot_field_mismatch, 1)

  runSql(database, `
    update public.round_shots
    set payload = jsonb_set(payload, '{remainingDistance}', to_jsonb('90.25'::text))
    where round_id = '${roundId}' and hole_number = 2 and shot_sequence = 1;
  `)
  assertPostApplyPass(database)
}

function assertSqlFails(database, sql, expectedPattern) {
  assert.throws(
    () => runSql(database, sql),
    error => expectedPattern.test(error?.stderr?.toString() || error?.message || ''),
  )
}

function assertIntegrityObjects(database) {
  assert.equal(count(database, `pg_catalog.pg_constraint
    where conname in (
      'round_holes_round_user_fkey',
      'round_shots_round_hole_user_fkey',
      'club_distance_history_club_user_fkey'
    ) and convalidated`), 3)
  assert.equal(count(database, `pg_catalog.pg_indexes
    where schemaname = 'public' and indexname in (
      'rounds_id_user_uidx',
      'round_holes_round_hole_user_uidx',
      'user_clubs_id_user_uidx'
    )`), 3)
  assert.equal(scalar(database, `
    select prosecdef::text || ':' || array_to_string(proconfig, ',')
    from pg_catalog.pg_proc
    where oid = 'public.sync_round_children_from_payload()'::regprocedure;
  `), 'true:search_path=pg_catalog, public')
  for (const table of ['round_holes', 'round_shots']) {
    assert.equal(scalar(database, `
      select concat_ws(',',
        has_table_privilege('authenticated', 'public.${table}', 'SELECT'),
        has_table_privilege('authenticated', 'public.${table}', 'INSERT'),
        has_table_privilege('authenticated', 'public.${table}', 'UPDATE'),
        has_table_privilege('authenticated', 'public.${table}', 'DELETE'));
    `), 't,f,f,f')
  }
}

function insertSyntheticUsers(database, suffix) {
  const userA = `00000000-0000-0000-0000-${suffix.padStart(12, '0')}`
  const userB = `10000000-0000-0000-0000-${suffix.padStart(12, '0')}`
  runSql(database, `insert into auth.users (id) values ('${userA}'), ('${userB}');`)
  return { userA, userB }
}

function verifyDerivedBehavior(database, suffix) {
  const { userA, userB } = insertSyntheticUsers(database, suffix)
  const roundId = `integrity-${suffix}`
  const clubId = `20000000-0000-0000-0000-${suffix.padStart(12, '0')}`
  runSql(database, `
    insert into public.user_clubs (id, user_id, client_id, name)
    values ('${clubId}', '${userA}', 'synthetic-club-${suffix}', 'synthetic-club');
    insert into public.rounds (
      id, user_id, course_name, front_course_name, back_course_name,
      tee, status, payload, updated_at
    ) values (
      '${roundId}', '${userA}', 'synthetic', 'front', 'back',
      '화이트', 'in_progress',
      jsonb_build_object(
        'id', '${roundId}',
        'holes', jsonb_build_array(jsonb_build_object(
          'holeNumber', 1,
          'sourceOfficialHole', 7,
          'par', 4,
          'distance', 365,
          'score', 5,
          'swingCount', 3,
          'putts', 2,
          'shots', jsonb_build_array(jsonb_build_object(
            'sequence', 1,
            'club', 'D',
            'clubId', '${clubId}',
            'clubSnapshot', jsonb_build_object('id', '${clubId}', 'label', 'D'),
            'remainingDistance', 140
          ))
        ))
      ),
      '2026-09-03T00:00:00Z'
    );
  `)

  assert.equal(scalar(database, `
    select concat_ws(',', official_hole_number, distance, swing_count, score, putts)
    from public.round_holes where round_id = '${roundId}' and hole_number = 1;
  `), '7,365,3,5,2')
  assert.equal(scalar(database, `
    select concat_ws(',', club_client_id, club_snapshot->>'label', remaining_distance)
    from public.round_shots where round_id = '${roundId}' and hole_number = 1;
  `), `${clubId},D,140`)

  assertSqlFails(database, `
    insert into public.round_holes (
      round_id, user_id, hole_number, payload
    ) values ('${roundId}', '${userB}', 2, '{}'::jsonb);
  `, /round_holes_round_user_fkey/)
  assertSqlFails(database, `
    insert into public.round_shots (
      round_id, hole_number, user_id, shot_sequence, payload
    ) values ('${roundId}', 1, '${userB}', 2, '{}'::jsonb);
  `, /round_shots_round_hole_user_fkey/)
  assertSqlFails(database, `
    insert into public.club_distance_history (user_id, club_id, set_id, distance)
    values ('${userB}', '${clubId}', 'synthetic-set-${suffix}', 100);
  `, /club_distance_history_club_user_fkey/)

  for (const operation of [
    `insert into public.round_holes (round_id, user_id, hole_number, payload)
      values ('${roundId}', '${userA}', 2, '{}'::jsonb)`,
    `update public.round_holes set score = 4 where round_id = '${roundId}'`,
    `delete from public.round_shots where round_id = '${roundId}'`,
  ]) {
    assertSqlFails(database, `
      begin;
      set local role authenticated;
      select set_config('request.jwt.claim.sub', '${userA}', true);
      ${operation};
    `, /permission denied/)
  }

  runSql(database, `delete from public.rounds where id = '${roundId}';`)
  assert.equal(count(database, `public.round_holes where round_id = '${roundId}'`), 0)
  assert.equal(count(database, `public.round_shots where round_id = '${roundId}'`), 0)
  assert.equal(count(database, `public.round_tombstones where round_id = '${roundId}'`), 1)
}

function verifyRollbackAndReapply(database) {
  runSql(database, readFileSync(rollbackPath, 'utf8'))
  assert.equal(count(database, `pg_catalog.pg_constraint where conname in (
    'round_holes_round_user_fkey',
    'round_shots_round_hole_user_fkey',
    'club_distance_history_club_user_fkey'
  )`), 0)
  assert.equal(count(database, `pg_catalog.pg_indexes where schemaname = 'public' and indexname in (
    'rounds_id_user_uidx',
    'round_holes_round_hole_user_uidx',
    'user_clubs_id_user_uidx'
  )`), 0)
  assert.equal(scalar(database, `
    select array_to_string(proconfig, ',')
    from pg_catalog.pg_proc
    where oid = 'public.sync_round_children_from_payload()'::regprocedure;
  `), 'search_path=public')
  assert.equal(scalar(database, `
    select has_table_privilege('authenticated', 'public.round_holes', 'INSERT');
  `), 't')
  runSql(database, migrationSql(migration002))
  assertIntegrityObjects(database)
}

function buildEighteenHolePayload(roundId, distanceOffset = 0) {
  return {
    id: roundId,
    holes: Array.from({ length: 18 }, (_, index) => ({
      holeNumber: String(index + 1),
      sourceOfficialHole: index + 1,
      par: String(index % 4 === 0 ? 5 : 4),
      distance: String(300 + distanceOffset + index),
      score: '5',
      swingCount: '3',
      putts: '2',
      shots: [{
        sequence: '1',
        club: 'D',
        clubId: `club-${index + 1}`,
        clubSnapshot: { label: 'D' },
        remainingDistance: String(120 + index),
      }],
    })),
  }
}

function insertSyntheticRound(database, roundId, userId, payload, updatedAt) {
  runSql(database, `
    insert into public.rounds (
      id, user_id, course_name, front_course_name, back_course_name,
      tee, status, payload, updated_at
    ) values (
      '${roundId}', '${userId}', 'synthetic', 'front', 'back',
      '화이트', 'in_progress', $payload$${JSON.stringify(payload)}$payload$::jsonb,
      '${updatedAt}'::timestamptz
    );
  `)
}

function verifyBackfill(database) {
  const userId = '30000000-0000-0000-0000-000000000051'
  runSql(database, `insert into auth.users (id) values ('${userId}');`)
  for (let index = 0; index < 3; index += 1) {
    const roundId = `stale-${index + 1}`
    insertSyntheticRound(
      database,
      roundId,
      userId,
      buildEighteenHolePayload(roundId, index * 10),
      `2026-09-03T01:0${index}:00Z`,
    )
  }

  assert.equal(count(database, `public.round_holes
    where round_id like 'stale-%' and (official_hole_number is null or distance is null)`), 54)
  runSql(database, migrationSql(migration002))

  const currentRoundId = 'current-control'
  insertSyntheticRound(
    database,
    currentRoundId,
    userId,
    buildEighteenHolePayload(currentRoundId, 50),
    '2026-09-03T02:00:00Z',
  )
  assertBackfillReady(database, 3, 54, {
    distanceHoles: 54,
    distanceRounds: 3,
    officialHoleNumberHoles: 54,
    officialHoleNumberRounds: 3,
  })

  const sourceStateBefore = scalar(database, `
    select md5(string_agg(id || ':' || payload::text || ':' || updated_at::text, '|' order by id))
    from public.rounds;
  `)
  const controlXminBefore = scalar(database, `
    select xmin::text from public.round_holes
    where round_id = '${currentRoundId}' and hole_number = 1;
  `)
  const boundaryBefore = integrityBoundaryFingerprint(database)

  runSql(database, migrationSql(backfillMigration))
  assertBackfillReady(database, 0, 0)
  assert.equal(count(database, `public.round_holes where round_id like 'stale-%'`), 54)
  assert.equal(count(database, `public.round_shots where round_id like 'stale-%'`), 54)
  assert.equal(scalar(database, `
    select md5(string_agg(id || ':' || payload::text || ':' || updated_at::text, '|' order by id))
    from public.rounds;
  `), sourceStateBefore)
  assert.equal(scalar(database, `
    select xmin::text from public.round_holes
    where round_id = '${currentRoundId}' and hole_number = 1;
  `), controlXminBefore)
  assert.equal(integrityBoundaryFingerprint(database), boundaryBefore)

  const childStateAfterFirstRun = scalar(database, `
    select md5(string_agg(round_id || ':' || hole_number::text || ':' || payload::text,
      '|' order by round_id, hole_number)) from public.round_holes;
  `)
  runSql(database, migrationSql(backfillMigration))
  assertBackfillReady(database, 0, 0)
  assert.equal(scalar(database, `
    select md5(string_agg(round_id || ':' || hole_number::text || ':' || payload::text,
      '|' order by round_id, hole_number)) from public.round_holes;
  `), childStateAfterFirstRun)

  runSql(database, readFileSync(backfillRollbackPath, 'utf8'))
  assertBackfillReady(database, 0, 0)
  assert.equal(integrityBoundaryFingerprint(database), boundaryBefore)
}

function verifyPostconditionAtomicRollback(database) {
  const userId = '31000000-0000-0000-0000-000000000051'
  const roundId = 'postcondition-rollback'
  runSql(database, `insert into auth.users (id) values ('${userId}');`)
  insertSyntheticRound(
    database,
    roundId,
    userId,
    buildEighteenHolePayload(roundId, 70),
    '2026-09-03T02:30:00Z',
  )
  runSql(database, migrationSql(migration002))
  assertBackfillReady(database, 1, 18)

  runSql(database, `
    create function public.corrupt_backfill_hole_insert()
    returns trigger language plpgsql
    as $$ begin new.score := coalesce(new.score, 0) + 1; return new; end; $$;
    create trigger test_corrupt_backfill_hole_insert
      before insert on public.round_holes
      for each row execute function public.corrupt_backfill_hole_insert();
  `)
  const sourceStateBefore = scalar(database, `
    select md5(coalesce(jsonb_agg(to_jsonb(rounds) order by id)::text, 'null'))
    from public.rounds as rounds;
  `)
  const holeStateBefore = scalar(database, `
    select md5(coalesce(jsonb_agg(to_jsonb(holes) order by round_id, hole_number)::text, 'null'))
    from public.round_holes as holes;
  `)
  const shotStateBefore = scalar(database, `
    select md5(coalesce(jsonb_agg(to_jsonb(shots)
      order by round_id, hole_number, shot_sequence)::text, 'null'))
    from public.round_shots as shots;
  `)

  assertSqlFails(
    database,
    migrationSql(backfillMigration),
    /round_child_backfill_postcondition_failed/,
  )
  assert.equal(scalar(database, `
    select md5(coalesce(jsonb_agg(to_jsonb(rounds) order by id)::text, 'null'))
    from public.rounds as rounds;
  `), sourceStateBefore)
  assert.equal(scalar(database, `
    select md5(coalesce(jsonb_agg(to_jsonb(holes) order by round_id, hole_number)::text, 'null'))
    from public.round_holes as holes;
  `), holeStateBefore)
  assert.equal(scalar(database, `
    select md5(coalesce(jsonb_agg(to_jsonb(shots)
      order by round_id, hole_number, shot_sequence)::text, 'null'))
    from public.round_shots as shots;
  `), shotStateBefore)
  assertBackfillReady(database, 1, 18)

  runSql(database, `
    drop trigger test_corrupt_backfill_hole_insert on public.round_holes;
    drop function public.corrupt_backfill_hole_insert();
  `)
  runSql(database, migrationSql(backfillMigration))
  assertBackfillReady(database, 0, 0)
}

function verifyInvalidBackfillBlocker(database) {
  const userId = '40000000-0000-0000-0000-000000000051'
  const roundId = 'invalid-source'
  runSql(database, `
    insert into auth.users (id) values ('${userId}');
    alter table public.rounds disable trigger rounds_sync_children;
  `)
  insertSyntheticRound(database, roundId, userId, {
    id: roundId,
    holes: [{
      holeNumber: 1,
      sourceOfficialHole: 1,
      distance: 'not-a-number',
      shots: [],
    }],
  }, '2026-09-03T03:00:00Z')
  runSql(database, 'alter table public.rounds enable trigger rounds_sync_children;')

  const beforeCounts = scalar(database, `
    select (select count(*) from public.rounds)::text || ','
      || (select count(*) from public.round_holes)::text || ','
      || (select count(*) from public.round_shots)::text;
  `)
  const preflight = backfillPreflightResult(database)
  assert.equal(preflight.gateStatus, 'BLOCKED')
  assert.equal(preflight.blockerCounts.invalidPayload, 1)
  assertSqlFails(
    database,
    migrationSql(backfillMigration),
    /round_child_backfill_invalid_payload/,
  )
  assert.equal(scalar(database, `
    select (select count(*) from public.rounds)::text || ','
      || (select count(*) from public.round_holes)::text || ','
      || (select count(*) from public.round_shots)::text;
  `), beforeCounts)
}

function verifyAmbiguousBackfillBlocker(database) {
  const userId = '41000000-0000-0000-0000-000000000051'
  const roundId = 'ambiguous-source'
  runSql(database, `
    insert into auth.users (id) values ('${userId}');
    alter table public.rounds disable trigger rounds_sync_children;
  `)
  insertSyntheticRound(database, roundId, userId, {
    id: roundId,
    holes: [
      { holeNumber: 1, sourceOfficialHole: 1, distance: '300', shots: [] },
      { holeNumber: 1, sourceOfficialHole: 2, distance: '310', shots: [] },
    ],
  }, '2026-09-03T03:01:00Z')
  runSql(database, 'alter table public.rounds enable trigger rounds_sync_children;')

  const preflight = backfillPreflightResult(database)
  assert.equal(preflight.gateStatus, 'BLOCKED')
  assert.equal(preflight.invalidPayloadCounts.duplicate_hole_key, 1)
  assertSqlFails(
    database,
    migrationSql(backfillMigration),
    /round_child_backfill_ambiguous_payload/,
  )
  assert.equal(count(database, `public.round_holes where round_id = '${roundId}'`), 0)
  assert.equal(count(database, `public.round_shots where round_id = '${roundId}'`), 0)
}

function verifyStructuralBackfillBlocker(database) {
  const userId = '42000000-0000-0000-0000-000000000051'
  const roundId = 'structural-source'
  runSql(database, `
    insert into auth.users (id) values ('${userId}');
    alter table public.rounds disable trigger rounds_sync_children;
  `)
  insertSyntheticRound(database, roundId, userId, {
    id: roundId,
    holes: [{ holeNumber: 1, sourceOfficialHole: 1, distance: '300', shots: [] }],
  }, '2026-09-03T03:02:00Z')
  runSql(database, `
    alter table public.rounds enable trigger rounds_sync_children;
    insert into public.round_holes (
      round_id, user_id, hole_number, official_hole_number, distance, payload, updated_at
    ) values (
      '${roundId}', '${userId}', 2, 1, 300,
      '{"holeNumber":2,"sourceOfficialHole":1,"distance":"300","shots":[]}'::jsonb,
      '2026-09-03T03:02:00Z'
    );
  `)

  const preflight = backfillPreflightResult(database)
  assert.equal(preflight.gateStatus, 'BLOCKED')
  assert.equal(preflight.integrityCounts.round_hole_key_mismatch, 2)
  assertSqlFails(
    database,
    migrationSql(backfillMigration),
    /round_child_backfill_integrity_blocker/,
  )
  assert.equal(count(database, `public.round_holes where round_id = '${roundId}'`), 1)
}

function assertBackfillPrerequisiteBlocked(database, assertion) {
  const preflight = backfillPreflightResult(database)
  assert.equal(preflight.gateStatus, 'BLOCKED')
  assert.equal(preflight.blockerCounts.prerequisites, 1)
  assertion(preflight)
  assertSqlFails(
    database,
    migrationSql(backfillMigration),
    /round_child_backfill_prerequisite_blocker/,
  )
}

function verifyExactPrerequisiteBlockers(database) {
  runSql(database, `
    alter table public.round_holes drop constraint round_holes_round_user_fkey;
    alter table public.round_holes add constraint round_holes_round_user_fkey
      foreign key (round_id, user_id) references public.rounds (id, user_id)
      on delete restrict;
  `)
  assertBackfillPrerequisiteBlocked(database, result => {
    const check = result.catalogChecks.constraints.find(
      item => item.name === 'round_holes_round_user_fkey',
    )
    assert.equal(check.named_count, 1)
    assert.equal(check.exact_count, 0)
  })
  runSql(database, 'alter table public.round_holes drop constraint round_holes_round_user_fkey;')
  runSql(database, migrationSql(migration002))

  runSql(database, `
    alter table public.club_distance_history
      drop constraint club_distance_history_club_user_fkey;
    drop index public.user_clubs_id_user_uidx;
    create index user_clubs_id_user_uidx on public.user_clubs (user_id, id);
    create unique index backfill_test_user_clubs_id_user_uidx
      on public.user_clubs (id, user_id);
    alter table public.club_distance_history
      add constraint club_distance_history_club_user_fkey
      foreign key (club_id, user_id) references public.user_clubs (id, user_id)
      on delete cascade;
  `)
  assertBackfillPrerequisiteBlocked(database, result => {
    const check = result.catalogChecks.indexes.find(
      item => item.name === 'user_clubs_id_user_uidx',
    )
    assert.equal(check.named_count, 1)
    assert.equal(check.exact_count, 0)
  })
  runSql(database, `
    alter table public.club_distance_history
      drop constraint club_distance_history_club_user_fkey;
    drop index public.user_clubs_id_user_uidx;
    drop index public.backfill_test_user_clubs_id_user_uidx;
  `)
  runSql(database, migrationSql(migration002))

  runSql(database, `
    create or replace function public.sync_round_children_from_payload()
    returns trigger language plpgsql security definer
    set search_path = pg_catalog, public
    as $$ begin return new; end; $$;
  `)
  assertBackfillPrerequisiteBlocked(database, result => {
    assert.equal(result.catalogChecks.syncFunction.named_count, 1)
    assert.equal(result.catalogChecks.syncFunction.exact_count, 0)
  })
  runSql(database, migrationSql(migration002))

  runSql(database, `
    drop trigger rounds_00_record_tombstone_before_delete on public.rounds;
    create trigger rounds_00_record_tombstone_before_delete
      after delete on public.rounds
      for each row execute function public.record_round_tombstone_before_delete();
  `)
  assertBackfillPrerequisiteBlocked(database, result => {
    const check = result.catalogChecks.tombstoneTriggers.find(
      item => item.name === 'rounds_00_record_tombstone_before_delete',
    )
    assert.equal(check.named_count, 1)
    assert.equal(check.exact_count, 0)
  })
  runSql(database, `
    drop trigger rounds_00_record_tombstone_before_delete on public.rounds;
    create trigger rounds_00_record_tombstone_before_delete
      before delete on public.rounds
      for each row execute function public.record_round_tombstone_before_delete();
  `)
  assertBackfillReady(database, 0, 0)
}

function verifySummaryPrecedenceBlocker(database) {
  runSql(database, `
    create function public.sync_round_summary_from_payload()
    returns trigger language plpgsql security invoker
    set search_path = pg_catalog, public
    as $$ begin return new; end; $$;
    create trigger rounds_sync_summary
      before insert or update of payload on public.rounds
      for each row execute function public.sync_round_summary_from_payload();
  `)
  assertBackfillPrerequisiteBlocked(database, result => {
    assert.equal(result.catalogChecks.summaryPrecedence.known_function_count, 1)
    assert.equal(result.catalogChecks.summaryPrecedence.known_trigger_count, 1)
  })
  runSql(database, `
    drop trigger rounds_sync_summary on public.rounds;
    drop function public.sync_round_summary_from_payload();
  `)
  assertBackfillReady(database, 0, 0)
}

function buildDistanceEvidencePayload(roundId, distanceCount) {
  return {
    id: roundId,
    holes: Array.from({ length: 18 }, (_, index) => ({
      holeNumber: String(index + 1),
      sourceOfficialHole: null,
      par: '4',
      distance: index < distanceCount ? String(321.5 + index) : '',
      score: '5',
      swingCount: '3',
      putts: '2',
      shots: [],
    })),
  }
}

function verifyDistanceEvidenceBackfill(database) {
  const userId = '50000000-0000-0000-0000-000000000051'
  runSql(database, `insert into auth.users (id) values ('${userId}');`)
  insertSyntheticRound(
    database,
    'field-round',
    userId,
    buildDistanceEvidencePayload('field-round', 16),
    '2026-09-03T04:00:00Z',
  )
  insertSyntheticRound(
    database,
    'aggregate-round-1',
    userId,
    buildDistanceEvidencePayload('aggregate-round-1', 18),
    '2026-09-03T04:01:00Z',
  )
  insertSyntheticRound(
    database,
    'aggregate-round-2',
    userId,
    buildDistanceEvidencePayload('aggregate-round-2', 18),
    '2026-09-03T04:02:00Z',
  )
  assert.equal(count(database, `public.round_holes where round_id in (
    'field-round', 'aggregate-round-1', 'aggregate-round-2'
  ) and distance is not null`), 0)

  runSql(database, migrationSql(migration002))
  assertBackfillReady(database, 3, 52, {
    distanceHoles: 52,
    distanceRounds: 3,
    officialHoleNumberHoles: 0,
    officialHoleNumberRounds: 0,
  })
  const sourceStateBefore = scalar(database, `
    select md5(string_agg(id || ':' || payload::text || ':' || updated_at::text,
      '|' order by id))
    from public.rounds;
  `)
  runSql(database, migrationSql(backfillMigration))
  assertBackfillReady(database, 0, 0)

  assert.equal(count(database, `public.round_holes
    where round_id = 'field-round' and distance is not null`), 16)
  assert.equal(count(database, `public.round_holes
    where round_id = 'field-round' and distance is null`), 2)
  assert.equal(count(database, `public.round_holes
    where round_id in ('aggregate-round-1', 'aggregate-round-2')
      and distance is not null`), 36)
  assert.equal(count(database, `public.round_holes
    where round_id in ('field-round', 'aggregate-round-1', 'aggregate-round-2')
      and distance is distinct from nullif(payload->>'distance', '')::numeric`), 0)
  assert.equal(scalar(database, `
    select md5(string_agg(id || ':' || payload::text || ':' || updated_at::text,
      '|' order by id))
    from public.rounds;
  `), sourceStateBefore)

  const analyticsDistanceCount = Number(scalar(database, `
    select count(distance) from public.round_holes
    where round_id in ('field-round', 'aggregate-round-1', 'aggregate-round-2');
  `))
  assert.equal(analyticsDistanceCount, 52)
}

try {
  docker(['image', 'inspect', postgresImage])
  docker([
    'run', '--rm', '-d', '--pull=never', '--name', containerName,
    '-e', 'POSTGRES_PASSWORD=local-derived-integrity-check', postgresImage,
  ])
  containerStarted = true
  waitForPostgres()
  runSql('postgres', globalRoleSql)

  createDatabase('fresh_order', [migration002, migration004, migration005])
  assertIntegrityObjects('fresh_order')
  verifyDerivedBehavior('fresh_order', '51')
  assertPostApplyPass('fresh_order')
  verifyRollbackAndReapply('fresh_order')

  createDatabase('production_order', [migration004, migration005])
  assertReadyPreflight(runPreflight('production_order'))
  runSql('production_order', migrationSql(migration002))
  assertIntegrityObjects('production_order')

  createDatabase('backfill_existing', [migration004, migration005])
  verifyBackfill('backfill_existing')

  createDatabase('backfill_postcondition', [migration004, migration005])
  verifyPostconditionAtomicRollback('backfill_postcondition')

  createDatabase('backfill_invalid', [migration002, migration004, migration005])
  verifyInvalidBackfillBlocker('backfill_invalid')

  createDatabase('backfill_ambiguous', [migration002, migration004, migration005])
  verifyAmbiguousBackfillBlocker('backfill_ambiguous')

  createDatabase('backfill_structural', [migration002, migration004, migration005])
  verifyStructuralBackfillBlocker('backfill_structural')

  createDatabase('backfill_prerequisites', [migration002, migration004, migration005])
  verifyExactPrerequisiteBlockers('backfill_prerequisites')
  verifySummaryPrecedenceBlocker('backfill_prerequisites')

  createDatabase('distance_evidence', [migration004, migration005])
  verifyDistanceEvidenceBackfill('distance_evidence')
  const distanceState = backfillStateResult('distance_evidence')
  assert.deepEqual(distanceState.fieldDistanceEvidence, {
    candidate_round_count: 1,
    child_null_distance_count: 2,
    child_valid_distance_count: 16,
    distance_mismatch_count: 0,
    payload_hole_count: 18,
    payload_missing_distance_count: 2,
    payload_valid_distance_count: 16,
  })
  assert.deepEqual(distanceState.fullDistanceEvidence, {
    candidate_round_count: 2,
    child_valid_distance_count: 36,
    distance_mismatch_count: 0,
    payload_valid_distance_count: 36,
  })
  assert.equal(distanceState.runtime004RiskyPrivilegeCount, 0)
  assert.deepEqual(distanceState.functionFingerprints, {
    record_round_tombstone_before_delete: 'eb89388ca6e924490945b3b3cfea423f',
    reject_tombstoned_round_write: '0c86baea5e633a1d5d5982bb212cbb20',
    sync_round_children_from_payload: '055b059c2c323c69234ba1ac2f526c95',
  })
  assert.deepEqual(distanceState.triggerFingerprints, {
    rounds_00_record_tombstone_before_delete: '8f146f8e85b30643fd57dfb0ad23fbf1',
    rounds_00_reject_tombstoned_write: '1b8785b648e166ce876e4a978adf3a19',
    rounds_sync_children: 'cd483d16a0b456f74a4c58ded518b5ad',
  })

  runSql('fresh_order', migrationSql(backfillMigration))
  assertBackfillReady('fresh_order', 0, 0)
  verifyDerivedBehavior('production_order', '52')
  verifyFieldParityNormalization('production_order', '53')
  assertPostApplyPass('production_order')
  runSql('production_order', migrationSql(migration002))
  assertIntegrityObjects('production_order')

  process.stdout.write('✓ fresh replay order 001→002→004→005 preserves integrity and tombstones\n')
  process.stdout.write('✓ current Production order 001→004→005→002 is compatible\n')
  process.stdout.write('✓ Production-equivalent READ ONLY preflight is READY (blockers=0, advisory=0)\n')
  process.stdout.write('✓ owner-mismatch FK writes and authenticated child DML are blocked\n')
  process.stdout.write('✓ payload trigger restores official hole, distance, swing, and shot snapshots\n')
  process.stdout.write('✓ field parity normalizes number/string/null/empty and flags real/invalid mismatches\n')
  process.stdout.write('✓ rollback limitations and 002 reapply behavior are verified\n')
  process.stdout.write('✓ 54 stale holes are selectively backfilled without changing round sources\n')
  process.stdout.write('✓ backfill second run changes 0 targets and rollback does not re-corrupt cache\n')
  process.stdout.write('✓ full child postcondition corruption rolls the transaction back atomically\n')
  process.stdout.write('✓ invalid source payload blocks atomically before child changes\n')
  process.stdout.write('✓ duplicate hole keys block as ambiguous before child changes\n')
  process.stdout.write('✓ payload/child key mismatch blocks before child changes\n')
  process.stdout.write('✓ 002 function, 004 ACL, and 005 trigger definitions remain byte-stable\n')
  process.stdout.write('✓ wrong same-name FK/index/function and tombstone trigger are blocked\n')
  process.stdout.write('✓ TASK-052 summary trigger/function precedence is fail-closed\n')
  process.stdout.write('✓ 16/18 field distances and 36 aggregate distances recover without filling nulls\n')
  process.stdout.write('✓ derived-table distance analytics no longer omit valid payload distances\n')
  process.stdout.write('✓ aggregate state query verifies source/child fingerprints and field evidence\n')
} catch (error) {
  const detail = error?.stderr?.toString().trim() || error?.message || String(error)
  process.stderr.write(`migration 002 격리 통합검증 실패: ${detail}\n`)
  process.exitCode = 1
} finally {
  if (containerStarted) {
    spawnSync('docker', ['stop', containerName], { cwd: repositoryRoot, stdio: 'ignore' })
  }
}
