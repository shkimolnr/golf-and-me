import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const postgresImage = process.env.GOLF_AND_ME_POSTGRES_IMAGE || 'postgres:17.6'
const containerName = `golf-me-integrity-preflight-${process.pid}`
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
const preflightPath = join(
  repositoryRoot,
  'supabase',
  'verification',
  '202609010002_derived_data_integrity_preflight.sql',
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

function runPreflight() {
  return JSON.parse(runSql(readFileSync(preflightPath, 'utf8')).trim())
}

function checkByName(checks, key, value) {
  return checks.find(check => check[key] === value)
}

function assertReadyBaseline(result) {
  assert.equal(result.gateStatus, 'READY')
  assert.deepEqual(result.blockerCounts, {
    columns: 0,
    dataViolations: 0,
    functionBaseline: 0,
    namedConstraints: 0,
    namedIndexes: 0,
    riskyRuntimePrivileges: 0,
    roundsSyncTrigger: 0,
  })
  assert.equal(result.functionBaseline.status, 'exact_baseline')
  assert.equal(result.functionBaseline.actual_definition_hash, '117d20b5e9c660b31d6a8fefcd8354da')
  assert.equal(result.roundsSyncTrigger.status, 'exact_existing')
}

try {
  docker(['image', 'inspect', postgresImage])
  docker([
    'run', '--rm', '-d', '--pull=never', '--name', containerName,
    '-e', 'POSTGRES_PASSWORD=local-preflight-check', postgresImage,
  ])
  containerStarted = true
  waitForPostgres()
  runSql(bootstrapSql)

  const migrationDirectory = join(repositoryRoot, 'supabase', 'migrations')
  for (const migrationFile of baselineMigrations) {
    runSql(readFileSync(join(migrationDirectory, migrationFile), 'utf8'))
  }

  const absentBaseline = runPreflight()
  assertReadyBaseline(absentBaseline)
  for (const index of absentBaseline.namedIndexes) assert.equal(index.status, 'absent_expected')
  for (const constraint of absentBaseline.namedConstraints) assert.equal(constraint.status, 'absent_expected')

  runSql('create index rounds_id_user_uidx on public.rounds (id);')
  const wrongNamedIndex = runPreflight()
  assert.equal(wrongNamedIndex.gateStatus, 'BLOCKED')
  assert.equal(wrongNamedIndex.blockerCounts.namedIndexes, 1)
  assert.equal(
    checkByName(wrongNamedIndex.namedIndexes, 'index_name', 'rounds_id_user_uidx').status,
    'mismatch_blocker',
  )
  runSql('drop index public.rounds_id_user_uidx;')

  runSql(`
    alter table public.round_holes
      add constraint round_holes_round_user_fkey
      foreign key (user_id) references auth.users (id) on delete cascade;
  `)
  const wrongNamedConstraint = runPreflight()
  assert.equal(wrongNamedConstraint.gateStatus, 'BLOCKED')
  assert.equal(wrongNamedConstraint.blockerCounts.namedConstraints, 1)
  runSql(`
    alter table public.round_holes
      drop constraint round_holes_round_user_fkey;
  `)

  runSql(`
    create unique index alternate_rounds_id_user_uidx
      on public.rounds (id, user_id);
  `)
  const equivalentOtherName = runPreflight()
  assertReadyBaseline(equivalentOtherName)
  assert.equal(equivalentOtherName.advisoryCounts.equivalentObjectsWithOtherNames, 1)
  runSql('drop index public.alternate_rounds_id_user_uidx;')

  runSql(`
    create unique index rounds_id_user_uidx on public.rounds (id, user_id);
    create unique index round_holes_round_hole_user_uidx
      on public.round_holes (round_id, hole_number, user_id);
    create unique index user_clubs_id_user_uidx on public.user_clubs (id, user_id);
    alter table public.round_holes
      add constraint round_holes_round_user_fkey
      foreign key (round_id, user_id)
      references public.rounds (id, user_id) on delete cascade not valid;
    alter table public.round_shots
      add constraint round_shots_round_hole_user_fkey
      foreign key (round_id, hole_number, user_id)
      references public.round_holes (round_id, hole_number, user_id) on delete cascade not valid;
    alter table public.club_distance_history
      add constraint club_distance_history_club_user_fkey
      foreign key (club_id, user_id)
      references public.user_clubs (id, user_id) on delete cascade not valid;
  `)
  const exactExisting = runPreflight()
  assertReadyBaseline(exactExisting)
  for (const index of exactExisting.namedIndexes) assert.equal(index.status, 'exact_existing')
  for (const constraint of exactExisting.namedConstraints) {
    assert.equal(constraint.status, 'exact_pending_validation')
  }

  process.stdout.write('✓ absent target objects are READY for additive creation\n')
  process.stdout.write('✓ wrong same-name index and FK definitions are BLOCKED\n')
  process.stdout.write('✓ equivalent objects under other names are advisory\n')
  process.stdout.write('✓ exact existing indexes and NOT VALID FKs are accepted\n')
  process.stdout.write('✓ function baseline, trigger, data, and 004 privilege gates are READY\n')
} catch (error) {
  const detail = error?.stderr?.toString().trim() || error?.message || String(error)
  process.stderr.write(`migration 002 preflight 검증 실패: ${detail}\n`)
  process.exitCode = 1
} finally {
  if (containerStarted) spawnSync('docker', ['stop', containerName], { cwd: repositoryRoot, stdio: 'ignore' })
}
