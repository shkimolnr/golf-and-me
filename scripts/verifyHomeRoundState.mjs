import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const postgresImage = process.env.GOLF_AND_ME_POSTGRES_IMAGE || 'postgres:17.6'
const containerName = `golf-me-home-state-${process.pid}`
const userId = '00000000-0000-0000-0000-000000000053'
const otherUserId = '00000000-0000-0000-0000-000000000054'
const expectedFunctionHash = 'e43f9ab00acc164c18ca3c38cc8f059d'
const targetMigration = '202609030003_home_round_state.sql'
let containerStarted = false

function docker(args, options = {}) {
  return execFileSync('docker', args, {
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
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`

function homeState(limit = 25, cursor = null, selectedUserId = userId) {
  const cursorSql = cursor
    ? `$cursor$${JSON.stringify(cursor)}$cursor$::jsonb`
    : 'null::jsonb'
  const output = runSql(`
    begin;
    set local role authenticated;
    set local request.jwt.claim.sub = '${selectedUserId}';
    select public.get_home_round_state(${limit}, ${cursorSql})::text;
    rollback;
  `).trim()
  return JSON.parse(output.split('\n').find(line => line.startsWith('{')))
}

function seedRounds(count) {
  runSql(`
    truncate table public.rounds cascade;
    insert into auth.users (id) values ('${userId}'), ('${otherUserId}') on conflict do nothing;
    with generated_rounds as (
      select
        sequence,
        'round-' || lpad(sequence::text, 4, '0') as round_id,
        to_char(timestamp '2026-09-03 07:00' - sequence * interval '1 day', 'YYYY-MM-DD"T"HH24:MI') as played_at,
        jsonb_build_object(
          'id', 'round-' || lpad(sequence::text, 4, '0'),
          'status', 'completed',
          'courseName', '부하 검증 코스',
          'frontCourseName', 'OUT',
          'backCourseName', 'IN',
          'tee', '화이트',
          'distanceUnit', 'M',
          'playedAt', to_char(timestamp '2026-09-03 07:00' - sequence * interval '1 day', 'YYYY-MM-DD"T"HH24:MI'),
          'holes', (
            select jsonb_agg(jsonb_build_object(
              'holeNumber', hole_number,
              'par', case when hole_number in (3, 7, 12, 16) then 3 when hole_number in (5, 9, 14, 18) then 5 else 4 end,
              'score', 4 + ((sequence + hole_number) % 3),
              'putts', 1 + ((sequence + hole_number) % 3),
              'fir', case when hole_number in (3, 7, 12, 16) then null else ((sequence + hole_number) % 2 = 0) end,
              'gir', ((sequence + hole_number) % 3 = 0),
              'shots', jsonb_build_array(jsonb_build_object('club', 'D'))
            ) order by hole_number)
            from generate_series(1, 18) as holes(hole_number)
          )
        ) as payload
      from generate_series(1, ${count}) as rounds(sequence)
    )
    insert into public.rounds (
      id, user_id, course_name, front_course_name, back_course_name, tee,
      distance_unit, played_at_local, status, completed_at, payload, updated_at
    )
    select
      round_id, '${userId}', '부하 검증 코스', 'OUT', 'IN', '화이트',
      'M', played_at, 'completed', now(), payload,
      timestamptz '2026-09-03 00:00:00+00' - sequence * interval '1 second'
    from generated_rounds;

    insert into public.rounds (
      id, user_id, course_name, front_course_name, back_course_name, tee,
      distance_unit, played_at_local, status, completed_at, payload, updated_at
    ) values (
      'other-user-round', '${otherUserId}', '다른 사용자 코스', 'OUT', 'IN', '화이트',
      'M', '2026-09-03T08:00', 'completed', now(),
      '{"id":"other-user-round","status":"completed","holes":[]}'::jsonb, now()
    );
  `)
}

function runPreflight() {
  const sql = readFileSync(join(
    repositoryRoot,
    'supabase',
    'verification',
    '202609030003_home_round_state_preflight.sql',
  ), 'utf8')
  return JSON.parse(runSql(sql).trim())
}

try {
  docker(['image', 'inspect', postgresImage])
  docker([
    'run', '--rm', '-d', '--pull=never', '--name', containerName,
    '-e', 'POSTGRES_PASSWORD=local-home-state-check', postgresImage,
  ])
  containerStarted = true
  waitForPostgres()
  runSql(bootstrapSql)

  const migrationDirectory = join(repositoryRoot, 'supabase', 'migrations')
  const migrationFiles = readdirSync(migrationDirectory)
    .filter(file => file.endsWith('.sql'))
    .sort()
  for (const migrationFile of migrationFiles) {
    if (migrationFile === targetMigration) continue
    runSql(readFileSync(join(migrationDirectory, migrationFile), 'utf8'))
  }

  const absentPreflight = runPreflight()
  if (absentPreflight.gateStatus !== 'READY') {
    process.stderr.write(`${JSON.stringify(absentPreflight)}\n`)
  }
  assert.equal(absentPreflight.gateStatus, 'READY')
  assert.equal(absentPreflight.targetFunction.status, 'absent_expected')
  assert.equal(absentPreflight.targetIndex.status, 'absent_expected')

  runSql(`
    create function public.get_home_round_state(p_limit integer default 25, p_cursor jsonb default null)
    returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create index rounds_user_status_played_updated_id_idx on public.rounds(user_id);
  `)
  const collisionPreflight = runPreflight()
  assert.equal(collisionPreflight.gateStatus, 'BLOCKED')
  assert.equal(collisionPreflight.blockerCounts.targetFunction, 1)
  assert.equal(collisionPreflight.blockerCounts.targetIndex, 1)
  runSql(`
    drop function public.get_home_round_state(integer, jsonb);
    drop index public.rounds_user_status_played_updated_id_idx;
  `)

  runSql(readFileSync(join(migrationDirectory, targetMigration), 'utf8'))
  const exactPreflight = runPreflight()
  assert.equal(exactPreflight.gateStatus, 'READY')
  assert.equal(exactPreflight.targetFunction.status, 'exact_existing')
  assert.equal(exactPreflight.targetIndex.status, 'exact_existing')

  for (const count of [0, 25, 100, 250]) {
    seedRounds(count)
    const firstPage = homeState()
    assert.equal(firstPage.completedTotal, count)
    assert.equal(firstPage.completedRounds.length, Math.min(25, count))
    assert.equal(firstPage.versions.length, count)
    assert.equal(firstPage.cumulativeStats.roundCount, count)
    assert.equal(firstPage.completedRounds.every(round => !('holes' in round)), true)
    assert.equal(firstPage.completedRounds.every(round => !('payload' in round)), true)
    assert.equal(homeState(25, null, otherUserId).completedTotal, 1)
    process.stdout.write(`✓ ${count}개 첫 화면 응답·RLS·누적 통계 검증\n`)
  }

  seedRounds(250)
  const collectedIds = []
  let cursor = null
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const page = homeState(25, cursor)
    collectedIds.push(...page.completedRounds.map(round => round.id))
    cursor = page.nextCursor
  }
  assert.equal(collectedIds.length, 250)
  assert.equal(new Set(collectedIds).size, 250)
  assert.equal(collectedIds[0], 'round-0001')
  assert.equal(collectedIds.at(-1), 'round-0250')

  const firstPage = homeState()
  const fullPayloadBytes = Number(runSql(`
    select coalesce(sum(pg_column_size(payload)), 0)
    from public.rounds
    where user_id = '${userId}';
  `).trim())
  const responseBytes = Buffer.byteLength(JSON.stringify(firstPage))
  assert.ok(responseBytes < fullPayloadBytes * 0.4, `${responseBytes} !< ${fullPayloadBytes} * 0.4`)

  const anonResult = spawnSync('docker', [
    'exec', '-i', containerName,
    'psql', '-U', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: 'set role anon; select public.get_home_round_state(25, null::jsonb);',
  })
  assert.notEqual(anonResult.status, 0)

  const functionHash = runSql(`
    select md5(pg_catalog.pg_get_functiondef(
      'public.get_home_round_state(integer, jsonb)'::regprocedure
    ));
  `).trim()
  assert.equal(functionHash, expectedFunctionHash)

  process.stdout.write('✓ 커서 10페이지에 중복·누락 없음\n')
  process.stdout.write(`✓ 250개 첫 응답 ${responseBytes} bytes, 전체 payload ${fullPayloadBytes} bytes\n`)
  process.stdout.write('✓ anon 실행 차단 확인\n')
  process.stdout.write(`✓ get_home_round_state hash ${functionHash.trim()}\n`)
  process.stdout.write('✓ 적용 전 부재·충돌 차단·적용 후 exact preflight 검증\n')
} catch (error) {
  const detail = error?.stderr?.toString().trim() || error?.stack || error?.message || String(error)
  process.stderr.write(`TASK-053 DB 검증 실패: ${detail}\n`)
  process.exitCode = 1
} finally {
  if (containerStarted) spawnSync('docker', ['stop', containerName], { cwd: repositoryRoot, stdio: 'ignore' })
}
