import test from 'node:test'
import assert from 'node:assert/strict'
import { compareClubOrder, createDistanceSet, distanceFromMeters, distanceToMeters, pairClubsForColumnLayout } from '../src/lib/clubBag.js'

const clubs = [
  { id: 'D', category: '드라이버·우드', label: 'D' },
  { id: '7I', category: '아이언', label: '7I' },
  { id: 'PT', category: '퍼터', label: 'PT' },
]

test('일부 클럽만 변경해도 같은 기준의 이전 비거리를 이어받아 완전한 세트를 만든다', () => {
  const previousSet = { basis: 'carry', unit: 'M', distances: { D: 180, '7I': 105 } }
  const result = createDistanceSet({ clubs, inputs: { D: '', '7I': '110' }, previousSet, basis: 'carry', unit: 'M', id: 'set-2', recordedAt: '2026-08-30T10:00:00.000Z' })
  assert.deepEqual(result.distances, { D: 180, '7I': 110 })
  assert.deepEqual(result.changedClubIds, ['7I'])
  assert.equal(result.clubs.some(club => club.category === '퍼터'), false)
})

test('거리 기준이 바뀌면 이전 값을 섞지 않고 빈 값을 결측으로 보존한다', () => {
  const previousSet = { basis: 'carry', unit: 'M', distances: { D: 180, '7I': 105 } }
  const result = createDistanceSet({ clubs, inputs: { D: '195', '7I': '' }, previousSet, basis: 'total', unit: 'M' })
  assert.deepEqual(result.distances, { D: 195, '7I': null })
})

test('단위가 바뀌면 같은 거리 기준의 이전 값을 환산해 이어받는다', () => {
  const previousSet = { basis: null, unit: 'M', distances: { D: 180, '7I': 105 } }
  const result = createDistanceSet({ clubs, inputs: { D: '', '7I': '120' }, previousSet, basis: null, unit: 'YD' })
  assert.deepEqual(result.distances, { D: 197, '7I': 120 })
})

test('단위를 여러 번 바꿔도 정규화한 미터 값에는 반올림 오차가 누적되지 않는다', () => {
  const normalized = distanceToMeters(140, 'M')
  assert.equal(distanceFromMeters(normalized, 'YD'), 153)
  assert.equal(distanceFromMeters(normalized, 'M'), 140)
})

test('변경한 비거리가 하나도 없으면 새 세트를 만들지 않는다', () => {
  assert.equal(createDistanceSet({ clubs, inputs: {}, basis: null, unit: 'M' }), null)
})

test('클럽은 선택 순서와 무관하게 드라이버·우드·유틸·아이언·웨지 순으로 표시한다', () => {
  const shuffled = [
    { category: '웨지', value: '56', label: '56' },
    { category: '아이언', value: '7', label: '7I' },
    { category: '드라이버·우드', value: '5', label: '5W' },
    { category: '유틸리티', value: '4', label: '4UT' },
    { category: '웨지', value: 'P', label: 'P' },
    { category: '드라이버·우드', value: '1', label: 'D' },
    { category: '드라이버·우드', value: '3', label: '3W' },
    { category: '아이언', value: '5', label: '5I' },
  ]
  assert.deepEqual(shuffled.sort(compareClubOrder).map(club => club.label), ['D', '3W', '5W', '4UT', '5I', '7I', 'P', '56'])
})

test('비거리 표는 왼쪽 열 위에서 아래로 읽은 뒤 오른쪽 열로 이어진다', () => {
  const shuffled = [
    { id: '웨지:56', category: '웨지', value: '56', label: '56' },
    { id: '아이언:7', category: '아이언', value: '7', label: '7I' },
    { id: '드라이버·우드:1', category: '드라이버·우드', value: '1', label: 'D' },
    { id: '유틸리티:4', category: '유틸리티', value: '4', label: '4UT' },
    { id: '드라이버·우드:3', category: '드라이버·우드', value: '3', label: '3W' },
    { id: '웨지:P', category: '웨지', value: 'P', label: 'P' },
  ]

  const pairs = pairClubsForColumnLayout(shuffled)
  assert.deepEqual(pairs.map(pair => pair[0]?.label), ['D', '3W', '4UT'])
  assert.deepEqual(pairs.map(pair => pair[1]?.label), ['7I', 'P', '56'])
})
