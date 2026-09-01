import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const postgresImage = process.env.GOLF_AND_ME_POSTGRES_IMAGE || 'postgres:17.6'
const containerName = `golf-me-summary-preflight-${process.pid}`
const baselineMigrations = [
  '202608300001_initial_golf_schema.sql',
  '202608300002_club_bag_sync.sql',
  '202608300003_delete_own_account.sql',
  '202608300004_round_shot_club_snapshot.sql',
  '202608300005_profile_default_distance_unit.sql',
  '202608310001_round_holes_swing_count.sql',
  '202608310002_app_diagnostics.sql',
  '202608310003_round_summary_columns.sql',
  '202609010001_authenticated_table_privileges.sql',
  '202609010004_runtime_table_least_privilege.sql',
]
const migration002 = '202609010002_derived_data_integrity.sql'
const migration003 = '202609010003_round_summary_sync.sql'
const expectedHashes = {
  syncChildren002: '055b059c2c323c69234ba1ac2f526c95',
  calculateSummary003: 'f605526003886eb6d5c6961e783ba48a',
  syncSummary003: 'f3ada2a5cc35ff1b1e55a2c4f8bea295',
}
const preflightPath = join(
  repositoryRoot,
  'supabase',
  'verification',
  '202609010003_round_summary_sync_preflight.sql',
)
let containerStarted = false

function docker(argumentsList, options = {}) {
  return execFileSync('docker', argumentsList, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  })
}

function runSql(sql) {
  return docker([
    'exec', '-i', containerName,
    'psql', '-U', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
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

const bootstrapSql = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid()
returns uuid
language sql
stable
as $$ select null::uuid $$;
`

function migrationSql(fileName) {
  return readFileSync(join(repositoryRoot, 'supabase', 'migrations', fileName), 'utf8')
}

function runPreflight() {
  return JSON.parse(runSql(readFileSync(preflightPath, 'utf8')).trim())
}

function functionHash(functionIdentity) {
  return runSql(`
    select md5(pg_catalog.pg_get_functiondef('${functionIdentity}'::regprocedure));
  `).trim()
}

function targetByName(result, functionName) {
  return result.targetFunctions.find(item => item.function_name === functionName)
}

function assertReady(result) {
  assert.equal(result.gateStatus, 'READY')
  assert.deepEqual(result.blockerCounts, {
    '002ChildWritePrivileges': 0,
    '002Constraints': 0,
    '002Indexes': 0,
    '002SyncFunction': 0,
    '002SyncTrigger': 0,
    payloadShapeOrCast: 0,
    summaryChecks: 0,
    summaryColumns: 0,
    targetFunctions: 0,
    targetTrigger: 0,
  })
}

try {
  docker(['image', 'inspect', postgresImage])
  docker([
    'run', '--rm', '-d', '--pull=never', '--name', containerName,
    '-e', 'POSTGRES_PASSWORD=local-summary-preflight-check', postgresImage,
  ])
  containerStarted = true
  waitForPostgres()
  runSql(bootstrapSql)

  for (const migrationFile of baselineMigrations) runSql(migrationSql(migrationFile))

  const missing002 = runPreflight()
  assert.equal(missing002.gateStatus, 'BLOCKED')
  assert.equal(missing002.blockerCounts['002Indexes'], 3)
  assert.equal(missing002.blockerCounts['002Constraints'], 3)

  runSql(migrationSql(migration002))
  assert.equal(
    functionHash('public.sync_round_children_from_payload()'),
    expectedHashes.syncChildren002,
  )

  const absentTargets = runPreflight()
  assertReady(absentTargets)
  for (const target of absentTargets.targetFunctions) assert.equal(target.status, 'absent_expected')
  assert.equal(absentTargets.targetTrigger.status, 'absent_expected')
  assert.equal(absentTargets.advisoryCounts.rowsRequiringBackfill, 0)

  runSql(`
    create function public.calculate_round_stats_from_payload(p_payload jsonb)
    returns integer language sql immutable as $$ select 0 $$;
  `)
  const wrongTargetFunction = runPreflight()
  assert.equal(wrongTargetFunction.gateStatus, 'BLOCKED')
  assert.equal(wrongTargetFunction.blockerCounts.targetFunctions, 1)
  assert.equal(
    targetByName(wrongTargetFunction, 'calculate_round_stats_from_payload').status,
    'definition_mismatch_blocker',
  )
  runSql('drop function public.calculate_round_stats_from_payload(jsonb);')

  runSql(`
    create function public.calculate_round_stats_from_payload(p_payload text)
    returns jsonb language sql immutable as $$ select '{}'::jsonb $$;
  `)
  const overloadCollision = runPreflight()
  assert.equal(overloadCollision.gateStatus, 'BLOCKED')
  assert.equal(
    targetByName(overloadCollision, 'calculate_round_stats_from_payload').status,
    'identity_collision_blocker',
  )
  runSql('drop function public.calculate_round_stats_from_payload(text);')

  runSql('alter table public.rounds alter column entered_holes drop default;')
  const wrongSummaryColumn = runPreflight()
  assert.equal(wrongSummaryColumn.gateStatus, 'BLOCKED')
  assert.equal(wrongSummaryColumn.blockerCounts.summaryColumns, 1)
  runSql('alter table public.rounds alter column entered_holes set default 0;')

  runSql(`
    create function public.wrong_round_summary_trigger()
    returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger rounds_sync_summary
    after update on public.rounds
    for each row execute function public.wrong_round_summary_trigger();
  `)
  const wrongTargetTrigger = runPreflight()
  assert.equal(wrongTargetTrigger.gateStatus, 'BLOCKED')
  assert.equal(wrongTargetTrigger.blockerCounts.targetTrigger, 1)
  assert.equal(wrongTargetTrigger.targetTrigger.status, 'definition_mismatch_blocker')
  runSql(`
    drop trigger rounds_sync_summary on public.rounds;
    drop function public.wrong_round_summary_trigger();
  `)

  runSql(`
    insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001');
    insert into public.rounds (
      id, user_id, course_name, front_course_name, back_course_name, tee, payload
    ) values (
      'local-summary-preflight-fixture',
      '00000000-0000-0000-0000-000000000001',
      'local fixture', 'front', 'back', '화이트',
      '{"holes":[{"score":4,"par":4,"putts":2,"fir":true,"gir":true}]}'::jsonb
    );
  `)
  const backfillImpact = runPreflight()
  assertReady(backfillImpact)
  assert.equal(backfillImpact.advisoryCounts.rowsRequiringBackfill, 1)
  assert.equal(backfillImpact.cacheMismatchCounts.summary_column_mismatch_count, 1)
  assert.equal(backfillImpact.cacheMismatchCounts.stats_summary_mismatch_count, 1)
  runSql("delete from public.rounds where id = 'local-summary-preflight-fixture';")

  runSql(`
    alter table public.rounds disable trigger rounds_sync_children;
    insert into public.rounds (
      id, user_id, course_name, front_course_name, back_course_name, tee, payload
    ) values (
      'local-invalid-payload-fixture',
      '00000000-0000-0000-0000-000000000001',
      'local fixture', 'front', 'back', '화이트',
      '{"holes":{}}'::jsonb
    );
  `)
  const invalidPayload = runPreflight()
  assert.equal(invalidPayload.gateStatus, 'BLOCKED')
  assert.equal(invalidPayload.blockerCounts.payloadShapeOrCast, 1)
  assert.equal(invalidPayload.payloadValidationCounts.invalid_holes_container_count, 1)
  runSql(`
    delete from public.rounds where id = 'local-invalid-payload-fixture';
    alter table public.rounds enable trigger rounds_sync_children;
  `)

  runSql(migrationSql(migration003))
  assert.equal(
    functionHash('public.calculate_round_stats_from_payload(jsonb)'),
    expectedHashes.calculateSummary003,
  )
  assert.equal(
    functionHash('public.sync_round_summary_from_payload()'),
    expectedHashes.syncSummary003,
  )
  const exactTargets = runPreflight()
  assertReady(exactTargets)
  for (const target of exactTargets.targetFunctions) assert.equal(target.status, 'exact_existing')
  assert.equal(exactTargets.targetTrigger.status, 'exact_existing')

  process.stdout.write('✓ missing migration 002 prerequisites are BLOCKED\n')
  process.stdout.write('✓ exact migration 002 prerequisites are READY\n')
  process.stdout.write('✓ conflicting target function, trigger, and summary column definitions are BLOCKED\n')
  process.stdout.write('✓ invalid payload shape is counted without exposing rows and is BLOCKED\n')
  process.stdout.write('✓ payload/summary mismatches are aggregate backfill impact only\n')
  process.stdout.write('✓ exact migration 003 functions and trigger are accepted\n')
} catch (error) {
  const detail = error?.stderr?.toString().trim() || error?.stack || error?.message || String(error)
  process.stderr.write(`migration 003 preflight 검증 실패: ${detail}\n`)
  process.exitCode = 1
} finally {
  if (containerStarted) spawnSync('docker', ['stop', containerName], { cwd: repositoryRoot, stdio: 'ignore' })
}
