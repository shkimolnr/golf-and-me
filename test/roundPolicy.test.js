import test from 'node:test'
import assert from 'node:assert/strict'
import { isRoundStructureLocked, needsRoundStructureChoice } from '../src/lib/roundPolicy.js'

const holes = Array.from({ length: 18 }, (_, index) => ({ holeNumber: index + 1, score: null }))

test('세 번째 플레이 홀까지는 라운드 구조 변경을 허용한다', () => {
  const round = { status: 'in_progress', holes: holes.map((hole, index) => index < 3 ? { ...hole, score: 4 } : hole) }
  assert.equal(isRoundStructureLocked(round), false)
  assert.equal(needsRoundStructureChoice(true, true, false), true)
})

test('네 번째 플레이 홀의 저장 또는 초안이 시작되면 구조를 잠근다', () => {
  const saved = { status: 'in_progress', holes: holes.map((hole, index) => index === 3 ? { ...hole, score: 5 } : hole) }
  assert.equal(isRoundStructureLocked(saved), true)
  assert.equal(isRoundStructureLocked({ status: 'in_progress', holes }, [4]), true)
})

test('완료한 라운드는 기록 수와 무관하게 구조를 잠근다', () => {
  assert.equal(isRoundStructureLocked({ status: 'completed', holes }), true)
})
