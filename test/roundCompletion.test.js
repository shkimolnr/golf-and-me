import test from 'node:test'
import assert from 'node:assert/strict'
import { roundCompletionState } from '../src/lib/roundCompletion.js'

function holesWithScores(count) {
  return Array.from({ length: 18 }, (_, index) => ({
    holeNumber: index + 1,
    score: index < count ? 4 : null,
  }))
}

test('18홀을 모두 저장해야 라운드를 완료할 수 있다', () => {
  const incomplete = roundCompletionState({ holes: holesWithScores(17) })
  const complete = roundCompletionState({ holes: holesWithScores(18) })

  assert.equal(incomplete.canComplete, false)
  assert.equal(incomplete.enteredCount, 17)
  assert.deepEqual(incomplete.missingHoles.map(hole => hole.holeNumber), [18])
  assert.equal(complete.canComplete, true)
  assert.equal(complete.enteredCount, 18)
  assert.deepEqual(complete.missingHoles, [])
})

test('점수가 없는 홀은 입력 순서와 관계없이 누락 홀로 안내한다', () => {
  const holes = holesWithScores(18)
  holes[2].score = null
  holes[11].score = undefined

  const state = roundCompletionState({ holes })

  assert.equal(state.canComplete, false)
  assert.deepEqual(state.missingHoles.map(hole => hole.holeNumber), [3, 12])
})

