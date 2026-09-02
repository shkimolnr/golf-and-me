import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyLedgerTexts, verifyProjectLedger } from '../scripts/verifyProjectLedger.mjs'

test('project ledger has no duplicate, orphaned, or unmapped intake records', () => {
  const result = verifyProjectLedger()

  assert.deepEqual(result.errors, [])
  assert.equal(result.counts.unmapped, 0)
  assert.ok(result.counts.issues > 0)
  assert.ok(result.counts.routes >= result.counts.issues)
})

test('project ledger verifier rejects silent intake loss and missing task targets', () => {
  const backlog = `
| ID | 우선순위 | 작업 | 상태 | 완료 조건 |
|---|---|---|---|---|
| TASK-001 | P0 | 예시 | 대기 | 확인 |
`
  const inbox = `
| 이슈 ID | 접수일 | 출처 | 원문 의미 요약 | 증거 |
|---|---|---|---|---|
| ISSUE-001 | 2026-09-02 | 테스트 | 첫 이슈 | 없음 |
| ISSUE-002 | 2026-09-02 | 테스트 | 둘째 이슈 | 없음 |

| 라우팅 ID | 일자 | 이슈 ID | 분류 | 연결 대상 | 처리 내용 |
|---|---|---|---|---|---|
| ROUTE-001 | 2026-09-02 | ISSUE-001 | 신규 태스크 | TASK-999 | 잘못된 연결 |
`

  const result = verifyLedgerTexts({ backlog, inbox })

  assert.ok(result.errors.some((error) => error.includes('TASK-999')))
  assert.ok(result.errors.some((error) => error.includes('ISSUE-002')))
})
