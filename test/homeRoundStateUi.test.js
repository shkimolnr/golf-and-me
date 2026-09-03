import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')

test('홈은 서버 전체 건수와 25건 단위 더 보기를 분리한다', () => {
  assert.match(appSource, /COMPLETED_ROUNDS_PAGE_SIZE/)
  assert.match(appSource, /setCompletedRoundsCursor\(roundsResult\.value\.nextCursor\)/)
  assert.match(appSource, /cursor: completedRoundsCursor/)
  assert.match(appSource, /이전 완료 기록 더 보기/)
})

test('모든 완료 기록이 기기에 있으면 오프라인 변경도 로컬 누적 통계에 즉시 반영한다', () => {
  assert.match(appSource, /completedRoundList\.length >= completedRoundCount\s*\? localCumulativeStats/)
  assert.match(appSource, /homeAggregateChanged/)
  assert.match(appSource, /loadRemoteHomeRoundState\(supabase\)/)
})
