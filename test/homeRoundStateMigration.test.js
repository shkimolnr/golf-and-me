import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('../supabase/migrations/202609030001_home_round_state.sql', import.meta.url), 'utf8')
const rollback = await readFile(new URL('../supabase/rollbacks/202609030001_home_round_state_rollback.sql', import.meta.url), 'utf8')
const checks = await readFile(new URL('../supabase/verification/202609030001_home_round_state_checks.sql', import.meta.url), 'utf8')

test('첫 화면 함수는 최근 완료 기록·전체 누적 통계·버전 목록만 반환한다', () => {
  assert.match(migration, /create or replace function public\.get_home_round_state/)
  assert.match(migration, /limit \(select page_limit from parameters\)/)
  assert.match(migration, /'completedRounds'/)
  assert.match(migration, /'cumulativeStats'/)
  assert.match(migration, /'versions'/)
  assert.doesNotMatch(migration, /jsonb_build_object\([^]*?'payload'/)
})

test('첫 화면 함수는 호출 사용자의 행만 읽고 공개 실행을 차단한다', () => {
  assert.match(migration, /where user_id = auth\.uid\(\)/)
  assert.match(migration, /security invoker/)
  assert.match(migration, /revoke all on function public\.get_home_round_state\(integer, integer\) from public, anon/)
  assert.match(migration, /grant execute on function public\.get_home_round_state\(integer, integer\) to authenticated, service_role/)
})

test('첫 화면 함수는 rollback과 읽기 전용 검증을 제공한다', () => {
  assert.match(rollback, /drop function if exists public\.get_home_round_state/)
  assert.match(checks, /begin transaction read only/)
  assert.match(checks, /securityInvoker/)
  assert.match(checks, /missingSummary/)
  assert.match(checks, /rollback/)
})
