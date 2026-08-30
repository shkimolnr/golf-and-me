import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateCumulativeStats, calculateRoundStats, formatPercent } from '../src/lib/roundStats.js'

test('라운드 결과는 점수·전후반·퍼팅·벌타를 집계한다', () => {
  const stats = calculateRoundStats({ holes: [
    { holeNumber: 1, par: 4, score: 5, putts: 2, officialPutts: 2, penaltyStrokes: 1, fir: false, gir: false },
    { holeNumber: 2, par: 3, score: 3, putts: 1, officialPutts: 1, penaltyStrokes: 0, fir: null, gir: true },
    { holeNumber: 10, par: 5, score: 4, putts: 1, officialPutts: 1, penaltyStrokes: 0, fir: true, gir: true },
  ] })
  assert.deepEqual(stats, {
    enteredHoles: 3, parRecordedHoles: 3, missingParHoles: 0, totalScore: 12, totalPar: 12, toPar: 0,
    frontScore: 12, backScore: 0, frontToPar: 0, backToPar: null,
    parCount: 1, bogeyCount: 1, doubleBogeyCount: 0, triplePlusCount: 0,
    scoreOutcomes: [
      { key: '0', value: 0, label: '파', count: 1 },
      { key: '1', value: 1, label: '보기', count: 1 },
      { key: '-1', value: -1, label: '버디', count: 1 },
    ].sort((a, b) => a.value - b.value),
    holeInOneCount: 0,
    totalPutts: 4, puttAttempts: 3, averagePutts: 4 / 3, onePuttCount: 2, twoPuttCount: 1, threePlusPuttCount: 0,
    penaltyStrokes: 1, obCount: 0, penaltyCount: 0,
    firHits: 1, firAttempts: 2, girHits: 2, girAttempts: 3,
  })
})

test('플레이 요약은 OB·패널티 발생 수와 퍼팅 분포를 분리한다', () => {
  const stats = calculateRoundStats({ holes: [
    { holeNumber: 1, par: 4, score: 5, officialPutts: 1, obCount: 1, penaltyCount: 0, penaltyStrokes: 1 },
    { holeNumber: 2, par: 4, score: 6, officialPutts: 2, obCount: 0, penaltyCount: 1, penaltyStrokes: 1 },
    { holeNumber: 3, par: 4, score: 7, officialPutts: 3, obCount: 1, penaltyCount: 0, penaltyStrokes: 2 },
    { holeNumber: 4, par: 4, score: 8, officialPutts: 4, obCount: 0, penaltyCount: 2, penaltyStrokes: 2 },
  ] })
  assert.equal(stats.obCount, 2)
  assert.equal(stats.penaltyCount, 3)
  assert.equal(stats.penaltyStrokes, 6)
  assert.equal(stats.onePuttCount, 1)
  assert.equal(stats.twoPuttCount, 1)
  assert.equal(stats.threePlusPuttCount, 2)
})

test('스코어 분포는 발생한 결과만 좋은 순서로 만들고 홀인원을 별도 집계한다', () => {
  const stats = calculateRoundStats({ holes: [
    { holeNumber: 1, par: 5, score: 1 },
    { holeNumber: 2, par: 5, score: 2 },
    { holeNumber: 3, par: 4, score: 2 },
    { holeNumber: 4, par: 4, score: 3 },
    { holeNumber: 5, par: 4, score: 4 },
    { holeNumber: 6, par: 4, score: 5 },
    { holeNumber: 7, par: 4, score: 6 },
    { holeNumber: 8, par: 4, score: 7 },
  ] })
  assert.deepEqual(stats.scoreOutcomes.map(({ label, count }) => ({ label, count })), [
    { label: '-4', count: 1 },
    { label: '알바트로스', count: 1 },
    { label: '이글', count: 1 },
    { label: '버디', count: 1 },
    { label: '파', count: 1 },
    { label: '보기', count: 1 },
    { label: '더블', count: 1 },
    { label: '트리플+', count: 1 },
  ])
  assert.equal(stats.holeInOneCount, 1)
})

test('전후반은 공식 홀번호가 아니라 플레이 순서의 앞뒤 9홀로 나눈다', () => {
  const stats = calculateRoundStats({ holes: [
    ...Array.from({ length: 9 }, (_, index) => ({ holeNumber: index + 10, par: 4, score: 5 })),
    ...Array.from({ length: 9 }, (_, index) => ({ holeNumber: index + 1, par: 4, score: 4 })),
  ] })
  assert.equal(stats.frontScore, 45)
  assert.equal(stats.frontToPar, 9)
  assert.equal(stats.backScore, 36)
  assert.equal(stats.backToPar, 0)
  assert.equal(stats.bogeyCount, 9)
  assert.equal(stats.parCount, 9)
})

test('FIR은 파3와 미확정 값을 분모에서 제외한다', () => {
  const stats = calculateRoundStats({ holes: [
    { holeNumber: 1, par: 3, score: 3, fir: true },
    { holeNumber: 2, par: 4, score: 4, fir: true },
    { holeNumber: 3, par: 5, score: 5 },
  ] })
  assert.equal(stats.firHits, 1)
  assert.equal(stats.firAttempts, 1)
  assert.equal(formatPercent(stats.firHits, stats.firAttempts), '100%')
})

test('GIR과 퍼팅은 실제 값이 있는 홀만 분모에 포함한다', () => {
  const stats = calculateRoundStats({ holes: [
    { holeNumber: 1, par: 4, score: 4, gir: true, officialPutts: 2 },
    { holeNumber: 2, par: 3, score: 3 },
    { holeNumber: 3, par: 5, score: 6, gir: false, putts: 3 },
  ] })

  assert.equal(stats.girHits, 1)
  assert.equal(stats.girAttempts, 2)
  assert.equal(stats.puttAttempts, 2)
  assert.equal(stats.totalPutts, 5)
  assert.equal(stats.averagePutts, 2.5)
})

test('PAR가 없는 홀의 타수는 총 타수에는 포함하되 파 대비에서는 제외한다', () => {
  const stats = calculateRoundStats({ holes: [
    { holeNumber: 1, par: 4, score: 5 },
    { holeNumber: 2, par: null, score: 9 },
    { holeNumber: 3, par: 3, score: 2 },
  ] })

  assert.equal(stats.totalScore, 16)
  assert.equal(stats.parRecordedHoles, 2)
  assert.equal(stats.missingParHoles, 1)
  assert.equal(stats.totalPar, 7)
  assert.equal(stats.toPar, 0)
  assert.deepEqual(stats.scoreOutcomes.map(item => item.label), ['버디', '보기'])
})

test('퍼팅 기록이 전혀 없으면 평균과 분포의 분모가 0이다', () => {
  const stats = calculateRoundStats({ holes: [{ holeNumber: 1, par: 4, score: 4 }] })

  assert.equal(stats.puttAttempts, 0)
  assert.equal(stats.totalPutts, 0)
  assert.equal(stats.averagePutts, null)
})

test('홈 누적 통계는 완료한 라운드만 집계한다', () => {
  const stats = calculateCumulativeStats([
    { status: 'completed', holes: [
      { par: 4, score: 4, fir: true, gir: true, officialPutts: 1 },
      { par: 3, score: 3, fir: true, gir: false, officialPutts: 2 },
    ] },
    { status: 'completed', holes: [
      { par: 4, score: 5, fir: false, gir: false, officialPutts: 3 },
      { par: 5, score: 6, fir: true, gir: true },
    ] },
    { status: 'in_progress', holes: [
      { par: 4, score: 20, fir: false, gir: false, officialPutts: 9 },
    ] },
  ])

  assert.equal(stats.roundCount, 2)
  assert.equal(stats.averageScore, 9)
  assert.equal(stats.bestScore, 7)
  assert.equal(stats.firHits, 2)
  assert.equal(stats.firAttempts, 3)
  assert.equal(stats.girHits, 2)
  assert.equal(stats.girAttempts, 4)
  assert.equal(stats.averagePutts, 2)
})

test('누적 비율은 라운드별 비율의 평균이 아니라 전체 성공과 기회를 합산한다', () => {
  const stats = calculateCumulativeStats([
    { status: 'completed', holes: [{ par: 4, score: 4, fir: true, gir: true, officialPutts: 1 }] },
    { status: 'completed', holes: [
      { par: 4, score: 4, fir: false, gir: false, officialPutts: 2 },
      { par: 4, score: 4, fir: false, gir: false, officialPutts: 3 },
      { par: 4, score: 4, fir: false, gir: false },
    ] },
  ])

  assert.equal(formatPercent(stats.firHits, stats.firAttempts), '25%')
  assert.equal(formatPercent(stats.girHits, stats.girAttempts), '25%')
  assert.equal(stats.averagePutts, 2)
})

test('완료 기록이 없으면 누적 평균과 베스트는 계산하지 않는다', () => {
  const stats = calculateCumulativeStats([{ status: 'in_progress', holes: [] }])

  assert.equal(stats.roundCount, 0)
  assert.equal(stats.averageScore, null)
  assert.equal(stats.bestScore, null)
  assert.equal(stats.averagePutts, null)
})
