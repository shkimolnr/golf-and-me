import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [migration, rollback, verification, riskAnalysis, packageJson] = await Promise.all([
  readFile(new URL('../supabase/migrations/202609010004_runtime_table_least_privilege.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/rollbacks/202609010004_runtime_table_least_privilege_rollback.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/verification/202609010004_runtime_table_least_privilege_checks.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/audits/20260901_runtime_table_privilege_risk.md', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
])

const targetTables = [
  'profiles',
  'rounds',
  'round_holes',
  'round_shots',
  'user_clubs',
  'club_distance_history',
  'app_diagnostics',
]

test('모든 runtime 역할에서 RLS 밖의 위험 table 권한만 회수한다', () => {
  const normalized = migration.replace(/--.*$/gm, '').replace(/\s+/g, ' ')
  assert.match(normalized, /revoke truncate, references, trigger on table/i)
  assert.match(normalized, /from public, anon, authenticated, service_role/i)
  for (const table of targetTables) assert.match(migration, new RegExp(`public\\.${table}`, 'i'))
  assert.doesNotMatch(normalized, /revoke (select|insert|update|delete)/i)
  assert.doesNotMatch(normalized, /\bgrant\b/i)
})

test('effective 권한이 간접 경로로 남으면 migration 전체를 실패시킨다', () => {
  for (const privilege of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
    assert.match(migration, new RegExp(`\\('${privilege}'\\)`))
  }
  assert.match(migration, /pg_catalog\.has_table_privilege/i)
  assert.match(migration, /if remaining_privileges <> 0 then[\s\S]+raise exception/i)
  assert.match(migration, /begin;[\s\S]+commit;/i)
})

test('rollback은 위험을 경고하고 관측된 effective matrix만 명시적으로 복원한다', () => {
  assert.match(rollback, /SECURITY WARNING/)
  assert.match(rollback, /grant truncate, references, trigger on table/i)
  assert.match(rollback, /to anon, authenticated, service_role/i)
  assert.doesNotMatch(rollback, /to public/i)
  assert.match(riskAnalysis, /자동 실행하면 안 됩니다/)
})

test('verification은 위험 권한 0과 필수 CRUD·진단 RPC 보존을 함께 확인한다', () => {
  assert.match(verification, /begin transaction read only/i)
  assert.match(verification, /violation_count/i)
  assert.match(verification, /required_privilege_missing_count/i)
  assert.match(verification, /anon_crud_violation_count/i)
  assert.match(verification, /pg_catalog\.aclexplode/i)
  assert.match(verification, /record_app_diagnostic/i)
  assert.match(verification, /purge_expired_app_diagnostics/i)
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    assert.match(verification, new RegExp(`'${privilege}'`))
  }
  assert.match(riskAnalysis, /service role에는 함수 EXECUTE만 필요합니다/)
  assert.equal(
    JSON.parse(packageJson).scripts['test:db-privileges'],
    'node scripts/verifyRuntimeTablePrivileges.mjs',
  )
})
