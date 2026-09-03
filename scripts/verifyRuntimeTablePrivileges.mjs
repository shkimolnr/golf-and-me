import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const postgresImage = process.env.GOLF_AND_ME_POSTGRES_IMAGE || 'postgres:18.3'
const containerName = `golf-me-runtime-privileges-${process.pid}`
const targetMigration = '202609010004_runtime_table_least_privilege.sql'
const rollbackPath = join(
  repositoryRoot,
  'supabase',
  'rollbacks',
  '202609010004_runtime_table_least_privilege_rollback.sql',
)
const verificationPath = join(
  repositoryRoot,
  'supabase',
  'verification',
  '202609010004_runtime_table_least_privilege_checks.sql',
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

const simulateSupabaseDefaultsSql = `
grant truncate, references, trigger on all tables in schema public
to anon, authenticated, service_role;
`

const riskyPrivilegeCountSql = `
select count(*)::integer
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
cross join (values
  ('profiles'), ('rounds'), ('round_holes'), ('round_shots'),
  ('user_clubs'), ('club_distance_history'), ('app_diagnostics')
) as tables(table_name)
cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as privileges(privilege_name)
where has_table_privilege(
  roles.role_name,
  format('%I.%I', 'public', tables.table_name),
  privileges.privilege_name
);
`

const crudSnapshotSql = `
with privileges as (
  select
    roles.role_name,
    tables.table_name,
    operations.privilege_name,
    has_table_privilege(
      roles.role_name,
      format('%I.%I', 'public', tables.table_name),
      operations.privilege_name
    ) as allowed
  from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
  cross join (values
    ('profiles'), ('rounds'), ('round_holes'), ('round_shots'),
    ('user_clubs'), ('club_distance_history'), ('app_diagnostics')
  ) as tables(table_name)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as operations(privilege_name)
)
select jsonb_agg(to_jsonb(privileges) order by role_name, table_name, privilege_name)::text
from privileges;
`

function riskyPrivilegeCount() {
  return Number(runSql(riskyPrivilegeCountSql).trim())
}

function assertTruncateDenied(roleName) {
  const result = spawnSync('docker', [
    'exec', containerName,
    'psql', '-U', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1',
    '-c', `set role ${roleName}; truncate table public.app_diagnostics;`,
  ], { cwd: repositoryRoot, encoding: 'utf8' })
  assert.notEqual(result.status, 0, `${roleName}의 TRUNCATE가 거부되지 않았습니다.`)
  assert.match(result.stderr, /permission denied for table app_diagnostics/i)
}

function assertMigrationRejectsInheritedPrivilege(migrationSql) {
  runSql(`
    create role inherited_risky_privileges nologin;
    grant truncate, references, trigger on all tables in schema public
      to inherited_risky_privileges;
    grant inherited_risky_privileges to authenticated;
  `)
  let rejected = false
  try {
    runSql(migrationSql)
  } catch (error) {
    rejected = true
    assert.match(error.stderr?.toString() || '', /least-privilege assertion failed/i)
  }
  assert.equal(rejected, true, '간접 권한이 남은 migration이 실패하지 않았습니다.')
  assert.equal(riskyPrivilegeCount(), 21)
  runSql(`
    revoke inherited_risky_privileges from authenticated;
    revoke truncate, references, trigger on all tables in schema public
      from inherited_risky_privileges;
    drop role inherited_risky_privileges;
  `)
}

try {
  docker(['image', 'inspect', postgresImage])
  docker([
    'run', '--rm', '-d', '--pull=never', '--name', containerName,
    '-e', 'POSTGRES_PASSWORD=local-privilege-check', postgresImage,
  ])
  containerStarted = true
  waitForPostgres()
  runSql(bootstrapSql)

  const migrationDirectory = join(repositoryRoot, 'supabase', 'migrations')
  const migrationFiles = readdirSync(migrationDirectory)
    .filter(file => file.endsWith('.sql'))
    .sort()
  assert.ok(migrationFiles.includes(targetMigration), `${targetMigration}을 찾지 못했습니다.`)
  const targetMigrationSql = readFileSync(join(migrationDirectory, targetMigration), 'utf8')

  let crudBeforeMigration
  for (const migrationFile of migrationFiles) {
    if (migrationFile === targetMigration) {
      runSql(simulateSupabaseDefaultsSql)
      assert.equal(riskyPrivilegeCount(), 63)
      crudBeforeMigration = runSql(crudSnapshotSql).trim()
    }
    runSql(readFileSync(join(migrationDirectory, migrationFile), 'utf8'))
  }

  assert.equal(riskyPrivilegeCount(), 0)
  assert.equal(runSql(crudSnapshotSql).trim(), crudBeforeMigration)
  assert.equal(runSql(`
    select has_function_privilege(
      'service_role',
      'public.record_app_diagnostic(text, uuid, text, text, smallint, text, text, boolean, timestamptz, timestamptz, integer, timestamptz, integer)'::regprocedure,
      'EXECUTE'
    ) and has_function_privilege(
      'service_role',
      'public.purge_expired_app_diagnostics(timestamptz)'::regprocedure,
      'EXECUTE'
    );
  `).trim(), 't')
  runSql(readFileSync(verificationPath, 'utf8'))
  for (const roleName of ['anon', 'authenticated', 'service_role']) assertTruncateDenied(roleName)

  runSql(readFileSync(rollbackPath, 'utf8'))
  assert.equal(riskyPrivilegeCount(), 63)
  runSql(targetMigrationSql)
  assert.equal(riskyPrivilegeCount(), 0)
  assertMigrationRejectsInheritedPrivilege(targetMigrationSql)
  runSql(targetMigrationSql)
  assert.equal(riskyPrivilegeCount(), 0)

  process.stdout.write('✓ risky effective table privileges: 63 → 0\n')
  process.stdout.write('✓ browser CRUD and service-role diagnostic RPC privileges preserved\n')
  process.stdout.write('✓ TRUNCATE denied for anon, authenticated, and service_role\n')
  process.stdout.write('✓ rollback restored observed effective matrix; reapply returned to 0\n')
  process.stdout.write('✓ inherited risky grants caused an atomic migration failure\n')
} catch (error) {
  const detail = error?.stderr?.toString().trim() || error?.message || String(error)
  process.stderr.write(`runtime table least-privilege 검증 실패: ${detail}\n`)
  process.exitCode = 1
} finally {
  if (containerStarted) spawnSync('docker', ['stop', containerName], { cwd: repositoryRoot, stdio: 'ignore' })
}
