import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [script, packageJson] = await Promise.all([
  readFile(new URL('../scripts/verifyDerivedIntegrityMigration.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
])

test('002 격리시험은 신규 재생과 현재 Production 적용 순서를 모두 검증한다', () => {
  assert.match(script, /fresh_order/)
  assert.match(script, /production_order/)
  assert.match(script, /migration002, migration004, migration005/)
  assert.match(script, /createDatabase\('production_order', \[migration004, migration005\]\)/)
  assert.match(script, /assertReadyPreflight\(runPreflight\('production_order'\)\)/)
})

test('002 격리시험은 FK·권한·payload 재생성·rollback을 실행한다', () => {
  for (const evidence of [
    'round_holes_round_user_fkey',
    'round_shots_round_hole_user_fkey',
    'club_distance_history_club_user_fkey',
    'sourceOfficialHole',
    'clubSnapshot',
    'permission denied',
    'verifyRollbackAndReapply',
    'assertPostApplyPass',
  ]) assert.match(script, new RegExp(evidence))
  assert.equal(
    JSON.parse(packageJson).scripts['test:db-integrity'],
    'node scripts/verifyDerivedIntegrityMigration.mjs',
  )
})
