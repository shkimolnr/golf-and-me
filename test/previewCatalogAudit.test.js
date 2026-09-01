import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const auditSql = await readFile(
  new URL('../supabase/audits/20260901_preview_readonly_catalog_audit.sql', import.meta.url),
  'utf8',
)

function executableSql(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/'(?:''|[^'])*'/g, "''")
}

test('Preview 카탈로그 감사는 read-only transaction과 SELECT만 사용한다', () => {
  const executable = executableSql(auditSql)
  assert.match(executable, /begin transaction read only/i)
  assert.match(executable, /commit/i)
  assert.doesNotMatch(executable, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|copy)\b/i)
  assert.doesNotMatch(executable, /select\s+\*/i)
})

test('감사 SQL은 요구한 schema·RLS·권한·함수 hash를 모두 다룬다', () => {
  for (const fragment of [
    'information_schema.columns',
    'pg_catalog.pg_constraint',
    'pg_catalog.pg_index',
    'pg_catalog.pg_policies',
    'has_table_privilege',
    'has_sequence_privilege',
    'has_function_privilege',
    'functions.prosecdef',
    'pg_get_userbyid',
    "functions.proname = 'rls_auto_enable'",
  ]) assert.match(auditSql, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  assert.match(auditSql, /md5\(pg_get_functiondef\(functions\.oid\)\) as definition_hash/i)
  assert.doesNotMatch(auditSql, /pg_get_functiondef\(functions\.oid\)\s+as/i)
})

test('행 데이터 검사는 식별값 대신 orphan·owner·cache 집계만 반환한다', () => {
  for (const check of [
    'profiles_auth_orphan',
    'round_holes_parent_orphan',
    'round_shots_parent_orphan',
    'club_distance_parent_orphan',
    'round_holes_owner_mismatch',
    'round_shots_owner_mismatch',
    'club_distance_owner_mismatch',
    'round_hole_count_mismatch',
    'round_shot_count_mismatch',
    'round_hole_field_mismatch',
    'round_shot_field_mismatch',
    'summary_column_mismatch_count',
    'stats_summary_mismatch_count',
  ]) assert.match(auditSql, new RegExp(check, 'i'))
  assert.doesNotMatch(auditSql, /current_database\s*\(/i)
})
