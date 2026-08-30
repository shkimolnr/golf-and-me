import test from 'node:test'
import assert from 'node:assert/strict'
import { createPreviewRounds, mergePreviewRounds } from '../src/data/previewRounds.js'
import { calculateRoundStats } from '../src/lib/roundStats.js'

test('100타 테스트 라운드는 모든 결과 분류와 홀인원을 함께 포함한다', () => {
  const round = createPreviewRounds().find(item => item.id === 'preview-lakeside-high-score')
  const stats = calculateRoundStats(round)

  assert.equal(stats.totalScore, 120)
  assert.deepEqual(stats.scoreOutcomes.map(item => item.label), ['-4', '알바트로스', '이글', '버디', '파', '보기', '더블', '트리플+'])
  assert.equal(stats.holeInOneCount, 1)
})

test('일반 고득점 테스트 라운드는 100타 이상이며 버디와 트리플 이상을 포함한다', () => {
  const round = createPreviewRounds().find(item => item.id === 'preview-lakeside-balanced-high-score')
  const stats = calculateRoundStats(round)

  assert.equal(stats.totalScore, 102)
  assert.ok(stats.scoreOutcomes.some(item => item.label === '버디'))
  assert.ok(stats.scoreOutcomes.some(item => item.label === '트리플+'))
  assert.equal(stats.holeInOneCount, 0)
})

test('트리니티 수동 완료 라운드는 홀거리 절반이 없어도 클럽과 결과 통계를 온전히 유지한다', () => {
  const round = createPreviewRounds().find(item => item.id === 'preview-trinity-manual-draft')
  const stats = calculateRoundStats(round)

  assert.equal(round.courseId, null)
  assert.equal(round.courseName, '트리니티클럽')
  assert.equal(round.status, 'completed')
  assert.equal(round.holes.filter(hole => Number.isFinite(hole.score)).length, 18)
  assert.equal(round.holes.filter(hole => Number.isFinite(hole.distance)).length, 9)
  assert.equal(round.holes.filter(hole => hole.distance == null).length, 9)
  assert.ok(round.holes.every(hole => hole.parSource === 'user'))
  assert.ok(round.holes.flatMap(hole => hole.shots).every(shot => Boolean(shot.club)))
  assert.equal(stats.enteredHoles, 18)
  assert.equal(stats.totalPar, 72)
  assert.equal(stats.totalScore, 84)
  assert.equal(stats.toPar, 12)
})

test('트리니티 PAR 누락 완료 기록은 누락 홀을 파 대비와 분포에서 제외한다', () => {
  const round = createPreviewRounds().find(item => item.id === 'preview-trinity-missing-par-complete')
  const stats = calculateRoundStats(round)

  assert.equal(round.status, 'completed')
  assert.equal(round.holes.filter(hole => Number.isFinite(hole.score)).length, 18)
  assert.equal(stats.parRecordedHoles, 15)
  assert.equal(stats.missingParHoles, 3)
  assert.equal(stats.scoreOutcomes.reduce((sum, item) => sum + item.count, 0), 15)
  assert.equal(stats.totalScore, 84)
})

test('프리뷰 버전이 같아도 빠진 기본 기록은 기존 사용자 기록을 보존하며 보충한다', () => {
  const existing = [
    { id: 'user-test-round', courseName: '내 테스트 기록' },
    ...createPreviewRounds().filter(item => item.id !== 'preview-trinity-missing-par-complete'),
  ]

  const merged = mergePreviewRounds(existing)

  assert.ok(merged.some(item => item.id === 'user-test-round'))
  assert.equal(merged.filter(item => item.id === 'preview-trinity-missing-par-complete').length, 1)
  assert.equal(new Set(merged.map(item => item.id)).size, merged.length)
})
