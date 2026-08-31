import { diagnosticCategories, diagnosticStages } from '../src/lib/diagnostics.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PLATFORM_VALUES = new Set(['mobile', 'tablet', 'desktop', 'unknown'])
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 20
const recentRequests = new Map()

function bearerToken(request) {
  const header = String(request.headers?.authorization || '')
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
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

export function allowDiagnosticRequest(subject, now = Date.now()) {
  if (!subject) return false
  const current = recentRequests.get(subject)
  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    recentRequests.set(subject, { startedAt: now, count: 1 })
    return true
  }
  if (current.count >= RATE_LIMIT_MAX_REQUESTS) return false
  current.count += 1
  return true
}

export function resetDiagnosticRateLimitForTests() {
  recentRequests.clear()
}

export function validateDiagnosticPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false }
  const allowedKeys = new Set([
    'kind', 'incidentId', 'stage', 'category', 'httpStatus', 'appVersion', 'platform', 'online',
    'firstOccurredAt', 'lastOccurredAt', 'occurrenceCount', 'recoveredAt', 'durationMs',
  ])
  if (Object.keys(body).some(key => !allowedKeys.has(key))) return { ok: false }
  const {
    kind, incidentId, stage, category, httpStatus, appVersion, platform, online,
    firstOccurredAt, lastOccurredAt, occurrenceCount, recoveredAt, durationMs,
  } = body
  if (!['failure', 'recovery'].includes(kind) || !UUID_PATTERN.test(String(incidentId || ''))) return { ok: false }
  if (!diagnosticStages.includes(stage) || !diagnosticCategories.includes(category)) return { ok: false }
  if (!validVersion(appVersion) || !PLATFORM_VALUES.has(platform) || typeof online !== 'boolean') return { ok: false }
  if (!validTime(firstOccurredAt) || !validTime(lastOccurredAt) || Date.parse(firstOccurredAt) > Date.parse(lastOccurredAt)) return { ok: false }
  if (!validCount(occurrenceCount)) return { ok: false }
  if (httpStatus !== null && httpStatus !== undefined && (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) return { ok: false }
  if (kind === 'recovery' && (!validTime(recoveredAt) || !validDuration(durationMs))) return { ok: false }
  return {
    ok: true,
    payload: {
      kind,
      incidentId,
      stage,
      category,
      httpStatus: httpStatus ?? null,
      appVersion,
      platform,
      online,
      firstOccurredAt,
      lastOccurredAt,
      occurrenceCount,
      recoveredAt: kind === 'recovery' ? recoveredAt : null,
      durationMs: kind === 'recovery' ? durationMs : null,
    },
  }
}

async function authenticatedUser(token) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!token || !supabaseUrl || !supabaseAnonKey) return null
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}` },
  })
  if (!response.ok) return null
  return response.json()
}

async function recordDiagnostic(payload) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return false
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/record_app_diagnostic`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_kind: payload.kind,
      p_incident_id: payload.incidentId,
      p_stage: payload.stage,
      p_category: payload.category,
      p_http_status: payload.httpStatus,
      p_app_version: payload.appVersion,
      p_platform: payload.platform,
      p_online: payload.online,
      p_first_occurred_at: payload.firstOccurredAt,
      p_last_occurred_at: payload.lastOccurredAt,
      p_occurrence_count: payload.occurrenceCount,
      p_recovered_at: payload.recoveredAt,
      p_recovery_duration_ms: payload.durationMs,
    }),
  })
  return response.ok
}

function respond(response, status, payload) {
  response.status(status).json(payload)
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return respond(response, 405, { message: '지원하지 않는 요청입니다.' })
  }
  const validation = validateDiagnosticPayload(request.body)
  if (!validation.ok) return respond(response, 400, { message: '진단 형식을 확인할 수 없습니다.' })

  let user
  try {
    user = await authenticatedUser(bearerToken(request))
  } catch {
    user = null
  }
  if (!user?.id) return respond(response, 401, { message: '로그인 상태를 다시 확인해주세요.' })
  // UUID는 이 서버 인스턴스의 짧은 요청 제한에만 쓰며 DB·로그에 저장하지 않는다.
  if (!allowDiagnosticRequest(user.id)) return respond(response, 429, { message: '잠시 후 다시 시도해주세요.' })

  try {
    if (!await recordDiagnostic(validation.payload)) return respond(response, 503, { message: '진단을 잠시 저장하지 못했습니다.' })
  } catch {
    return respond(response, 503, { message: '진단을 잠시 저장하지 못했습니다.' })
  }
  return respond(response, 202, { ok: true })
}
