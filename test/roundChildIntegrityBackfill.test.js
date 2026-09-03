import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [migration, rollback, preflight, state, integration, design, assessment] = await Promise.all([
  readFile(new URL('../supabase/migrations/202609030001_round_child_integrity_backfill.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/rollbacks/202609030001_round_child_integrity_backfill_rollback.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/verification/202609030001_round_child_integrity_backfill_preflight.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/verification/202609030001_round_child_integrity_backfill_state.sql', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/verifyDerivedIntegrityMigration.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/audits/20260903_task_051_child_backfill_design.md', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/audits/20260903_task_051_candidate_assessment.md', import.meta.url), 'utf8'),
])

function executableSql(sql) {
  return sql.replace(/--.*$/gm, '').replace(/'(?:''|[^'])*'/g, "''")
}

test('backfill은 rounds 원본과 updated_at을 수정하지 않고 실제 불일치 round만 대상으로 한다', () => {
  assert.doesNotMatch(migration, /update\s+public\.rounds/i)
  assert.match(migration, /round_child_backfill_targets/)
  assert.match(migration, /actual\.official_hole_number[\s\S]+sourceOfficialHole/i)
  assert.match(migration, /rounds\.payload->'holes'/i)
  assert.match(migration, /expected\(round_id, hole_number, official_hole_number, distance\)/i)
  assert.match(migration, /join pg_temp\.round_child_backfill_targets/i)
  assert.match(migration, /for update of rounds/i)
})

test('backfill은 payload·소유권·count·tombstone prerequisite를 변경 전에 차단한다', () => {
  assert.match(migration, /pg_input_is_valid/i)
  assert.match(migration, /round_child_backfill_invalid_payload/)
  assert.match(migration, /round_child_backfill_ambiguous_payload/)
  assert.match(migration, /round_child_backfill_integrity_blocker/)
  assert.match(migration, /public\.round_tombstones/i)
  assert.match(migration, /round_hole_count_mismatch|jsonb_array_length/i)
  assert.match(migration, /pg_get_constraintdef/i)
  assert.match(migration, /pg_get_indexdef/i)
  assert.match(migration, /055b059c2c323c69234ba1ac2f526c95/i)
  assert.match(migration, /eb89388ca6e924490945b3b3cfea423f/i)
  assert.match(migration, /rounds_sync_summary/i)
})

test('backfill은 002 함수·004 권한·005 trigger 정의를 바꾸지 않는다', () => {
  assert.doesNotMatch(migration, /create\s+or\s+replace\s+function/i)
  assert.doesNotMatch(migration, /\b(grant|revoke)\b/i)
  assert.doesNotMatch(migration, /drop\s+trigger/i)
})

test('commit 전 postcondition은 target hole과 shot의 전체 002 mapping을 검사한다', () => {
  assert.match(migration, /with expected_holes as/i)
  assert.match(migration, /expected_shots as/i)
  for (const field of [
    'official_hole_number', 'swing_count', 'club_client_id', 'club_snapshot',
    'remaining_distance', 'trouble_direction', 'trouble_type', 'ob_relief',
    'payload', 'updated_at',
  ]) {
    assert.match(migration, new RegExp(field, 'i'))
  }
  assert.match(migration, /full join actual_holes/i)
  assert.match(migration, /full join actual_shots/i)
  assert.match(migration, /round_child_backfill_postcondition_failed/i)
})

test('rollback은 정합해진 파생 cache를 역변환하지 않는다', () => {
  const executable = executableSql(rollback)
  assert.doesNotMatch(executable, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/i)
  assert.match(rollback, /data rollback is intentionally a no-op/i)
})

test('backfill preflight는 READ ONLY 집계와 대상 영향량만 반환한다', () => {
  const executable = executableSql(preflight)
  assert.match(executable, /begin transaction read only/i)
  assert.doesNotMatch(executable, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|copy)\b/i)
  assert.match(preflight, /blockerCounts/)
  assert.match(preflight, /targetCounts/)
  assert.match(preflight, /officialHoleNumberHoles/)
  assert.match(preflight, /distanceHoles/)
  assert.match(preflight, /invalidPayloadCounts/)
  assert.match(preflight, /catalogChecks/)
})

test('backfill state 검증은 행 값 없이 count와 one-way fingerprint만 반환한다', () => {
  const executable = executableSql(state)
  assert.match(executable, /begin transaction read only/i)
  assert.doesNotMatch(executable, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|copy)\b/i)
  assert.match(state, /dataFingerprints/)
  assert.match(state, /runtime004RiskyPrivilegeCount/)
  assert.match(state, /fieldDistanceEvidence/)
  assert.match(state, /fullDistanceEvidence/)
})

test('PG 격리시험은 54행·부분 대상·invalid blocker·idempotency를 재현한다', () => {
  assert.match(integration, /assertBackfillReady\(database,\s*3,\s*54/)
  assert.match(integration, /current-control/)
  assert.match(integration, /controlXminBefore/)
  assert.match(integration, /verifyInvalidBackfillBlocker/)
  assert.match(integration, /verifyAmbiguousBackfillBlocker/)
  assert.match(integration, /verifyStructuralBackfillBlocker/)
  assert.match(integration, /verifyExactPrerequisiteBlockers/)
  assert.match(integration, /verifySummaryPrecedenceBlocker/)
  assert.match(integration, /integrityBoundaryFingerprint/)
  assert.match(integration, /backfill second run changes 0 targets/i)
  assert.match(integration, /verifyDistanceEvidenceBackfill/)
  assert.match(integration, /verifyPostconditionAtomicRollback/)
  assert.match(integration, /round_child_backfill_postcondition_failed/)
  assert.match(integration, /backfillStateResult/)
  assert.match(integration, /assert\.equal\(analyticsDistanceCount, 52\)/)
})

test('TASK-052와 TASK-053 후보 migration version 충돌을 재발행 규칙으로 고정한다', () => {
  assert.match(design, /202609030002_round_summary_sync\.sql/)
  assert.match(design, /202609030001_home_round_state\.sql/)
  assert.match(design, /version이\s*충돌/)
  assert.match(assessment, /202609030001_home_round_state\.sql/)
  assert.match(assessment, /202609030001_round_child_integrity_backfill\.sql/)
})
