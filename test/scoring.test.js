import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateHoleTotals, hasIncompleteOb, terminalLieForShot, validateHoleCompletion } from '../src/lib/scoring.js'

function shot(club = '드라이버', changes = {}) {
  return { club, troubleType: null, obRelief: null, ...changes }
}

test('페널티 구역은 실제 샷에 벌타 1타를 더한다', () => {
  const result = calculateHoleTotals([
    shot('드라이버', { troubleType: 'penalty' }),
    shot('7아이언'),
    shot('PW'),
  ], 2)
  assert.equal(result.swingCount, 3)
  assert.equal(result.penaltyStrokes, 1)
  assert.equal(result.score, 6)
})

test('클럽보다 트러블을 먼저 입력해도 해당 샷과 벌타를 계산한다', () => {
  const result = calculateHoleTotals([
    shot('', { troubleDirection: 'right', troubleType: 'penalty' }),
  ], null)
  assert.equal(result.swingCount, 1)
  assert.equal(result.penaltyStrokes, 1)
  assert.equal(result.score, 2)
})

test('OB 재샷은 실제 재샷과 벌타 1타를 계산한다', () => {
  const shots = [
    shot('드라이버', { troubleType: 'ob', obRelief: 'replay' }),
    shot('드라이버'),
    shot('PW'),
  ]
  const result = calculateHoleTotals(shots, 2)
  assert.equal(result.penaltyStrokes, 1)
  assert.equal(result.score, 6)
  assert.equal(hasIncompleteOb(shots), false)
})

test('OB 전진 구제는 벌타 2타를 계산한다', () => {
  const shots = [
    shot('드라이버', { troubleType: 'ob', obRelief: 'forward' }),
    shot('PW'),
  ]
  const result = calculateHoleTotals(shots, 2)
  assert.equal(result.penaltyStrokes, 2)
  assert.equal(result.score, 6)
  assert.equal(hasIncompleteOb(shots), false)
})

test('OB 처리 방법이 없거나 재샷 행이 비어 있으면 완료되지 않는다', () => {
  assert.equal(hasIncompleteOb([shot('드라이버', { troubleType: 'ob' })]), true)
  assert.equal(hasIncompleteOb([
    shot('드라이버', { troubleType: 'ob', obRelief: 'replay' }),
    shot(''),
  ]), true)
})

test('복수 페널티의 벌타를 모두 합산하고 미입력 행은 제외한다', () => {
  const result = calculateHoleTotals([
    shot('드라이버', { troubleType: 'penalty' }),
    shot('7아이언', { troubleType: 'ob', obRelief: 'forward' }),
    shot(''),
  ], 2)
  assert.equal(result.swingCount, 2)
  assert.equal(result.penaltyStrokes, 3)
  assert.equal(result.score, 7)
})

test('기존 hazard 데이터도 페널티 1타로 호환한다', () => {
  const result = calculateHoleTotals([shot('드라이버', { troubleType: 'hazard' })], 2)
  assert.equal(result.penaltyStrokes, 1)
  assert.equal(result.score, 4)
})

test('퍼팅 입력 후에만 마지막 샷의 종료 위치를 판정한다', () => {
  const shots = [shot('드라이버'), shot('PW')]
  assert.equal(terminalLieForShot(shots, 1, null, 'green'), null)
  assert.equal(terminalLieForShot(shots, 1, 2, 'green'), '온 그린')
  assert.equal(terminalLieForShot(shots, 1, 2, 'fringe'), '엣지')
  assert.equal(terminalLieForShot(shots, 1, 0, 'green'), '홀인')
  assert.equal(terminalLieForShot(shots, 0, 2, 'green'), null)
})

test('홀 완료는 티샷·연속된 샷·클럽·퍼팅과 해결된 OB를 요구한다', () => {
  assert.equal(validateHoleCompletion({ par: 4, shots: [], putts: 2 }).canFinalize, false)
  assert.match(validateHoleCompletion({ par: 4, shots: [], putts: 2 }).blockingMessages[0], /티샷/)

  const sequenceGap = validateHoleCompletion({
    par: 4,
    shots: [shot('D'), shot(''), shot('7I')],
    putts: 2,
  })
  assert.equal(sequenceGap.canFinalize, false)
  assert.ok(sequenceGap.blockingMessages.some(message => message.includes('샷 순서')))

  const missingClub = validateHoleCompletion({
    par: 4,
    shots: [shot('', { troubleType: 'rough' })],
    putts: 2,
  })
  assert.equal(missingClub.canFinalize, false)
  assert.ok(missingClub.blockingMessages.some(message => message.includes('클럽')))
})

test('거리 누락은 완료를 막지 않고 분석 제외 안내만 제공한다', () => {
  const result = validateHoleCompletion({
    par: 4,
    distance: '',
    shots: [shot('D'), shot('7I', { remainingDistance: '' })],
    putts: 2,
  })
  assert.equal(result.canFinalize, true)
  assert.equal(result.score, 4)
  assert.match(result.advisoryMessages[0], /거리 미입력 샷이 2개/)
})
