import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile(
  new URL('../supabase/migrations/202609010003_round_summary_sync.sql', import.meta.url),
  'utf8',
)
const rollback = await readFile(
  new URL('../supabase/rollbacks/202609010003_round_summary_sync_rollback.sql', import.meta.url),
  'utf8',
)
const verification = await readFile(
  new URL('../supabase/verification/202609010003_round_summary_sync_checks.sql', import.meta.url),
  'utf8',
)

test('라운드 요약은 payload insert와 update 전에 DB에서 다시 계산된다', () => {
  assert.match(migration, /create or replace function public\.calculate_round_stats_from_payload\(p_payload jsonb\)/i)
  assert.match(migration, /create trigger rounds_sync_summary\s+before insert or update of payload on public\.rounds/i)
  assert.match(migration, /new\.stats_summary := summary/i)
  assert.match(migration, /new\.entered_holes :=/i)
  assert.match(migration, /new\.total_score :=/i)
})

test('서버 요약은 앱이 사용하는 전체 통계 필드를 생성한다', () => {
  for (const field of [
    'enteredHoles', 'parRecordedHoles', 'missingParHoles', 'totalScore', 'totalPar',
    'toPar', 'frontScore', 'backScore', 'frontToPar', 'backToPar', 'parCount',
    'bogeyCount', 'doubleBogeyCount', 'triplePlusCount', 'scoreOutcomes',
    'holeInOneCount', 'totalPutts', 'puttAttempts', 'averagePutts', 'onePuttCount',
    'twoPuttCount', 'threePlusPuttCount', 'penaltyStrokes', 'obCount', 'penaltyCount',
    'firHits', 'firAttempts', 'girHits', 'girAttempts',
  ]) assert.match(migration, new RegExp(`'${field}'`))
})

test('요약 backfill은 원본 payload를 보존하고 다른 행만 재실행 가능하게 갱신한다', () => {
  assert.match(migration, /public\.calculate_round_stats_from_payload\(payload\) as summary/i)
  assert.match(migration, /is distinct from row/i)
  assert.doesNotMatch(migration, /set\s+payload\s*=/i)
  assert.doesNotMatch(migration, /delete from public\.rounds/i)
})

test('요약 동기화는 rollback과 적용 전후 검증 쿼리를 제공한다', () => {
  assert.match(rollback, /drop trigger if exists rounds_sync_summary/i)
  assert.match(rollback, /drop function if exists public\.calculate_round_stats_from_payload\(jsonb\)/i)
  assert.match(verification, /invalid_holes_container_count/)
  assert.match(verification, /summary_mismatch_count/)
  assert.match(verification, /information_schema\.triggers/)
})
