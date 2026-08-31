import test from 'node:test'
import assert from 'node:assert/strict'
import { diagnosticStages, recordDiagnosticFailure, resetDiagnosticsForTest, resolveDiagnosticFailure } from '../src/lib/diagnostics.js'

test('MVP 오류 진단은 합의한 7개 단계만 기록한다', () => {
  assert.deepEqual(diagnosticStages, ['oauth', 'profile_load', 'rounds_load', 'club_bag_load', 'rounds_save', 'club_bag_save', 'account_delete'])
})

test('같은 오류는 최신 시각과 누적 횟수만 갱신한다', () => {
  resetDiagnosticsForTest()
  const first = recordDiagnosticFailure({ stage: 'rounds_load', error: new Error('Failed to fetch'), now: '2026-08-31T00:00:00.000Z' })
  const repeated = recordDiagnosticFailure({ stage: 'rounds_load', error: new Error('Failed to fetch'), now: '2026-08-31T00:01:00.000Z' })
  assert.equal(first.isNew, true)
  assert.equal(repeated.isNew, false)
  assert.equal(repeated.record.occurrenceCount, 2)
  assert.equal(repeated.record.lastOccurredAt, '2026-08-31T00:01:00.000Z')
})

test('복구 기록에는 원본 오류 대신 분류·횟수·지속 시간만 남긴다', () => {
  resetDiagnosticsForTest()
  recordDiagnosticFailure({ stage: 'club_bag_save', error: { status: 504 }, now: '2026-08-31T00:00:00.000Z' })
  const recovered = resolveDiagnosticFailure('club_bag_save', '2026-08-31T00:00:05.000Z')
  assert.equal(recovered.category, 'timeout')
  assert.equal(recovered.occurrenceCount, 1)
  assert.equal(recovered.durationMs, 5000)
  assert.equal('message' in recovered, false)
})
