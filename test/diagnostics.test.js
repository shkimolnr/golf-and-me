import test from 'node:test'
import assert from 'node:assert/strict'
import {
  diagnosticCategories,
  diagnosticStages,
  recordDiagnosticFailure,
  resetDiagnosticsForTest,
  resolveDiagnosticFailure,
  resolveDiagnosticFailures,
} from '../src/lib/diagnostics.js'

test('운영 오류 진단은 허용한 단계와 분류만 기록한다', () => {
  for (const stage of ['oauth', 'profile_load', 'rounds_load', 'rounds_delete', 'club_bag_save', 'account_delete', 'api_call']) {
    assert.ok(diagnosticStages.includes(stage))
  }
  assert.deepEqual(diagnosticCategories, ['offline', 'auth', 'timeout', 'server', 'query', 'network', 'storage', 'unknown'])
})

test('같은 오류는 최신 시각과 누적 횟수만 갱신한다', () => {
  resetDiagnosticsForTest()
  const first = recordDiagnosticFailure({ stage: 'rounds_load', error: new Error('Failed to fetch'), now: '2026-08-31T00:00:00.000Z', incidentId: '00000000-0000-4000-8000-000000000001' })
  const repeated = recordDiagnosticFailure({ stage: 'rounds_load', error: new Error('Failed to fetch'), now: '2026-08-31T00:01:00.000Z' })
  assert.equal(first.isNew, true)
  assert.equal(repeated.isNew, false)
  assert.equal(repeated.record.incidentId, first.record.incidentId)
  assert.equal(repeated.record.occurrenceCount, 2)
  assert.equal(repeated.record.lastOccurredAt, '2026-08-31T00:01:00.000Z')
})

test('복구 기록에는 원본 오류 대신 분류·횟수·지속 시간만 남긴다', () => {
  resetDiagnosticsForTest()
  recordDiagnosticFailure({ stage: 'club_bag_save', error: { status: 504 }, now: '2026-08-31T00:00:00.000Z', incidentId: '00000000-0000-4000-8000-000000000002' })
  const recovered = resolveDiagnosticFailure('club_bag_save', '2026-08-31T00:00:05.000Z')
  assert.equal(recovered.category, 'timeout')
  assert.equal(recovered.occurrenceCount, 1)
  assert.equal(recovered.durationMs, 5000)
  assert.equal('message' in recovered, false)
})

test('한 단계에서 서로 다른 안전 분류의 incident는 각각 복구한다', () => {
  resetDiagnosticsForTest()
  recordDiagnosticFailure({ stage: 'rounds_save', error: { status: 503 }, now: '2026-08-31T00:00:00.000Z', incidentId: '00000000-0000-4000-8000-000000000003' })
  recordDiagnosticFailure({ stage: 'rounds_save', error: new Error('Failed to fetch'), now: '2026-08-31T00:00:01.000Z', incidentId: '00000000-0000-4000-8000-000000000004' })
  const recovered = resolveDiagnosticFailures('rounds_save', '2026-08-31T00:00:02.000Z')
  assert.equal(recovered.length, 2)
  assert.deepEqual(recovered.map(record => record.category).sort(), ['network', 'server'])
  assert.equal(resolveDiagnosticFailure('rounds_save'), null)
})
