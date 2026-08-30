import test from 'node:test'
import assert from 'node:assert/strict'
import { deserializeRemoteClubBag, mergeDistanceSets, resolveClubBag } from '../src/lib/clubBagRepository.js'

const driver = { id: '드라이버·우드:1', category: '드라이버·우드', value: '1', label: 'D', custom: false }
const iron = { id: '아이언:7', category: '아이언', value: '7', label: '7I', custom: false }

test('로컬과 서버의 비거리 세트는 삭제하지 않고 ID별로 병합한다', () => {
  const local = [{ id: 'local-set', recordedAt: '2026-08-30T10:00:00.000Z' }]
  const remote = [{ id: 'remote-set', recordedAt: '2026-08-29T10:00:00.000Z' }]
  assert.deepEqual(mergeDistanceSets(local, remote).map(set => set.id), ['local-set', 'remote-set'])
})

test('서버 클럽 구성이 더 최신이면 서버 구성을 쓰고 로컬 비거리 이력은 보존한다', () => {
  const result = resolveClubBag(
    { clubs: [driver], compositionCompleted: true, updatedAt: '2026-08-29T10:00:00.000Z', distanceSets: [{ id: 'local-set', recordedAt: '2026-08-30T10:00:00.000Z' }] },
    { clubs: [iron], compositionCompleted: true, updatedAt: '2026-08-30T11:00:00.000Z', distanceSets: [{ id: 'remote-set', recordedAt: '2026-08-28T10:00:00.000Z' }] },
  )
  assert.deepEqual(result.clubs, [iron])
  assert.deepEqual(result.distanceSets.map(set => set.id), ['local-set', 'remote-set'])
})

test('서버 행에서 현재 클럽과 날짜별 비거리 세트를 복원한다', () => {
  const result = deserializeRemoteClubBag([
    { id: 'remote-driver', client_id: driver.id, name: 'D', category: driver.category, active: true, payload: driver, updated_at: '2026-08-30T12:00:00.000Z' },
    { id: 'remote-iron', client_id: iron.id, name: '7I', category: iron.category, active: false, payload: iron, updated_at: '2026-08-30T12:00:00.000Z' },
  ], [
    { set_id: 'set-1', club_id: 'remote-driver', distance: 150, distance_unit: 'M', distance_basis: null, normalized_distance_m: 150, club_snapshot: driver, is_changed: true, recorded_at: '2026-08-30T12:00:00.000Z' },
    { set_id: 'set-1', club_id: 'remote-iron', distance: 110, distance_unit: 'M', distance_basis: null, normalized_distance_m: 110, club_snapshot: iron, is_changed: false, recorded_at: '2026-08-30T12:00:00.000Z' },
  ])
  assert.deepEqual(result.clubs, [driver])
  assert.deepEqual(result.distanceSets[0].clubs, [driver, iron])
  assert.deepEqual(result.distanceSets[0].distances, { [driver.id]: 150, [iron.id]: 110 })
  assert.deepEqual(result.distanceSets[0].changedClubIds, [driver.id])
})

