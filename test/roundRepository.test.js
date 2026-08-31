import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createRemoteRoundVersionMap,
  markRoundsAsRemoteSaved,
  mergeRoundCollections,
  resolveOnboardingProfile,
  selectRoundsNeedingRemoteSave,
  serializeRoundRow,
  sortRoundsForList,
} from '../src/lib/roundRepository.js'

test('같은 라운드는 가장 최근 수정본을 사용하고 양쪽의 고유 기록을 보존한다', () => {
  const local = [
    { id: 'local-only', updatedAt: '2026-08-30T01:00:00.000Z' },
    { id: 'shared', updatedAt: '2026-08-30T02:00:00.000Z', courseName: '로컬' },
  ]
  const remote = [
    { id: 'shared', updatedAt: '2026-08-30T03:00:00.000Z', courseName: '서버' },
    { id: 'remote-only', updatedAt: '2026-08-30T01:30:00.000Z' },
  ]

  const merged = mergeRoundCollections(local, remote)
  assert.deepEqual(merged.map(round => round.id), ['local-only', 'shared', 'remote-only'])
  assert.equal(merged.find(round => round.id === 'shared').courseName, '서버')
})

test('서버와 수정 시각이 다른 라운드만 저장 대상으로 고른다', () => {
  const remote = [
    { id: 'same', updatedAt: '2026-08-30T01:00:00.000Z' },
    { id: 'changed', updatedAt: '2026-08-30T01:00:00.000Z' },
  ]
  const local = [
    { id: 'same', updatedAt: '2026-08-30T01:00:00.000Z' },
    { id: 'changed', updatedAt: '2026-08-30T02:00:00.000Z' },
    { id: 'new', updatedAt: '2026-08-30T03:00:00.000Z' },
  ]

  const versions = createRemoteRoundVersionMap(remote)
  assert.deepEqual(selectRoundsNeedingRemoteSave(local, versions).map(round => round.id), ['changed', 'new'])
})

test('늦게 끝난 과거 저장 요청이 최신 동기화 시각을 되돌리지 않는다', () => {
  const latest = markRoundsAsRemoteSaved(new Map(), [{ id: 'round-1', updatedAt: '2026-08-30T03:00:00.000Z' }])
  const afterOlderRequest = markRoundsAsRemoteSaved(latest, [{ id: 'round-1', updatedAt: '2026-08-30T02:00:00.000Z' }])
  assert.equal(afterOlderRequest.get('round-1'), '2026-08-30T03:00:00.000Z')
})

test('서버 행은 검색용 필드와 전체 라운드 원본을 함께 저장한다', () => {
  const round = {
    id: 'round-1', courseId: 'lakeside', courseName: '레이크사이드 컨트리클럽',
    frontCourseName: 'IN', backCourseName: 'OUT', tee: '레드', distanceUnit: 'M',
    playedAt: '2026-08-30T07:12', status: 'completed', completedAt: '2026-08-30T10:00:00.000Z',
    updatedAt: '2026-08-30T10:00:00.000Z', holes: [],
  }

  const row = serializeRoundRow('user-1', round)
  assert.equal(row.user_id, 'user-1')
  assert.equal(row.status, 'completed')
  assert.equal(row.played_at_local, '2026-08-30T07:12')
  assert.equal(row.payload, round)
})

test('작성 중 기록은 최근 수정 순으로 모든 기기에서 동일하게 정렬한다', () => {
  const rounds = [
    { id: 'old', playedAt: '2026-08-30T08:00', updatedAt: '2026-08-30T09:00:00.000Z' },
    { id: 'new', playedAt: '2026-08-29T08:00', updatedAt: '2026-08-30T10:00:00.000Z' },
  ]
  assert.deepEqual(sortRoundsForList(rounds, 'in_progress').map(round => round.id), ['new', 'old'])
})

test('완료 기록은 수정 시점과 무관하게 라운드 날짜 최신순으로 정렬한다', () => {
  const rounds = [
    { id: 'older-play', playedAt: '2026-08-20T08:00', updatedAt: '2026-08-30T12:00:00.000Z' },
    { id: 'newer-play', playedAt: '2026-08-29T08:00', updatedAt: '2026-08-29T09:00:00.000Z' },
  ]
  assert.deepEqual(sortRoundsForList(rounds, 'completed').map(round => round.id), ['newer-play', 'older-play'])
})

test('새 기기의 기존 사용자는 서버 온보딩 프로필로 바로 진입한다', () => {
  assert.deepEqual(resolveOnboardingProfile(null, { defaultTee: '레드', onboardingCompleted: true }), {
    completed: true,
    defaultTee: '레드',
    defaultDistanceUnit: 'M',
    shouldSaveRemote: false,
  })
})

test('서버 이전 로컬 프로필은 거리 단위까지 유지하고 서버 저장 대상으로 표시한다', () => {
  assert.deepEqual(resolveOnboardingProfile({ defaultTee: '골드', defaultDistanceUnit: 'YD' }, { defaultTee: '화이트', onboardingCompleted: false }), {
    completed: true,
    defaultTee: '골드',
    defaultDistanceUnit: 'YD',
    shouldSaveRemote: true,
  })
})

test('신규 사용자는 온보딩 미완료 상태로 진입한다', () => {
  assert.deepEqual(resolveOnboardingProfile(null, { defaultTee: '화이트', onboardingCompleted: false }), {
    completed: false,
    defaultTee: '화이트',
    defaultDistanceUnit: 'M',
    shouldSaveRemote: false,
  })
})
