import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateRoundStats } from '../src/lib/roundStats.js'
import { roundSummaryParityFixtures } from '../testSupport/roundSummaryParityFixtures.js'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const postgresImage = process.env.GOLF_AND_ME_POSTGRES_IMAGE || 'postgres:18.3'
const containerName = `golf-me-round-summary-parity-${process.pid}`
let containerStarted = false

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  })
}

function runSql(sql, extraArgs = []) {
  return docker([
    'exec', '-i', containerName,
    'psql', '-U', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', ...extraArgs,
  ], { input: sql })
}

function waitForPostgres() {
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4))
  let consecutiveConnections = 0
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = spawnSync('docker', [
      'exec', containerName,
      'psql', '-U', 'postgres', '-X', '-t', '-A', '-c', 'select 1',
    ], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    })
    consecutiveConnections = result.status === 0 ? consecutiveConnections + 1 : 0
    if (consecutiveConnections >= 2) return
    Atomics.wait(waitBuffer, 0, 0, 250)
  }
  throw new Error('로컬 PostgreSQL 컨테이너가 30초 안에 준비되지 않았습니다.')
}

const bootstrapSql = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid()
returns uuid
language sql
stable
as $$ select null::uuid $$;
`

try {
  docker(['image', 'inspect', postgresImage])
  docker([
    'run', '--rm', '-d', '--pull=never', '--name', containerName,
    '-e', 'POSTGRES_PASSWORD=local-parity-check', postgresImage,
  ])
  containerStarted = true
  waitForPostgres()
  runSql(bootstrapSql)

  const migrationDirectory = join(repositoryRoot, 'supabase', 'migrations')
  const migrationFiles = readdirSync(migrationDirectory)
    .filter(file => file.endsWith('.sql'))
    .sort()
  for (const migrationFile of migrationFiles) {
    runSql(readFileSync(join(migrationDirectory, migrationFile), 'utf8'))
  }

  for (const fixture of roundSummaryParityFixtures) {
    const javascriptSummary = calculateRoundStats(fixture.payload)
    assert.deepEqual(javascriptSummary, fixture.expected, `${fixture.name}: JavaScript 기대값 불일치`)

    const payloadJson = JSON.stringify(fixture.payload)
    const output = runSql(
      `select public.calculate_round_stats_from_payload($payload$${payloadJson}$payload$::jsonb)::text;`,
      ['-t', '-A'],
    )
    const postgresSummary = JSON.parse(output.trim())
    assert.deepEqual(postgresSummary, fixture.expected, `${fixture.name}: PostgreSQL 기대값 불일치`)
    assert.deepEqual(postgresSummary, javascriptSummary, `${fixture.name}: JS/PostgreSQL 의미 불일치`)
    process.stdout.write(`✓ ${fixture.name}\n`)
  }
} catch (error) {
  const detail = error?.stderr?.toString().trim() || error?.message || String(error)
  process.stderr.write(`라운드 요약 DB 동등성 검증 실패: ${detail}\n`)
  process.exitCode = 1
} finally {
  if (containerStarted) spawnSync('docker', ['stop', containerName], { cwd: repositoryRoot, stdio: 'ignore' })
}
