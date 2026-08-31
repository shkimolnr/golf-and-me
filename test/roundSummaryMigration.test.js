import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('../supabase/migrations/202608310002_round_summary_columns.sql', import.meta.url), 'utf8')

test('홈 경량 조회에 필요한 라운드 요약 컬럼을 원본 payload와 별도로 추가한다', () => {
  for (const column of [
    'entered_holes', 'par_recorded_holes', 'total_score', 'score_to_par',
    'total_putts', 'putt_attempts', 'fir_hits', 'fir_attempts', 'gir_hits', 'gir_attempts', 'stats_summary',
  ]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}`))
  }
  assert.doesNotMatch(migration, /drop column/i)
  assert.doesNotMatch(migration, /delete from public\.rounds/i)
})

test('기존 라운드도 payload에서 요약값을 역산하고 목록용 인덱스를 추가한다', () => {
  assert.match(migration, /jsonb_array_elements\(coalesce\(rounds\.payload->'holes'/)
  assert.match(migration, /update public\.rounds/)
  assert.match(migration, /rounds_user_status_played_idx/)
})
