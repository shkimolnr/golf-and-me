import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [preflight, integrationScript, checklist, packageJson] = await Promise.all([
  readFile(new URL('../supabase/verification/202609010002_derived_data_integrity_preflight.sql', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/verifyDerivedIntegrityPreflight.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/audits/20260901_migration_002_preflight.md', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
])

function executableSql(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/'(?:''|[^'])*'/g, "''")
}

test('002 preflight는 READ ONLY이며 행 값 대신 catalog와 집계만 반환한다', () => {
  const executable = executableSql(preflight)
  assert.match(executable, /begin transaction read only/i)
  assert.doesNotMatch(executable, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|copy)\b/i)
  assert.match(preflight, /data_violation_checks/i)
  assert.match(preflight, /count\(\*\)::bigint as violation_count/i)
  assert.match(preflight, /migration_002_preflight/i)
})

test('같은 이름의 index와 FK는 정확한 구조 또는 부재만 허용한다', () => {
  for (const objectName of [
    'rounds_id_user_uidx',
    'round_holes_round_hole_user_uidx',
    'user_clubs_id_user_uidx',
    'round_holes_round_user_fkey',
    'round_shots_round_hole_user_fkey',
    'club_distance_history_club_user_fkey',
  ]) assert.match(preflight, new RegExp(objectName))
  assert.match(preflight, /mismatch_blocker/g)
  assert.match(preflight, /equivalentOtherIndexes/)
  assert.match(preflight, /equivalentOtherConstraints/)
})

test('함수·trigger·004 권한 상태가 blocker gate에 포함된다', () => {
  assert.match(preflight, /117d20b5e9c660b31d6a8fefcd8354da/)
  assert.match(preflight, /rounds_sync_children/)
  assert.match(preflight, /risky_privilege_violation_count/)
  assert.match(preflight, /gateStatus/)
  assert.match(checklist, /별도 명시적 승인 전에는 `002`를 실행하지 않습니다/)
})

test('로컬 통합시험은 absent·wrong-name·equivalent·exact 상태를 재현한다', () => {
  assert.match(integrationScript, /postgres:17\.6/)
  assert.match(integrationScript, /wrongNamedIndex/)
  assert.match(integrationScript, /wrongNamedConstraint/)
  assert.match(integrationScript, /equivalentOtherName/)
  assert.match(integrationScript, /exactExisting/)
  assert.equal(
    JSON.parse(packageJson).scripts['test:db-integrity-preflight'],
    'node scripts/verifyDerivedIntegrityPreflight.mjs',
  )
})
