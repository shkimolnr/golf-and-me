import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = (await readFile(new URL('../supabase/migrations/202608310002_app_diagnostics.sql', import.meta.url), 'utf8')).replace(/\s+/g, ' ')

test('운영 진단 테이블은 사용자 식별자 없이 RLS를 켠다', () => {
  assert.match(migration, /create table if not exists public\.app_diagnostics/i)
  assert.match(migration, /alter table public\.app_diagnostics enable row level security/i)
  assert.doesNotMatch(migration, /user_id|email|access_token|course_name|payload jsonb/i)
  assert.match(migration, /revoke all on table public\.app_diagnostics from anon, authenticated/i)
})

test('동일 incident 갱신과 보관 삭제 함수는 service role에만 허용한다', () => {
  assert.match(migration, /on conflict \(incident_id\) do update/i)
  assert.match(migration, /occurrence_count = greatest/i)
  assert.match(migration, /purge_expired_app_diagnostics/i)
  assert.match(migration, /interval '30 days'/i)
  assert.match(migration, /grant execute .*record_app_diagnostic.* to service_role/i)
})
