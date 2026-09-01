import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const postgresImage = process.env.GOLF_AND_ME_POSTGRES_IMAGE || 'postgres:17.6'
const containerName = `golf-me-round-tombstones-${process.pid}`
const migrationDirectory = join(repositoryRoot, 'supabase', 'migrations')
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
const migration003 = '202609010003_round_summary_sync.sql'
const migration004 = '202609010004_runtime_table_least_privilege.sql'
const migration005 = '202609010005_round_deletion_tombstones.sql'
const rollback005Path = join(
  repositoryRoot, 'supabase', 'rollbacks',
  '202609010005_round_deletion_tombstones_rollback.sql',
)
const preflight005Path = join(
  repositoryRoot, 'supabase', 'verification',
  '202609010005_round_deletion_tombstones_preflight.sql',
)
const expectedHashes = {
  recordTombstone: 'eb89388ca6e924490945b3b3cfea423f',
  rejectWrite: '0c86baea5e633a1d5d5982bb212cbb20',
}
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

function createDatabase(database, migrations) {
  docker(['exec', containerName, 'createdb', '-U', 'postgres', database])
  runSql(database, bootstrapSql)
  let runtimeRiskSimulated = false
  for (const migration of migrations) {
    if (migration === migration004) {
      runSql(database, `
        grant truncate, references, trigger on all tables in schema public
          to anon, authenticated, service_role;
      `)
      runtimeRiskSimulated = true
    }
    runSql(database, migrationSql(migration))
  }
  if (!runtimeRiskSimulated) {
    runSql(database, `
      grant truncate, references, trigger on all tables in schema public
        to anon, authenticated, service_role;
    `)
  }
}

function runPreflight(database) {
  return JSON.parse(runSql(database, readFileSync(preflight005Path, 'utf8')).trim())
}

function functionHash(database, identity) {
  return runSql(database, `
    select md5(pg_catalog.pg_get_functiondef('${identity}'::regprocedure));
  `).trim()
}

function count(database, expression) {
  return Number(runSql(database, `select count(*) from ${expression};`).trim())
}

function insertUser(database, userId) {
  runSql(database, `insert into auth.users (id) values ('${userId}') on conflict do nothing;`)
}

function insertRound(database, { id, userId, updatedAt = '2026-09-01T00:00:00.000Z' }) {
  runSql(database, `
    insert into public.rounds (
      id, user_id, course_name, front_course_name, back_course_name,
      tee, status, payload, updated_at
    ) values (
      '${id}', '${userId}', 'synthetic', 'front', 'back',
      '화이트', 'in_progress',
      '{"id":"${id}","status":"in_progress","holes":[],"updatedAt":"${updatedAt}"}'::jsonb,
      '${updatedAt}'::timestamptz
    );
  `)
}

function assertExactPreflight(result) {
  assert.equal(result.gateStatus, 'READY', JSON.stringify(result, null, 2))
  assert.equal(result.runtime004.status, 'APPLIED_VERIFIED')
  assert.equal(result.runtime004.risky_privilege_count, 0)
  assert.equal(result.targetTable.status, 'exact_existing')
  for (const item of result.columns) assert.equal(item.status, 'exact_existing')
  for (const item of result.functions) assert.equal(item.status, 'exact_existing')
  for (const item of result.triggers) assert.equal(item.status, 'exact_existing')
  assert.equal(result.policy.status, 'exact_existing')
  for (const item of result.targetPrivileges) assert.equal(item.status, 'exact_existing')
}

function assertCommandFails(database, sql, pattern) {
  assert.throws(
    () => runSql(database, sql),
    error => pattern.test(error?.stderr?.toString() || error?.message || ''),
  )
}

function verifyFunctionalBehavior(database, suffix) {
  const userA = `00000000-0000-0000-0000-${suffix.padStart(12, '0')}`
  const userB = `10000000-0000-0000-0000-${suffix.padStart(12, '0')}`
  const deletedRoundId = `deleted-${suffix}`
  const activeRoundId = `active-${suffix}`
  insertUser(database, userA)
  insertUser(database, userB)
  insertRound(database, { id: deletedRoundId, userId: userA })
  runSql(database, `delete from public.rounds where id = '${deletedRoundId}';`)

  assert.equal(count(database, `public.rounds where id = '${deletedRoundId}'`), 0)
  assert.equal(count(database, `public.round_tombstones where round_id = '${deletedRoundId}'`), 1)
  assertCommandFails(
    database,
    `insert into public.rounds (
      id, user_id, course_name, front_course_name, back_course_name, tee, payload
    ) values (
      '${deletedRoundId}', '${userA}', 'stale', 'front', 'back', '화이트',
      '{"id":"${deletedRoundId}","holes":[]}'::jsonb
    );`,
    /round_tombstoned/,
  )

  const ownVisible = Number(runSql(database, `
    begin;
    set local role authenticated;
    select set_config('request.jwt.claim.sub', '${userA}', true);
    select count(*) from public.round_tombstones;
    rollback;
  `).trim().split('\n').at(-1))
  const otherVisible = Number(runSql(database, `
    begin;
    set local role authenticated;
    select set_config('request.jwt.claim.sub', '${userB}', true);
    select count(*) from public.round_tombstones;
    rollback;
  `).trim().split('\n').at(-1))
  assert.equal(ownVisible, 1)
  assert.equal(otherVisible, 0)
  assertCommandFails(database, `
    begin;
    set local role authenticated;
    select set_config('request.jwt.claim.sub', '${userA}', true);
    insert into public.round_tombstones (round_id, user_id)
      values ('forbidden-${suffix}', '${userA}');
  `, /permission denied/)

  insertRound(database, { id: activeRoundId, userId: userA })
  insertRound(database, { id: `other-${suffix}`, userId: userB })
  runSql(database, `delete from public.rounds where id = 'other-${suffix}';`)
  runSql(database, `delete from auth.users where id = '${userA}';`)
  assert.equal(count(database, `public.rounds where user_id = '${userA}'`), 0)
  assert.equal(count(database, `public.round_tombstones where user_id = '${userA}'`), 0)
  assert.equal(count(database, `public.round_tombstones where user_id = '${userB}'`), 1)
}

async function verifyDeleteRetryLock(database, suffix) {
  const userId = `20000000-0000-0000-0000-${suffix.padStart(12, '0')}`
  const roundId = `lock-${suffix}`
  insertUser(database, userId)
  insertRound(database, { id: roundId, userId })

  const holder = spawn('docker', [
    'exec', '-i', containerName,
    'psql', '-U', 'postgres', '-d', database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  ], { cwd: repositoryRoot, stdio: ['pipe', 'pipe', 'pipe'] })
  let holderOutput = ''
  holder.stdout.on('data', chunk => { holderOutput += chunk.toString() })
  holder.stdin.end(`
    begin;
    select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('${roundId}', 9049));
    select 'lock_ready';
    select pg_sleep(2);
    commit;
  `)

  const startedAt = Date.now()
  while (!holderOutput.includes('lock_ready')) {
    if (Date.now() - startedAt > 5000) throw new Error('advisory lock holder did not become ready')
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  assertCommandFails(
    database,
    `delete from public.rounds where id = '${roundId}';`,
    /round_delete_retry/,
  )
  await new Promise((resolve, reject) => {
    holder.once('exit', code => code === 0 ? resolve() : reject(new Error('lock holder failed')))
  })
  runSql(database, `delete from public.rounds where id = '${roundId}';`)
  assert.equal(count(database, `public.rounds where id = '${roundId}'`), 0)
  assert.equal(count(database, `public.round_tombstones where round_id = '${roundId}'`), 1)
}

try {
  docker(['image', 'inspect', postgresImage])
  docker([
    'run', '--rm', '-d', '--pull=never', '--name', containerName,
    '-e', 'POSTGRES_PASSWORD=local-round-tombstone-check', postgresImage,
  ])
  containerStarted = true
  waitForPostgres()
  runSql('postgres', globalRoleSql)

  createDatabase('without004', baseMigrations)
  const missing004 = runPreflight('without004')
  assert.equal(missing004.gateStatus, 'BLOCKED')
  assert.equal(missing004.runtime004.status, 'MISSING_OR_DRIFT')
  assert.equal(missing004.runtime004.risky_privilege_count, 63)
  assert.equal(missing004.targetTable.status, 'absent_expected')
  runSql('without004', migrationSql(migration005))
  runSql('without004', migrationSql(migration004))
  assertExactPreflight(runPreflight('without004'))
  verifyFunctionalBehavior('without004', '1')

  createDatabase('currentpreview', [...baseMigrations, migration004])
  const absentCurrent = runPreflight('currentpreview')
  assert.equal(absentCurrent.gateStatus, 'READY')
  assert.equal(absentCurrent.targetTable.status, 'absent_expected')
  runSql('currentpreview', migrationSql(migration005))
  assert.equal(
    functionHash('currentpreview', 'public.record_round_tombstone_before_delete()'),
    expectedHashes.recordTombstone,
  )
  assert.equal(
    functionHash('currentpreview', 'public.reject_tombstoned_round_write()'),
    expectedHashes.rejectWrite,
  )
  assertExactPreflight(runPreflight('currentpreview'))
  runSql('currentpreview', readFileSync(rollback005Path, 'utf8'))
  assert.equal(runPreflight('currentpreview').targetTable.status, 'absent_expected')
  runSql('currentpreview', migrationSql(migration005))
  verifyFunctionalBehavior('currentpreview', '2')
  await verifyDeleteRetryLock('currentpreview', '3')

  createDatabase('fullreplay', [
    ...baseMigrations, migration002, migration003, migration004,
  ])
  assert.equal(runPreflight('fullreplay').gateStatus, 'READY')
  runSql('fullreplay', migrationSql(migration005))
  assertExactPreflight(runPreflight('fullreplay'))
  verifyFunctionalBehavior('fullreplay', '4')

  process.stdout.write('✓ 004-missing baseline reports 63 runtime privilege blockers; 005 remains independently applicable\n')
  process.stdout.write('✓ baseline+005+004, baseline+004+005, and full 002+003+004+005 orders pass\n')
  process.stdout.write('✓ delete creates one minimal tombstone and stale insert is rejected\n')
  process.stdout.write('✓ RLS/ACL isolate tombstones and block browser writes\n')
  process.stdout.write('✓ retryable advisory-lock contention converges to deletion without deadlock\n')
  process.stdout.write('✓ account deletion cascades active rounds and tombstones without a transaction flag\n')
  process.stdout.write('✓ clean rollback and reapply succeed\n')
} catch (error) {
  const detail = error?.stderr?.toString().trim() || error?.stack || error?.message || String(error)
  process.stderr.write(`round tombstone DB 검증 실패: ${detail}\n`)
  process.exitCode = 1
} finally {
  if (containerStarted) spawnSync('docker', ['stop', containerName], { cwd: repositoryRoot, stdio: 'ignore' })
}
