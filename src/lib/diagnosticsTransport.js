import { diagnosticCategories, diagnosticStages } from './diagnostics.js'

const QUEUE_STORAGE_KEY = 'golf-and-me:diagnostic-queue:v1'
const MAX_QUEUE_ITEMS = 20
const MAX_RETRY_DELAY_MS = 30_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PLATFORM_VALUES = new Set(['mobile', 'tablet', 'desktop', 'unknown'])

function browserStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readQueue(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(QUEUE_STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter(isDiagnosticPayload) : []
  } catch {
    return []
  }
}

function writeQueue(storage, queue) {
  try {
    storage?.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_ITEMS)))
  } catch {
    // 진단 큐를 저장하지 못해도 기록과 저장 기능에는 영향을 주지 않는다.
  }
}

function validTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validVersion(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._+-]{1,64}$/.test(value)
}

function validCount(value) {
  return Number.isInteger(value) && value >= 1 && value <= 9_999
}

function validDuration(value) {
  return Number.isInteger(value) && value >= 0 && value <= 604_800_000
}

export function diagnosticPayload(kind, record) {
  if (!['failure', 'recovery'].includes(kind) || !record || typeof record !== 'object') return null
  const allowedRecordKeys = new Set([
    'incidentId', 'stage', 'category', 'httpStatus', 'appVersion', 'platform', 'online',
    'firstOccurredAt', 'lastOccurredAt', 'occurrenceCount', 'recoveredAt', 'durationMs',
  ])
  if (Object.keys(record).some(key => !allowedRecordKeys.has(key))) return null
  if (!UUID_PATTERN.test(String(record.incidentId || ''))) return null
  if (!diagnosticStages.includes(record.stage) || !diagnosticCategories.includes(record.category)) return null
  if (!validVersion(record.appVersion) || !PLATFORM_VALUES.has(record.platform) || typeof record.online !== 'boolean') return null
  if (!validCount(record.occurrenceCount) || !validTime(record.firstOccurredAt) || !validTime(record.lastOccurredAt)) return null
  if (record.httpStatus !== null && record.httpStatus !== undefined && (!Number.isInteger(record.httpStatus) || record.httpStatus < 100 || record.httpStatus > 599)) return null

  const payload = {
    kind,
    incidentId: record.incidentId,
    stage: record.stage,
    category: record.category,
    httpStatus: record.httpStatus ?? null,
    appVersion: record.appVersion,
    platform: record.platform,
    online: record.online,
    firstOccurredAt: record.firstOccurredAt,
    lastOccurredAt: record.lastOccurredAt,
    occurrenceCount: record.occurrenceCount,
  }
  if (kind === 'recovery') {
    if (!validTime(record.recoveredAt) || !validDuration(record.durationMs)) return null
    payload.recoveredAt = record.recoveredAt
    payload.durationMs = record.durationMs
  }
  return payload
}

function isDiagnosticPayload(value) {
  return Boolean(diagnosticPayload(value?.kind, value))
}

function replaceOrAppend(queue, payload) {
  const index = queue.findIndex(item => item.kind === payload.kind && item.incidentId === payload.incidentId)
  if (index >= 0) queue[index] = payload
  else queue.push(payload)
  return queue.slice(-MAX_QUEUE_ITEMS)
}

export function createDiagnosticsTransport({
  endpoint = '/api/diagnostics',
  fetchImpl = globalThis.fetch,
  getAccessToken = async () => '',
  storage = browserStorage(),
  schedule = typeof window === 'undefined' ? null : window.setTimeout.bind(window),
} = {}) {
  let queue = readQueue(storage)
  let flushing = false
  let retryTimer = null
  let failures = 0

  function persist() {
    writeQueue(storage, queue)
  }

  function scheduleRetry() {
    if (!schedule || retryTimer || queue.length === 0) return
    const delay = Math.min(1_000 * (2 ** Math.min(failures, 5)), MAX_RETRY_DELAY_MS)
    retryTimer = schedule(() => {
      retryTimer = null
      flush()
    }, delay)
  }

  async function flush() {
    if (flushing || queue.length === 0 || typeof fetchImpl !== 'function') return false
    flushing = true
    let sent = false
    try {
      while (queue.length) {
        const accessToken = await getAccessToken()
        if (!accessToken) break
        const current = queue[0]
        let response
        try {
          response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(current),
          })
        } catch {
          failures += 1
          scheduleRetry()
          break
        }
        if (!response?.ok) {
          failures += 1
          scheduleRetry()
          break
        }
        queue.shift()
        persist()
        failures = 0
        sent = true
      }
    } finally {
      flushing = false
    }
    return sent
  }

  function enqueue(kind, record) {
    const payload = diagnosticPayload(kind, record)
    if (!payload) return false
    queue = replaceOrAppend(queue, payload)
    persist()
    void flush()
    return true
  }

  function clear() {
    queue = []
    persist()
  }

  function size() {
    return queue.length
  }

  return Object.freeze({ enqueue, flush, clear, size })
}

let defaultAccessTokenProvider = async () => ''
const defaultTransport = createDiagnosticsTransport({ getAccessToken: () => defaultAccessTokenProvider() })

export function setDiagnosticAccessTokenProvider(provider) {
  defaultAccessTokenProvider = typeof provider === 'function' ? provider : async () => ''
}

export function enqueueDiagnosticFailure(record) {
  return defaultTransport.enqueue('failure', record)
}

export function enqueueDiagnosticRecovery(record) {
  return defaultTransport.enqueue('recovery', record)
}

export function flushDiagnosticQueue() {
  return defaultTransport.flush()
}

export function clearDiagnosticQueue() {
  defaultTransport.clear()
}
