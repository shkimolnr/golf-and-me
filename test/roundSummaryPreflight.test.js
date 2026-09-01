import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [preflight, integrationScript, checklist, packageJson] = await Promise.all([
  readFile(new URL('../supabase/verification/202609010003_round_summary_sync_preflight.sql', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/verifyRoundSummaryPreflight.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/audits/20260901_migration_003_preflight.md', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
])

function executableSql(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/'(?:''|[^'])*'/g, "''")
}

test('003 preflight는 READ ONLY이며 사용자 행 값 대신 집계만 반환한다', () => {
  const executable = executableSql(preflight)
  const outputProjection = preflight.slice(preflight.lastIndexOf('select jsonb_build_object('))
  assert.match(executable, /begin transaction read only/i)
  assert.doesNotMatch(executable, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|copy)\b/i)
  assert.match(preflight, /payload_shape_counts/i)
  assert.match(preflight, /cache_mismatch_counts/i)
  assert.match(preflight, /count\(\*\) filter/i)
  assert.match(preflight, /migration_003_preflight/i)
  assert.doesNotMatch(outputProjection, /course_name|user_id|email|shot_sequence/i)
})

test('요약 컬럼과 002 선행 index·FK·권한을 blocker로 검사한다', () => {
  for (const columnName of [
    'entered_holes', 'par_recorded_holes', 'total_score', 'score_to_par',
    'total_putts', 'putt_attempts', 'fir_hits', 'fir_attempts',
    'gir_hits', 'gir_attempts', 'stats_summary',
  ]) assert.match(preflight, new RegExp(`'${columnName}'`))
  for (const objectName of [
    'rounds_id_user_uidx', 'round_holes_round_hole_user_uidx',
    'user_clubs_id_user_uidx', 'round_holes_round_user_fkey',
    'round_shots_round_hole_user_fkey', 'club_distance_history_club_user_fkey',
  ]) assert.match(preflight, new RegExp(objectName))
  assert.match(preflight, /prerequisite_child_write_checks/i)
  assert.match(preflight, /055b059c2c323c69234ba1ac2f526c95/)
})

test('003 목표 함수·trigger의 부재, 정확한 정의, 충돌을 구분한다', () => {
  assert.match(preflight, /calculate_round_stats_from_payload/)
  assert.match(preflight, /sync_round_summary_from_payload/)
  assert.match(preflight, /rounds_sync_summary/)
  assert.match(preflight, /f605526003886eb6d5c6961e783ba48a/)
  assert.match(preflight, /f3ada2a5cc35ff1b1e55a2c4f8bea295/)
  assert.match(preflight, /absent_expected/)
  assert.match(preflight, /exact_existing/)
  assert.match(preflight, /collision_blocker/)
})

test('불일치는 적용 예정 backfill 집계이며 003 실행 승인이 아님을 명시한다', () => {
  assert.match(preflight, /summary_column_mismatch_count/)
  assert.match(preflight, /stats_summary_mismatch_count/)
  assert.match(preflight, /rows_requiring_backfill_count/)
  assert.match(checklist, /별도 명시적 승인 전에는 `003`을 실행하지 않습니다/)
  assert.match(checklist, /Production 적용 근거로 사용하지 않습니다/)
})

test('로컬 격리시험은 002 부재·충돌·backfill·정확한 003 상태를 재현한다', () => {
  assert.match(integrationScript, /postgres:17\.6/)
  assert.match(integrationScript, /missing002/)
  assert.match(integrationScript, /wrongTargetFunction/)
  assert.match(integrationScript, /wrongTargetTrigger/)
  assert.match(integrationScript, /backfillImpact/)
  assert.match(integrationScript, /invalidPayload/)
  assert.match(integrationScript, /exactTargets/)
  assert.equal(
    JSON.parse(packageJson).scripts['test:db-summary-preflight'],
    'node scripts/verifyRoundSummaryPreflight.mjs',
  )
})
