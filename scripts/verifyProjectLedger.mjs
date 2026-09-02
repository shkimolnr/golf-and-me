import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ISSUE_PATTERN = /^ISSUE-(\d{3})$/
const ROUTE_PATTERN = /^ROUTE-(\d{3})$/
const TASK_PATTERN = /^TASK-(\d{3})$/
const TASK_REFERENCE_PATTERN = /TASK-\d{3}/g
const ALLOWED_ROUTING_TYPES = new Set([
  '기존 태스크',
  '신규 태스크',
  '정책 결정',
  '완료 확인',
  '중복 병합',
  '재분류',
])

function tableRows(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length > 0 && !cells.every((cell) => /^-+$/.test(cell)))
}

function collectExactIds(rows, pattern) {
  return rows
    .map((cells) => cells[0])
    .filter((value) => pattern.test(value))
}

function duplicateIds(ids) {
  const seen = new Set()
  return [...new Set(ids.filter((id) => seen.has(id) || !seen.add(id)))]
}

function checkSequential(ids, prefix, errors) {
  const numbers = ids.map((id) => Number(id.slice(prefix.length + 1)))
  numbers.forEach((number, index) => {
    if (number !== index + 1) {
      errors.push(`${prefix} 번호가 연속되지 않습니다: ${ids[index]}`)
    }
  })
}

export function verifyLedgerTexts({ backlog, inbox }) {
  const errors = []
  const backlogRows = tableRows(backlog)
  const inboxRows = tableRows(inbox)
  const taskIds = collectExactIds(backlogRows, TASK_PATTERN)
  const issueRows = inboxRows.filter((cells) => ISSUE_PATTERN.test(cells[0]))
  const routeRows = inboxRows.filter((cells) => ROUTE_PATTERN.test(cells[0]))
  const issueIds = issueRows.map((cells) => cells[0])
  const routeIds = routeRows.map((cells) => cells[0])

  for (const [label, ids] of [['TASK', taskIds], ['ISSUE', issueIds], ['ROUTE', routeIds]]) {
    const duplicates = duplicateIds(ids)
    if (duplicates.length > 0) errors.push(`${label} 중복 ID: ${duplicates.join(', ')}`)
  }

  checkSequential(issueIds, 'ISSUE', errors)
  checkSequential(routeIds, 'ROUTE', errors)

  const issueSet = new Set(issueIds)
  const taskSet = new Set(taskIds)
  const routedIssues = new Set()

  for (const cells of routeRows) {
    const [routeId, , issueId, routingType, target = ''] = cells
    if (!issueSet.has(issueId)) errors.push(`${routeId}가 없는 이슈를 참조합니다: ${issueId}`)
    else routedIssues.add(issueId)

    if (!ALLOWED_ROUTING_TYPES.has(routingType)) {
      errors.push(`${routeId}의 분류가 허용 목록에 없습니다: ${routingType}`)
    }

    const taskReferences = target.match(TASK_REFERENCE_PATTERN) ?? []
    for (const taskId of taskReferences) {
      if (!taskSet.has(taskId)) errors.push(`${routeId}가 없는 태스크를 참조합니다: ${taskId}`)
    }

    if (routingType !== '완료 확인' && taskReferences.length === 0) {
      errors.push(`${routeId}에 연결 태스크가 없습니다`)
    }
  }

  const unmappedIssues = issueIds.filter((issueId) => !routedIssues.has(issueId))
  if (unmappedIssues.length > 0) errors.push(`라우팅 없는 이슈: ${unmappedIssues.join(', ')}`)

  return {
    errors,
    counts: {
      tasks: taskIds.length,
      issues: issueIds.length,
      routes: routeIds.length,
      unmapped: unmappedIssues.length,
    },
  }
}

export function verifyProjectLedger(rootDir = process.cwd()) {
  const backlog = fs.readFileSync(path.join(rootDir, 'BACKLOG.md'), 'utf8')
  const inbox = fs.readFileSync(path.join(rootDir, 'ISSUE_INBOX.md'), 'utf8')
  return verifyLedgerTexts({ backlog, inbox })
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = verifyProjectLedger()
  if (result.errors.length > 0) {
    result.errors.forEach((error) => console.error(`- ${error}`))
    process.exitCode = 1
  } else {
    console.log(`Ledger verified: ${result.counts.issues} issues, ${result.counts.routes} routes, ${result.counts.unmapped} unmapped`)
  }
}
