import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultImage = process.env.GOLF_AND_ME_POSTGRES_IMAGE || 'postgres:18.3'
const expectedSyncChildrenBaselineHash = '117d20b5e9c660b31d6a8fefcd8354da'
const baselineMigrationFiles = [
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
const snapshotSqlPath = join(
  repositoryRoot,
  'supabase',
  'audits',
  '20260901_schema_only_catalog_snapshot.sql',
)
const recoveryCaptureSqlPath = join(
  repositoryRoot,
  'supabase',
  'audits',
  '20260901_preview_function_recovery_capture.sql',
)

const categoryKeys = {
  tables: row => row.tableName,
  columns: row => `${row.tableName}.${row.ordinalPosition}.${row.columnName}`,
  constraints: row => `${row.tableName}.${row.constraintName}`,
  indexes: row => `${row.tableName}.${row.indexName}`,
  policies: row => `${row.tableName}.${row.policyName}`,
  roles: row => row.roleName,
  schemaPrivileges: row => `${row.roleName}.${row.privilege}`,
  tablePrivileges: row => `${row.roleName}.${row.tableName}.${row.privilege}`,
  sequencePrivileges: row => `${row.roleName}.${row.sequenceName}.${row.privilege}`,
  functions: row => row.functionIdentity,
  functionPrivileges: row => `${row.roleName}.${row.functionIdentity}`,
  triggers: row => `${row.schemaName}.${row.tableName}.${row.triggerName}`,
  eventTriggers: row => row.triggerName,
  extensions: row => row,
}

function parseArguments(argumentsList) {
  const options = { image: defaultImage, previewSnapshotPath: null, printSnapshot: false }
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--image') options.image = argumentsList[++index]
    else if (argument === '--preview-snapshot') options.previewSnapshotPath = argumentsList[++index]
    else if (argument === '--print-local-snapshot') options.printSnapshot = true
    else throw new Error(`지원하지 않는 인자입니다: ${argument}`)
  }
  assert.ok(options.image, '--image에는 Docker image가 필요합니다.')
  return options
}

function docker(argumentsList, options = {}) {
  return execFileSync('docker', argumentsList, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  })
}

function waitForPostgres(containerName) {
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

function runSql(containerName, sql) {
  return docker([
    'exec', '-i', containerName,
    'psql', '-U', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  ], { input: sql })
}

function createLocalBaseline(image) {
  const containerName = `golf-me-db-catalog-${process.pid}-${Date.now()}`
  let containerStarted = false
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

  try {
    docker(['image', 'inspect', image])
    docker([
      'run', '--rm', '-d', '--pull=never', '--name', containerName,
      '-e', 'POSTGRES_PASSWORD=local-catalog-check', image,
    ])
    containerStarted = true
    waitForPostgres(containerName)
    runSql(containerName, bootstrapSql)

    for (const migrationFile of baselineMigrationFiles) {
      const migrationPath = join(repositoryRoot, 'supabase', 'migrations', migrationFile)
      runSql(containerName, readFileSync(migrationPath, 'utf8'))
    }

    const output = runSql(containerName, readFileSync(snapshotSqlPath, 'utf8')).trim()
    const snapshot = JSON.parse(output)
    const recoveryOutput = runSql(
      containerName,
      readFileSync(recoveryCaptureSqlPath, 'utf8'),
    ).trim()
    const recoveryBundle = JSON.parse(recoveryOutput)
    const definitionHash = createHash('md5')
      .update(recoveryBundle.definitionSql, 'utf8')
      .digest('hex')
    assert.equal(recoveryBundle.formatVersion, 1)
    assert.equal(recoveryBundle.functionIdentity, 'sync_round_children_from_payload()')
    assert.equal(recoveryBundle.definitionHash, definitionHash)
    assert.equal(recoveryBundle.definitionHash, syncChildrenHash(snapshot))
    assert.ok(Array.isArray(recoveryBundle.acl))
    return snapshot
  } finally {
    if (containerStarted) {
      spawnSync('docker', ['stop', containerName], { cwd: repositoryRoot, stdio: 'ignore' })
    }
  }
}

function readPreviewSnapshot(snapshotPath) {
  const parsed = JSON.parse(readFileSync(resolve(snapshotPath), 'utf8'))
  const exportedRow = Array.isArray(parsed) ? parsed[0] : parsed
  const snapshot = exportedRow?.schema_only_snapshot || exportedRow
  assert.ok(snapshot && typeof snapshot === 'object', 'snapshot JSON object를 찾지 못했습니다.')
  assert.equal(snapshot.formatVersion, 1, '지원하지 않는 snapshot formatVersion입니다.')
  for (const category of Object.keys(categoryKeys)) {
    assert.ok(Array.isArray(snapshot[category]), `${category}가 배열이 아닙니다.`)
  }
  return snapshot
}

function compareCategory(category, expectedRows, actualRows) {
  const keyFor = categoryKeys[category]
  const expected = new Map(expectedRows.map(row => [keyFor(row), row]))
  const actual = new Map(actualRows.map(row => [keyFor(row), row]))
  const differences = []
  const keys = [...new Set([...expected.keys(), ...actual.keys()])].sort()

  for (const key of keys) {
    if (!actual.has(key)) differences.push({ type: 'missing', key, expected: expected.get(key) })
    else if (!expected.has(key)) differences.push({ type: 'unexpected', key, actual: actual.get(key) })
    else if (!isDeepStrictEqual(expected.get(key), actual.get(key))) {
      differences.push({
        type: 'different',
        key,
        expected: expected.get(key),
        actual: actual.get(key),
      })
    }
  }
  return differences
}

function syncChildrenHash(snapshot) {
  return snapshot.functions.find(
    row => row.functionIdentity === 'sync_round_children_from_payload()',
  )?.definitionHash
}

function validateComparator(snapshot) {
  for (const category of Object.keys(categoryKeys)) {
    assert.deepEqual(compareCategory(category, snapshot[category], snapshot[category]), [])
  }
  const changedTables = structuredClone(snapshot.tables)
  assert.ok(changedTables.length > 0, 'table baseline이 비어 있습니다.')
  changedTables[0].rlsEnabled = !changedTables[0].rlsEnabled
  assert.equal(compareCategory('tables', snapshot.tables, changedTables).length, 1)
}

function printDifference(category, difference) {
  process.stdout.write(`${category}\t${difference.type}\t${difference.key}\n`)
  if (difference.expected !== undefined) {
    process.stdout.write(`  expected ${JSON.stringify(difference.expected)}\n`)
  }
  if (difference.actual !== undefined) {
    process.stdout.write(`  actual   ${JSON.stringify(difference.actual)}\n`)
  }
}

let exitCode = 0
try {
  const options = parseArguments(process.argv.slice(2))
  const localSnapshot = createLocalBaseline(options.image)
  validateComparator(localSnapshot)
  const expectedHash = syncChildrenHash(localSnapshot)
  assert.match(expectedHash || '', /^[a-f0-9]{32}$/, 'baseline 함수 hash를 찾지 못했습니다.')
  assert.equal(
    expectedHash,
    expectedSyncChildrenBaselineHash,
    '기존 9개 migration 함수 hash가 승인된 baseline과 달라졌습니다.',
  )

  process.stdout.write(`local_image=${options.image}\n`)
  process.stdout.write(`local_server_version_num=${localSnapshot.serverVersionNum}\n`)
  process.stdout.write(`sync_round_children_from_payload_expected_hash=${expectedHash}\n`)

  if (options.printSnapshot) process.stdout.write(`${JSON.stringify(localSnapshot, null, 2)}\n`)

  if (options.previewSnapshotPath) {
    const previewSnapshot = readPreviewSnapshot(options.previewSnapshotPath)
    process.stdout.write(`preview_server_version_num=${previewSnapshot.serverVersionNum}\n`)
    process.stdout.write(
      `sync_round_children_from_payload_preview_hash=${syncChildrenHash(previewSnapshot) || 'missing'}\n`,
    )

    let differenceCount = 0
    for (const category of Object.keys(categoryKeys)) {
      const differences = compareCategory(
        category,
        localSnapshot[category],
        previewSnapshot[category],
      )
      differenceCount += differences.length
      for (const difference of differences) printDifference(category, difference)
    }
    process.stdout.write(`catalog_difference_count=${differenceCount}\n`)
    if (differenceCount > 0) exitCode = 2
  }
} catch (error) {
  const detail = error?.stderr?.toString().trim() || error?.message || String(error)
  process.stderr.write(`DB catalog 교차검증 실패: ${detail}\n`)
  exitCode = 1
}

process.exitCode = exitCode
