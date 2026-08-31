import test from 'node:test'
import assert from 'node:assert/strict'
import { clubBagSyncSignature, deserializeRemoteClubBag, loadRemoteClubBag, mergeDistanceSets, resolveClubBag } from '../src/lib/clubBagRepository.js'

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
  assert.deepEqual(result.inactiveClubs, [iron])
  assert.deepEqual(result.distanceSets[0].clubs, [driver, iron])
  assert.deepEqual(result.distanceSets[0].distances, { [driver.id]: 150, [iron.id]: 110 })
  assert.deepEqual(result.distanceSets[0].changedClubIds, [driver.id])
})

test('활성 해제한 클럽은 ID를 유지한 비활성 목록으로 병합한다', () => {
  const customWedge = { id: 'custom-wedge', category: '웨지', value: '59', label: '59', custom: true }
  const result = resolveClubBag(
    { clubs: [driver], inactiveClubs: [customWedge], compositionCompleted: true, updatedAt: '2026-08-30T12:00:00.000Z', distanceSets: [] },
    { clubs: [driver], inactiveClubs: [], compositionCompleted: true, updatedAt: '2026-08-29T12:00:00.000Z', distanceSets: [] },
  )
  assert.deepEqual(result.clubs, [driver])
  assert.deepEqual(result.inactiveClubs, [customWedge])
})

test('골프백 동기화 서명은 구성이나 비거리 세트가 바뀔 때만 달라진다', () => {
  const base = {
    clubs: [driver], inactiveClubs: [], compositionCompleted: true,
    updatedAt: '2026-08-30T10:00:00.000Z',
    distanceSets: [{ id: 'set-1', recordedAt: '2026-08-30T10:00:00.000Z' }],
  }
  assert.equal(clubBagSyncSignature(base), clubBagSyncSignature({ ...base }))
  assert.notEqual(clubBagSyncSignature(base), clubBagSyncSignature({
    ...base,
    distanceSets: [...base.distanceSets, { id: 'set-2', recordedAt: '2026-08-31T10:00:00.000Z' }],
  }))
})

test('로그인 시 비거리 이력은 가장 최근 세트의 행만 가져온다', async () => {
  const queries = []
  let distanceQueryCount = 0
  const client = {
    from(table) {
      if (table === 'club_distance_history') distanceQueryCount += 1
      const result = table === 'user_clubs'
        ? { data: [], error: null }
        : distanceQueryCount === 1
          ? { data: [{ set_id: 'latest-set', recorded_at: '2026-08-31T10:00:00.000Z' }], error: null }
          : { data: [{
            set_id: 'latest-set', club_id: 'remote-driver', distance: 200, distance_unit: 'M',
            club_snapshot: driver, is_changed: true, recorded_at: '2026-08-31T10:00:00.000Z',
          }], error: null }
      const query = {
        table,
        select() { return this },
        eq(column, value) { queries.push([table, column, value]); return this },
        order() { return this },
        limit() { return Promise.resolve(result) },
        then(resolve) { return Promise.resolve(result).then(resolve) },
      }
      return query
    },
  }

  const bag = await loadRemoteClubBag(client, 'user-1')
  assert.equal(queries.some(([, column, value]) => column === 'set_id' && value === 'latest-set'), true)
  assert.equal(bag.distanceSets.length, 1)
  assert.equal(bag.distanceSets[0].id, 'latest-set')
})
