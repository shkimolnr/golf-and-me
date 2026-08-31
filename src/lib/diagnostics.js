export const diagnosticStages = Object.freeze([
  'oauth',
  'profile_load', 'profile_save',
  'rounds_load', 'rounds_save', 'rounds_delete',
  'club_bag_load', 'club_bag_save',
  'distance_history_load', 'distance_history_save',
  'local_storage_parse', 'remote_hydration_delay', 'remote_retry',
  'account_delete', 'api_call',
])

export const diagnosticCategories = Object.freeze([
  'offline', 'auth', 'timeout', 'server', 'query', 'network', 'storage', 'unknown',
])

const activeDiagnostics = new Map()

function categoryFor(error, online) {
  if (!online) return 'offline'
  const status = Number(error?.status)
  const code = String(error?.code || '').toLowerCase()
  const message = String(error?.message || '').toLowerCase()
  if (status === 401 || status === 403 || code.includes('auth') || code.includes('jwt')) return 'auth'
  if (status === 408 || status === 504 || message.includes('timeout')) return 'timeout'
  if (status >= 500) return 'server'
  if (code.startsWith('pgrst') || [400, 404, 409, 422].includes(status)) return 'query'
  if (message.includes('storage') || message.includes('quota') || message.includes('json')) return 'storage'
  if (message.includes('fetch') || message.includes('network')) return 'network'
  return 'unknown'
}

function safeHttpStatus(error) {
  const status = Number(error?.status)
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null
}

function platformFor(navigatorValue = globalThis.navigator) {
  const userAgent = String(navigatorValue?.userAgent || '').toLowerCase()
  if (/ipad|tablet/.test(userAgent)) return 'tablet'
  if (/mobi|iphone|android/.test(userAgent)) return 'mobile'
  if (userAgent) return 'desktop'
  return 'unknown'
}

function createIncidentId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const values = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(values)
  else for (let index = 0; index < values.length; index += 1) values[index] = Math.floor(Math.random() * 256)
  values[6] = (values[6] & 0x0f) | 0x40
  values[8] = (values[8] & 0x3f) | 0x80
  const hex = [...values].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function recordsForStage(stage) {
  if (!activeDiagnostics.has(stage)) activeDiagnostics.set(stage, new Map())
  return activeDiagnostics.get(stage)
}

export function recordDiagnosticFailure({
  stage,
  error,
  online = true,
  now = new Date().toISOString(),
  appVersion = import.meta.env?.VITE_APP_VERSION || '0.1.0',
  platform = platformFor(),
  incidentId = createIncidentId(),
} = {}) {
  if (!diagnosticStages.includes(stage)) return null
  const category = categoryFor(error, online)
  const records = recordsForStage(stage)
  const current = records.get(category)
  if (current) {
    const record = {
      ...current,
      occurrenceCount: Math.min(current.occurrenceCount + 1, 9_999),
      lastOccurredAt: now,
      online: Boolean(online),
      httpStatus: safeHttpStatus(error),
    }
    records.set(category, record)
    return { record, isNew: false }
  }
  const record = {
    incidentId,
    stage,
    category,
    httpStatus: safeHttpStatus(error),
    occurrenceCount: 1,
    firstOccurredAt: now,
    lastOccurredAt: now,
    online: Boolean(online),
    platform,
    appVersion,
  }
  records.set(category, record)
  return { record, isNew: true }
}

export function resolveDiagnosticFailures(stage, now = new Date().toISOString()) {
  const records = activeDiagnostics.get(stage)
  if (!records) return []
  activeDiagnostics.delete(stage)
  return [...records.values()].map(record => ({
    ...record,
    recoveredAt: now,
    durationMs: Math.max(0, Date.parse(now) - Date.parse(record.firstOccurredAt)),
  }))
}

// 기존 단일 반환 호출부와의 호환을 위한 helper. 새 호출부는 복수 분류를 보존하는 resolveDiagnosticFailures를 사용한다.
export function resolveDiagnosticFailure(stage, now = new Date().toISOString()) {
  return resolveDiagnosticFailures(stage, now).at(-1) || null
}

export function resetDiagnosticsForTest() {
  activeDiagnostics.clear()
}
