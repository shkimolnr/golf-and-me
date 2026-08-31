import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createRemoteRoundVersionMap,
  deserializeRemoteRoundSummary,
  selectRoundsNeedingRemoteSave,
  serializeRoundRow,
} from '../src/lib/roundRepository.js'
import { mergeDistanceSets } from '../src/lib/clubBagRepository.js'

function completedRound(index) {
  const updatedAt = new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString()
  return {
    id: `round-${index}`,
    courseName: `골프장 ${index}`,
    frontCourseName: 'OUT',
    backCourseName: 'IN',
    tee: '화이트',
    distanceUnit: 'M',
    playedAt: `2026-08-${String((index % 28) + 1).padStart(2, '0')}T07:00`,
    status: 'completed',
    completedAt: updatedAt,
    updatedAt,
    holes: Array.from({ length: 18 }, (_, holeIndex) => ({
      holeNumber: holeIndex + 1,
      par: holeIndex % 3 === 0 ? 3 : holeIndex % 3 === 1 ? 4 : 5,
      score: 4 + (holeIndex % 3),
      officialPutts: 2,
      fir: holeIndex % 3 === 0 ? null : holeIndex % 2 === 0,
      gir: holeIndex % 2 === 0,
      shots: Array.from({ length: 4 }, (_, shotIndex) => ({
        sequence: shotIndex + 1,
        club: shotIndex === 0 ? 'D' : '7I',
        remainingDistance: Math.max(0, 400 - shotIndex * 120),
      })),
    })),
  }
}

test('250개 라운드 중 하나를 수정해도 서버 저장 대상은 그 한 건뿐이다', () => {
  const remoteRounds = Array.from({ length: 250 }, (_, index) => completedRound(index))
  const localRounds = remoteRounds.map(round => ({ ...round }))
  localRounds[137] = { ...localRounds[137], updatedAt: '2026-09-01T00:00:00.000Z' }

  const changed = selectRoundsNeedingRemoteSave(localRounds, createRemoteRoundVersionMap(remoteRounds))
  assert.deepEqual(changed.map(round => round.id), ['round-137'])
})

test('완료 라운드 요약 전송량은 전체 홀·샷 원본보다 충분히 작다', () => {
  const row = serializeRoundRow('00000000-0000-0000-0000-000000000000', completedRound(1))
  const summary = deserializeRemoteRoundSummary(row)
  const payloadBytes = Buffer.byteLength(JSON.stringify(row.payload))
  const summaryBytes = Buffer.byteLength(JSON.stringify(summary))

  assert.ok(summaryBytes < payloadBytes * 0.25, `summary=${summaryBytes}, payload=${payloadBytes}`)
})

test('60개 비거리 세트 이력은 ID별로 보존하면서 최신순으로 병합한다', () => {
  const remoteSets = Array.from({ length: 60 }, (_, index) => ({
    id: `set-${index}`,
    recordedAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
  }))
  const merged = mergeDistanceSets([], remoteSets)

  assert.equal(merged.length, 60)
  assert.equal(merged[0].id, 'set-59')
  assert.equal(merged.at(-1).id, 'set-0')
})
