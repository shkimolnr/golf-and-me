import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createRemoteRoundVersionMap,
  deserializeRemoteRoundSummary,
  loadRemoteRoundDetail,
  loadRemoteRounds,
  markRoundsAsRemoteSaved,
  mergeRoundCollections,
  resolveOnboardingProfile,
  saveRemoteRounds,
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
  assert.equal(row.entered_holes, 0)
  assert.equal(row.total_score, null)
  assert.deepEqual(row.stats_summary.scoreOutcomes, [])
})

test('서버 행은 홈 조회용 라운드 요약값을 원본과 함께 저장한다', () => {
  const row = serializeRoundRow('user-1', {
    id: 'round-summary', courseName: '테스트', frontCourseName: 'OUT', backCourseName: 'IN',
    tee: '화이트', distanceUnit: 'M', status: 'completed', updatedAt: '2026-08-30T10:00:00.000Z',
    holes: [
      { holeNumber: 1, par: 4, score: 5, officialPutts: 2, fir: false, gir: false },
      { holeNumber: 2, par: 3, score: 3, officialPutts: 1, fir: null, gir: true },
    ],
  })

  assert.equal(row.entered_holes, 2)
  assert.equal(row.par_recorded_holes, 2)
  assert.equal(row.total_score, 8)
  assert.equal(row.score_to_par, 1)
  assert.equal(row.total_putts, 3)
  assert.equal(row.putt_attempts, 2)
  assert.equal(row.fir_hits, 0)
  assert.equal(row.fir_attempts, 1)
  assert.equal(row.gir_hits, 1)
  assert.equal(row.gir_attempts, 2)
})

test('완료 라운드 요약 행은 상세 payload 없이 홈 표시 모델로 복원한다', () => {
  const summary = deserializeRemoteRoundSummary({
    id: 'summary-1', course_name: '레이크사이드', front_course_name: 'OUT', back_course_name: 'IN',
    tee: '레드', distance_unit: 'M', played_at_local: '2026-08-30T07:00', status: 'completed',
    updated_at: '2026-08-30T12:00:00.000Z', entered_holes: 18, par_recorded_holes: 18,
    total_score: 85, score_to_par: 13, total_putts: 34, putt_attempts: 18,
    fir_hits: 8, fir_attempts: 14, gir_hits: 7, gir_attempts: 18,
  })

  assert.equal(summary.remoteSummaryOnly, true)
  assert.deepEqual(summary.holes, [])
  assert.equal(summary.statsSummary.totalScore, 85)
  assert.equal(summary.statsSummary.toPar, 13)
  assert.equal(summary.statsSummary.firAttempts, 14)
})

function queryResult(result, selections) {
  return {
    select(columns) { selections.push(columns); return this },
    eq() { return this },
    order() { return Promise.resolve(result) },
    maybeSingle() { return Promise.resolve(result) },
  }
}

test('첫 원격 조회는 작성 중 원본과 완료 요약을 분리해 가져온다', async () => {
  const selections = []
  const results = [
    { data: [{ payload: { id: 'draft', status: 'in_progress', updatedAt: '2026-08-30T01:00:00.000Z' } }], error: null },
    { data: [{
      id: 'complete', status: 'completed', course_name: '테스트', updated_at: '2026-08-30T02:00:00.000Z',
      entered_holes: 18, total_score: 85,
    }], error: null },
  ]
  const client = { from() { return queryResult(results.shift(), selections) } }

  const rounds = await loadRemoteRounds(client, 'user-1')
  assert.equal(selections[0], 'payload')
  assert.equal(selections[1].includes('stats_summary'), true)
  assert.equal(selections[1].includes('payload'), false)
  assert.equal(rounds[0].id, 'draft')
  assert.equal(rounds[1].remoteSummaryOnly, true)
})

test('완료 요약을 연 뒤에는 해당 라운드 payload 한 건만 가져온다', async () => {
  const selections = []
  const detail = { id: 'complete', status: 'completed', holes: [{ holeNumber: 1, score: 4 }] }
  const client = { from() { return queryResult({ data: { payload: detail }, error: null }, selections) } }

  const round = await loadRemoteRoundDetail(client, 'user-1', 'complete')
  assert.equal(selections[0], 'payload')
  assert.equal(round, detail)
})

test('요약 컬럼 마이그레이션 전 서버에도 기존 라운드 형식으로 저장한다', async () => {
  const savedRows = []
  const client = {
    from() {
      return {
        async upsert(rows) {
          savedRows.push(rows)
          return { error: savedRows.length === 1 ? { code: 'PGRST204' } : null }
        },
      }
    },
  }

  await saveRemoteRounds(client, 'user-1', [{
    id: 'legacy-compatible', courseName: '테스트', frontCourseName: 'OUT', backCourseName: 'IN',
    tee: '화이트', distanceUnit: 'M', status: 'in_progress', updatedAt: '2026-08-30T10:00:00.000Z', holes: [],
  }])

  assert.equal(savedRows.length, 2)
  assert.equal('stats_summary' in savedRows[0][0], true)
  assert.equal('stats_summary' in savedRows[1][0], false)
  assert.equal('entered_holes' in savedRows[1][0], false)
  assert.equal(savedRows[1][0].payload.id, 'legacy-compatible')
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
