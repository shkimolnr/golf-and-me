import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')

test('앱은 서버 tombstone을 활성 라운드와 함께 fail-closed로 조회한다', () => {
  assert.match(appSource, /loadRemoteRoundSyncState/)
  assert.match(appSource, /observedRoundTombstones/)
  assert.match(appSource, /mergeObservedRoundTombstones/)
})

test('삭제 ID는 병합·화면·상세·재업로드보다 우선한다', () => {
  assert.match(appSource, /mergeRoundCollectionsWithDeletions/)
  assert.match(appSource, /roundDeletionIds/)
  assert.match(appSource, /saveRemoteRounds\(supabase, session\.user\.id, roundsToSave, deletedRoundIds\)/)
  assert.match(appSource, /loadRemoteRoundTombstone/)
  assert.match(appSource, /clearDeletedRoundLocalArtifacts/)
})

test('오프라인 삭제 queue는 서버 tombstone 확인 뒤에만 제거된다', () => {
  assert.match(appSource, /deleteRemoteRound\(supabase, session\.user\.id, roundId\)/)
  assert.match(appSource, /for \(const roundId of pendingDeletedRoundIds\)/)
  assert.match(appSource, /successfulDeletions/)
  assert.match(appSource, /remainingPending/)
  assert.match(appSource, /savePendingRoundDeletions\(window\.localStorage, session\.user\.id, remainingPending\)/)
})
