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
  verifyRollbackAndReapply('fresh_order')

  createDatabase('production_order', [migration004, migration005])
  assertReadyPreflight(runPreflight('production_order'))
  runSql('production_order', migrationSql(migration002))
  assertIntegrityObjects('production_order')
  verifyDerivedBehavior('production_order', '52')
  runSql('production_order', migrationSql(migration002))
  assertIntegrityObjects('production_order')

  process.stdout.write('✓ fresh replay order 001→002→004→005 preserves integrity and tombstones\n')
  process.stdout.write('✓ current Production order 001→004→005→002 is compatible\n')
  process.stdout.write('✓ Production-equivalent READ ONLY preflight is READY (blockers=0, advisory=0)\n')
  process.stdout.write('✓ owner-mismatch FK writes and authenticated child DML are blocked\n')
  process.stdout.write('✓ payload trigger restores official hole, distance, swing, and shot snapshots\n')
  process.stdout.write('✓ rollback limitations and 002 reapply behavior are verified\n')
} catch (error) {
  const detail = error?.stderr?.toString().trim() || error?.message || String(error)
  process.stderr.write(`migration 002 격리 통합검증 실패: ${detail}\n`)
  process.exitCode = 1
} finally {
  if (containerStarted) {
    spawnSync('docker', ['stop', containerName], { cwd: repositoryRoot, stdio: 'ignore' })
  }
}
