import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [snapshotSql, recoverySql, comparisonScript, checklist, packageJson] = await Promise.all([
  readFile(new URL('../supabase/audits/20260901_schema_only_catalog_snapshot.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/audits/20260901_preview_function_recovery_capture.sql', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/compareDbCatalogSnapshot.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/audits/20260901_preview_catalog_crosscheck.md', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
])

function executableSql(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/'(?:''|[^'])*'/g, "''")
}

test('schema snapshot은 application row를 읽지 않는 read-only catalog query다', () => {
  const executable = executableSql(snapshotSql)
  assert.match(executable, /begin transaction read only/i)
  assert.doesNotMatch(executable, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|copy)\b/i)
  assert.doesNotMatch(executable, /\b(from|join)\s+(public|auth)\./i)
  assert.match(snapshotSql, /md5\(pg_catalog\.pg_get_functiondef\(functions\.oid\)\)/i)
})

test('복구 capture는 함수 DDL·owner·ACL·hash만 JSON으로 반환한다', () => {
  const executable = executableSql(recoverySql)
  assert.match(executable, /begin transaction read only/i)
  assert.match(recoverySql, /functions\.proname = 'sync_round_children_from_payload'/i)
  assert.match(recoverySql, /pg_catalog\.pg_get_function_identity_arguments\(functions\.oid\) = ''/i)
  assert.match(recoverySql, /pg_catalog\.pg_get_functiondef\(functions\.oid\)/i)
  assert.match(recoverySql, /pg_catalog\.aclexplode/i)
  assert.doesNotMatch(executable, /\b(from|join)\s+(public|auth)\./i)
  assert.doesNotMatch(executable, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|copy)\b/i)
})

test('catalog baseline은 기존 9개 migration만 명시적으로 재현한다', () => {
  const baselineList = comparisonScript.match(/const baselineMigrationFiles = \[([\s\S]*?)\n\]/)?.[1] || ''
  assert.equal((baselineList.match(/\.sql'/g) || []).length, 9)
  assert.doesNotMatch(baselineList, /202609010002|202609010003/)
  assert.match(comparisonScript, /previewSnapshotPath/)
  assert.match(comparisonScript, /differenceCount > 0\) exitCode = 2/)
  assert.match(comparisonScript, /117d20b5e9c660b31d6a8fefcd8354da/)
})

test('검증 문서는 버전별 동일한 정확한 baseline hash와 보관 제한을 명시한다', () => {
  const expectedHash = '117d20b5e9c660b31d6a8fefcd8354da'
  assert.ok((checklist.match(new RegExp(expectedHash, 'g')) || []).length >= 5)
  for (const version of ['15.14', '16.10', '17.6', '18.3']) assert.match(checklist, new RegExp(version.replace('.', '\\.')))
  assert.match(checklist, /Git repository, 공유 클라우드, 채팅 첨부에 저장하지 않습니다/)
  assert.match(checklist, /hash가 다르면 `002`를 적용하지 않고/i)
  assert.equal(JSON.parse(packageJson).scripts['test:db-catalog'], 'node scripts/compareDbCatalogSnapshot.mjs')
})
