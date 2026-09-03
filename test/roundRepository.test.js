import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPLETED_ROUNDS_PAGE_SIZE,
  createRemoteRoundVersionMap,
  deleteRemoteRound,
  deserializeRemoteRoundSummary,
  isRoundTombstonedError,
  loadRemoteCompletedRoundsPage,
  loadRemoteHomeRoundState,
  loadRemoteRoundDetail,
  loadRemoteRounds,
  loadRemoteRoundSyncState,
  markRoundsAsRemoteSaved,
  mergeRoundCollections,
  mergeRoundCollectionsWithDeletions,
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

test('삭제 표식은 로컬·원격 어느 쪽이 최신이어도 병합 결과보다 우선한다', () => {
  const local = [
    { id: 'deleted-local', updatedAt: '2026-09-01T03:00:00.000Z' },
    { id: 'keep', updatedAt: '2026-09-01T01:00:00.000Z' },
  ]
  const remote = [
    { id: 'deleted-remote', updatedAt: '2026-09-01T04:00:00.000Z' },
    { id: 'keep', updatedAt: '2026-09-01T02:00:00.000Z' },
  ]

  const merged = mergeRoundCollectionsWithDeletions(
    local,
    remote,
    ['deleted-local', 'deleted-remote'],
  )
  assert.deepEqual(merged.map(round => round.id), ['keep'])
  assert.equal(merged[0].updatedAt, '2026-09-01T02:00:00.000Z')
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
  assert.deepEqual(
    selectRoundsNeedingRemoteSave(local, versions, ['changed', 'new']).map(round => round.id),
    [],
  )
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

test('최적화된 첫 화면 조회는 최근 25건·전체 누적 통계·버전 벡터를 한 RPC로 받는다', async () => {
  const calls = []
  const client = {
    async rpc(name, parameters) {
      calls.push({ name, parameters })
      return {
        data: {
          completedRounds: [{
            id: 'complete', status: 'completed', course_name: '테스트',
            updated_at: '2026-09-03T01:00:00.000Z', entered_holes: 18,
            total_score: 84, putt_attempts: 18,
          }],
          completedTotal: 120,
          nextCursor: { playedAt: '2026-09-03T07:00', updatedAt: '2026-09-03T01:00:00.000Z', id: 'complete' },
          cumulativeStats: {
            roundCount: 120, scoredRoundCount: 119, averageScore: '88.5', bestScore: 72,
            totalPutts: 4000, puttAttempts: 2100, averagePutts: '1.9047619',
            firHits: 900, firAttempts: 1600, girHits: 800, girAttempts: 2100,
          },
          versions: [{ id: 'complete', updatedAt: '2026-09-03T01:00:00.000Z' }],
        },
        error: null,
      }
    },
  }

  const state = await loadRemoteHomeRoundState(client)
  assert.deepEqual(calls, [{
    name: 'get_home_round_state',
    parameters: { p_limit: COMPLETED_ROUNDS_PAGE_SIZE, p_cursor: null },
  }])
  assert.equal(state.completedRounds[0].remoteSummaryOnly, true)
  assert.equal(state.completedTotal, 120)
  assert.equal(state.cumulativeStats.averageScore, 88.5)
  assert.deepEqual(state.versions, [{ id: 'complete', updatedAt: '2026-09-03T01:00:00.000Z' }])
  assert.deepEqual(state.nextCursor, { playedAt: '2026-09-03T07:00', updatedAt: '2026-09-03T01:00:00.000Z', id: 'complete' })

  const cursor = { playedAt: '2026-09-03T07:00', updatedAt: '2026-09-03T01:00:00.000Z', id: 'complete' }
  const page = await loadRemoteCompletedRoundsPage(client, { limit: 10, cursor })
  assert.deepEqual(calls.at(-1), {
    name: 'get_home_round_state',
    parameters: { p_limit: 10, p_cursor: cursor },
  })
  assert.equal(page.total, 120)
  assert.equal(page.nextCursor.id, 'complete')
})

test('첫 화면 RPC가 아직 없는 DB에서는 기존 전체 조회로 안전하게 되돌아간다', async () => {
  const selections = []
  const results = [
    { data: [{ payload: { id: 'draft', status: 'in_progress' } }], error: null },
    { data: [{ round_id: 'deleted', deleted_at: '2026-09-03T01:00:00.000Z' }], error: null },
    { data: [{ payload: { id: 'draft', status: 'in_progress' } }], error: null },
    { data: [{ id: 'complete', status: 'completed', entered_holes: 18, total_score: 80 }], error: null },
  ]
  const client = {
    async rpc() { return { data: null, error: { code: 'PGRST202', message: 'function missing' } } },
    from() { return queryResult(results.shift(), selections) },
  }

  const state = await loadRemoteRoundSyncState(client, 'user-1')
  assert.equal(state.optimized, false)
  assert.deepEqual(state.rounds.map(round => round.id), ['draft', 'complete'])
  assert.equal(state.completedTotal, 1)
})

test('동기화 조회는 활성 라운드와 서버 tombstone을 분리해 반환한다', async () => {
  const selections = []
  const results = [
    { data: [{ payload: { id: 'draft', status: 'in_progress' } }], error: null },
    { data: [], error: null },
    { data: [{ round_id: 'deleted', deleted_at: '2026-09-01T01:00:00.000Z' }], error: null },
  ]
  const client = { from() { return queryResult(results.shift(), selections) } }
  const state = await loadRemoteRoundSyncState(client, 'user-1')
  assert.deepEqual(state.rounds.map(round => round.id), ['draft'])
  assert.deepEqual(state.tombstones, [{ id: 'deleted', deletedAt: '2026-09-01T01:00:00.000Z' }])
  assert.equal(selections[2], 'round_id, deleted_at')
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

test('저장 직전 삭제 ID를 다시 제외해 오래된 저장 작업의 재생성을 막는다', async () => {
  const savedRows = []
  const client = {
    from() {
      return {
        async upsert(rows) {
          savedRows.push(rows)
          return { error: null }
        },
      }
    },
  }
  const rounds = [
    { id: 'keep', status: 'in_progress', holes: [], updatedAt: '2026-09-01T01:00:00.000Z' },
    { id: 'deleted', status: 'in_progress', holes: [], updatedAt: '2026-09-01T02:00:00.000Z' },
  ]
  await saveRemoteRounds(client, 'user-1', rounds, ['deleted'])
  assert.deepEqual(savedRows[0].map(row => row.id), ['keep'])
})

test('DB tombstone guard 오류를 일반 저장 오류와 구분한다', () => {
  assert.equal(isRoundTombstonedError({ code: '23505', message: 'round_tombstoned' }), true)
  assert.equal(isRoundTombstonedError({ code: '23505', message: 'other unique key' }), false)
  assert.equal(isRoundTombstonedError({ code: '500', message: 'round_tombstoned' }), false)
})

function deleteConfirmationClient(tombstone) {
  let table = ''
  return {
    from(nextTable) {
      table = nextTable
      return {
        delete() { return this },
        select() { return this },
        eq() { return this },
        then(resolve) {
          return Promise.resolve(resolve({ error: null }))
        },
        maybeSingle() {
          return Promise.resolve({
            data: table === 'round_tombstones' && tombstone
              ? { round_id: tombstone.id, deleted_at: tombstone.deletedAt }
              : null,
            error: null,
          })
        },
      }
    },
  }
}

test('서버 삭제는 tombstone 확인 뒤에만 durable queue 성공으로 판정한다', async () => {
  const tombstone = await deleteRemoteRound(
    deleteConfirmationClient({ id: 'round-1', deletedAt: '2026-09-01T03:00:00.000Z' }),
    'user-1',
    'round-1',
  )
  assert.deepEqual(tombstone, { id: 'round-1', deletedAt: '2026-09-01T03:00:00.000Z' })

  await assert.rejects(
    deleteRemoteRound(deleteConfirmationClient(null), 'user-1', 'round-1'),
    error => error?.code === 'ROUND_DELETE_NOT_CONFIRMED',
  )
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
