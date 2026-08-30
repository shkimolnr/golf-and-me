import test from 'node:test'
import assert from 'node:assert/strict'
import { resetNavigationForExplicitSignOut } from '../src/lib/navigationPolicy.js'

function storageMock(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
  }
}

test('명시적 로그아웃은 해당 계정의 복귀 위치만 홈으로 초기화한다', () => {
  const storage = storageMock({
    'golf-and-me:navigation:user-a': JSON.stringify({ screen: 'hole-detail', roundId: 'round-1', holeNumber: 7 }),
    'golf-and-me:navigation:user-b': JSON.stringify({ screen: 'scorecard', roundId: 'round-2' }),
    'golf-and-me:rounds:user-a': '[{"id":"round-1"}]',
    'golf-and-me:hole-draft:user-a:round-1:7': '{"holeNumber":7}',
  })

  assert.equal(resetNavigationForExplicitSignOut(storage, 'user-a', '2026-08-31T12:00:00.000Z'), true)
  assert.deepEqual(JSON.parse(storage.getItem('golf-and-me:navigation:user-a')), {
    screen: 'home',
    savedAt: '2026-08-31T12:00:00.000Z',
  })
  assert.equal(JSON.parse(storage.getItem('golf-and-me:navigation:user-b')).screen, 'scorecard')
  assert.equal(storage.getItem('golf-and-me:rounds:user-a'), '[{"id":"round-1"}]')
  assert.equal(storage.getItem('golf-and-me:hole-draft:user-a:round-1:7'), '{"holeNumber":7}')
})

test('사용자 식별자가 없으면 복귀 위치를 변경하지 않는다', () => {
  const storage = storageMock()
  assert.equal(resetNavigationForExplicitSignOut(storage, null), false)
})
