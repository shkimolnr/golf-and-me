import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const verification = await readFile(
  new URL('../supabase/verification/202609010002_derived_data_integrity_post_apply.sql', import.meta.url),
  'utf8',
)

function executableSql(sql) {
  return sql.replace(/--.*$/gm, '').replace(/'(?:''|[^'])*'/g, "''")
}

test('002 post-check는 READ ONLY이며 행 값 대신 catalog와 집계만 반환한다', () => {
  const executable = executableSql(verification)
  assert.match(executable, /begin transaction read only/i)
  assert.doesNotMatch(executable, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|copy)\b/i)
  assert.match(verification, /entityCounts/)
  assert.match(verification, /dataIntegrityCounts/)
})

test('002 post-check는 무결성·권한·함수·trigger·005 회귀를 한 번에 판정한다', () => {
  for (const evidence of [
    'round_holes_round_user_fkey',
    'round_shots_round_hole_user_fkey',
    'club_distance_history_club_user_fkey',
    'forbidden_child_dml_count',
    'sync_round_children_from_payload',
    'rounds_sync_children',
    'round_tombstone_overlap',
    'round_hole_field_mismatch',
    'round_shot_field_mismatch',
  ]) assert.match(verification, new RegExp(evidence))
})
