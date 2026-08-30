import test from 'node:test'
import assert from 'node:assert/strict'
import { clearRoundHoleDrafts, latestHoleDraft, removeRoundHoleDraft, upsertRoundHoleDraft } from '../src/lib/roundDrafts.js'

test('홀 초안은 라운드 원본에 넣어 서버 동기화할 수 있다', () => {
  const round = { id: 'round-1', draftHoles: {} }
  const next = upsertRoundHoleDraft(round, { holeNumber: 3, distance: '120' }, '2026-08-30T10:00:00.000Z')
  assert.equal(next.draftHoles[3].distance, '120')
  assert.equal(next.updatedAt, '2026-08-30T10:00:00.000Z')
})

test('같은 홀의 기기 초안과 서버 초안 중 최근 입력을 복원한다', () => {
  const local = { holeNumber: 2, club: '7아이언', draftUpdatedAt: '2026-08-30T09:00:00.000Z' }
  const remote = { holeNumber: 2, club: '6아이언', draftUpdatedAt: '2026-08-30T09:01:00.000Z' }
  assert.equal(latestHoleDraft(local, remote).club, '6아이언')
  assert.equal(latestHoleDraft(remote, local).club, '6아이언')
})

test('홀 저장과 라운드 완료 시 동기화 초안을 제거한다', () => {
  const round = { id: 'round-1', draftHoles: { 1: { holeNumber: 1 }, 2: { holeNumber: 2 } } }
  assert.deepEqual(Object.keys(removeRoundHoleDraft(round, 1, '2026-08-30T10:00:00.000Z').draftHoles), ['2'])
  assert.deepEqual(clearRoundHoleDrafts(round, '2026-08-30T10:00:00.000Z').draftHoles, {})
})
