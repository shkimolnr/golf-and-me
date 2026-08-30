import test from 'node:test'
import assert from 'node:assert/strict'
import { excludePendingRoundDeletions, loadPendingRoundDeletions, savePendingRoundDeletions } from '../src/lib/pendingRoundDeletions.js'

function memoryStorage() {
  const values = new Map()
  return {
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

test('서버 삭제 완료 후 대기 목록을 비운다', () => {
  const storage = memoryStorage()
  savePendingRoundDeletions(storage, 'user-1', ['round-1'])
  savePendingRoundDeletions(storage, 'user-1', [])
  assert.deepEqual(loadPendingRoundDeletions(storage, 'user-1'), [])
})
