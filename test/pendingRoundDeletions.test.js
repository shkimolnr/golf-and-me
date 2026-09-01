import test from 'node:test'
import assert from 'node:assert/strict'
import { clearDeletedRoundLocalArtifacts, excludePendingRoundDeletions, loadObservedRoundTombstones, loadPendingRoundDeletions, mergeObservedRoundTombstones, roundDeletionIds, saveObservedRoundTombstones, savePendingRoundDeletions } from '../src/lib/pendingRoundDeletions.js'

function memoryStorage() {
  const values = new Map()
  return {
    get length() { return values.size },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
}

test('서버 삭제가 끝나기 전에도 삭제한 라운드는 다시 나타나지 않는다', () => {
  const storage = memoryStorage()
  savePendingRoundDeletions(storage, 'user-1', ['round-2', 'round-2'])
  const pending = loadPendingRoundDeletions(storage, 'user-1')
  assert.deepEqual(pending, ['round-2'])
  assert.deepEqual(excludePendingRoundDeletions([{ id: 'round-1' }, { id: 'round-2' }], pending), [{ id: 'round-1' }])
})

test('서버 tombstone은 최신 삭제 시각으로 병합하고 기기에 지속한다', () => {
  const storage = memoryStorage()
  const merged = mergeObservedRoundTombstones(
    [{ id: 'round-1', deletedAt: '2026-09-01T01:00:00.000Z' }],
    [
      { round_id: 'round-1', deleted_at: '2026-09-01T02:00:00.000Z' },
      { round_id: 'round-2', deleted_at: '2026-09-01T01:30:00.000Z' },
    ],
  )
  saveObservedRoundTombstones(storage, 'user-1', merged)
  assert.deepEqual(loadObservedRoundTombstones(storage, 'user-1'), [
    { id: 'round-1', deletedAt: '2026-09-01T02:00:00.000Z' },
    { id: 'round-2', deletedAt: '2026-09-01T01:30:00.000Z' },
  ])
  assert.deepEqual(roundDeletionIds(['round-3'], merged), ['round-3', 'round-1', 'round-2'])
})

test('관측한 삭제 ID는 홀 draft와 복귀 화면에서도 제거한다', () => {
  const storage = memoryStorage()
  storage.setItem('golf-and-me:hole-draft:user-1:deleted:1', '{}')
  storage.setItem('golf-and-me:hole-draft:user-1:kept:1', '{}')
  storage.setItem('golf-and-me:navigation:user-1', JSON.stringify({ screen: 'scorecard', roundId: 'deleted' }))
  const removed = clearDeletedRoundLocalArtifacts(storage, 'user-1', ['deleted'])
  assert.deepEqual(removed, ['golf-and-me:hole-draft:user-1:deleted:1'])
  assert.equal(storage.getItem('golf-and-me:hole-draft:user-1:deleted:1'), null)
  assert.notEqual(storage.getItem('golf-and-me:hole-draft:user-1:kept:1'), null)
  assert.equal(JSON.parse(storage.getItem('golf-and-me:navigation:user-1')).screen, 'home')
})

test('서버 삭제 완료 후 대기 목록을 비운다', () => {
  const storage = memoryStorage()
  savePendingRoundDeletions(storage, 'user-1', ['round-1'])
  savePendingRoundDeletions(storage, 'user-1', [])
  assert.deepEqual(loadPendingRoundDeletions(storage, 'user-1'), [])
})
