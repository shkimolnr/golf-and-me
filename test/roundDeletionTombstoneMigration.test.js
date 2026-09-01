import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [migration, rollback, preflight, verification, integrationScript, packageJson] = await Promise.all([
  readFile(new URL('../supabase/migrations/202609010005_round_deletion_tombstones.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/rollbacks/202609010005_round_deletion_tombstones_rollback.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/verification/202609010005_round_deletion_tombstones_preflight.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/verification/202609010005_round_deletion_tombstones_checks.sql', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/verifyRoundDeletionTombstones.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
])

function executableSql(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/'(?:''|[^'])*'/g, "''")
}

test('005는 최소 tombstone과 계정 cascade만 추가하고 원본 backfill을 하지 않는다', () => {
  assert.match(migration, /create table public\.round_tombstones/i)
  assert.match(migration, /round_id text primary key/i)
  assert.match(migration, /user_id uuid not null references auth\.users\(id\) on delete cascade/i)
  assert.match(migration, /deleted_at timestamptz not null default clock_timestamp\(\)/i)
  assert.doesNotMatch(migration, /\bupdate public\.rounds\b/i)
  assert.doesNotMatch(migration, /\bdelete from public\.rounds\b/i)
  assert.doesNotMatch(migration, /course_name|score|payload jsonb/i)
})

test('DB trigger가 DELETE 표식과 stale write 차단을 강제한다', () => {
  assert.match(migration, /record_round_tombstone_before_delete/)
  assert.match(migration, /reject_tombstoned_round_write/)
  assert.match(migration, /pg_try_advisory_xact_lock/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /round_delete_retry/)
  assert.match(migration, /round_tombstoned/)
  assert.match(migration, /before delete on public\.rounds/i)
  assert.match(migration, /before insert or update on public\.rounds/i)
})

test('tombstone은 본인 SELECT만 허용하고 runtime 직접 write·DDL을 차단한다', () => {
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /for select\s+to authenticated\s+using \(auth\.uid\(\) = user_id\)/i)
  assert.match(migration, /revoke all on table public\.round_tombstones/i)
  assert.match(migration, /grant select on table public\.round_tombstones to authenticated/i)
  assert.match(migration, /revoke all on function public\.record_round_tombstone_before_delete\(\)/i)
})

test('rollback은 tombstone이 있으면 재생성 보호를 제거하지 않는다', () => {
  assert.match(rollback, /round_tombstones_not_empty/)
  assert.match(rollback, /exists \(select 1 from public\.round_tombstones\)/i)
  assert.match(rollback, /drop trigger if exists rounds_00_record_tombstone_before_delete/i)
})

test('preflight와 post-check는 READ ONLY이며 행 값 대신 집계와 catalog만 반환한다', () => {
  for (const sql of [preflight, verification]) {
    const executable = executableSql(sql)
    assert.match(executable, /begin transaction read only/i)
    assert.doesNotMatch(executable, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|copy)\b/i)
  }
  assert.match(preflight, /runtime_004_status/)
  assert.match(preflight, /eb89388ca6e924490945b3b3cfea423f/)
  assert.match(preflight, /0c86baea5e633a1d5d5982bb212cbb20/)
  assert.match(verification, /active_tombstone_overlap_count/)
  assert.match(verification, /tombstone_user_orphan_count/)
})

test('격리시험은 두 적용 순서·경합·RLS·계정 cascade·rollback을 검증한다', () => {
  assert.match(integrationScript, /postgres:17\.6/)
  assert.match(integrationScript, /without004/)
  assert.match(integrationScript, /currentpreview/)
  assert.match(integrationScript, /fullreplay/)
  assert.match(integrationScript, /verifyDeleteRetryLock/)
  assert.match(integrationScript, /delete from auth\.users/i)
  assert.match(integrationScript, /rollback005Path/)
  assert.equal(
    JSON.parse(packageJson).scripts['test:db-round-deletions'],
    'node scripts/verifyRoundDeletionTombstones.mjs',
  )
})
