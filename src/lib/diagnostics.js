export const diagnosticStages = Object.freeze([
  'oauth', 'profile_load', 'rounds_load', 'club_bag_load',
  'rounds_save', 'club_bag_save', 'account_delete',
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
  if (message.includes('fetch') || message.includes('network')) return 'network'
  return 'unknown'
}

export function recordDiagnosticFailure({ stage, error, online = true, now = new Date().toISOString(), appVersion = '0.1.0' }) {
  if (!diagnosticStages.includes(stage)) return null
  const category = categoryFor(error, online)
  const current = activeDiagnostics.get(stage)
  if (current?.category === category) {
    const record = { ...current, occurrenceCount: current.occurrenceCount + 1, lastOccurredAt: now }
    activeDiagnostics.set(stage, record)
    return { record, isNew: false }
  }
  const record = { stage, category, occurrenceCount: 1, firstOccurredAt: now, lastOccurredAt: now, appVersion }
  activeDiagnostics.set(stage, record)
  return { record, isNew: true }
}

export function resolveDiagnosticFailure(stage, now = new Date().toISOString()) {
  const record = activeDiagnostics.get(stage)
  if (!record) return null
  activeDiagnostics.delete(stage)
  return { ...record, durationMs: Math.max(0, Date.parse(now) - Date.parse(record.firstOccurredAt)) }
}

export function resetDiagnosticsForTest() {
  activeDiagnostics.clear()
}
