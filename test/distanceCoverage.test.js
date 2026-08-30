import test from 'node:test'
import assert from 'node:assert/strict'
import { getRoundDistanceCoverage, holeNeedsManualDistance } from '../src/lib/distanceCoverage.js'

function linkedRound(holes, overrides = {}) {
  return { courseId: 'sample-course', tee: '레드', distanceUnit: 'M', holes, ...overrides }
}

test('연동되지 않은 수동 라운드는 거리 정보 경고 대상이 아니다', () => {
  const coverage = getRoundDistanceCoverage({ holes: [{ distance: null }] })
  assert.deepEqual(coverage, { linked: false, totalHoles: 1, sourceMissingHoles: 0, unresolvedMissingHoles: 0 })
})

test('골프장 원본에 없는 선택 티 거리는 미해결 거리로 집계한다', () => {
  const coverage = getRoundDistanceCoverage(linkedRound([
    { distance: 0, sourceDistanceMeters: null },
    { distance: 310, sourceDistanceMeters: 310 },
    { distance: 0, sourceDistanceMeters: null },
  ]))
  assert.equal(coverage.sourceMissingHoles, 2)
  assert.equal(coverage.unresolvedMissingHoles, 2)
})

test('원본에 없던 거리를 사용자가 직접 입력하면 완료 경고에서 제외한다', () => {
  const coverage = getRoundDistanceCoverage(linkedRound([
    { distance: '245', distanceSource: 'user', sourceDistanceMeters: null },
    { distance: 0, distanceSource: 'course_database', sourceDistanceMeters: null },
  ]))
  assert.equal(coverage.sourceMissingHoles, 2)
  assert.equal(coverage.unresolvedMissingHoles, 1)
  assert.equal(holeNeedsManualDistance(linkedRound([]), { distance: 0, sourceDistanceMeters: null }), true)
  assert.equal(holeNeedsManualDistance(linkedRound([]), { distance: '245', sourceDistanceMeters: null }), false)
})

test('선택 단위가 YD이면 야드 원본의 누락 여부를 사용한다', () => {
  const coverage = getRoundDistanceCoverage(linkedRound([
    { distance: 330, sourceDistanceMeters: null, sourceDistanceYards: 330 },
  ], { distanceUnit: 'YD' }))
  assert.equal(coverage.sourceMissingHoles, 0)
  assert.equal(coverage.unresolvedMissingHoles, 0)
})
