import test from 'node:test'
import assert from 'node:assert/strict'
import handler, { allowDiagnosticRequest, resetDiagnosticRateLimitForTests, validateDiagnosticPayload } from '../api/diagnostics.js'

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

function payload(overrides = {}) {
  return {
    kind: 'failure',
    incidentId: '00000000-0000-4000-8000-000000000020',
    stage: 'rounds_load',
    category: 'network',
    httpStatus: null,
    appVersion: '0.1.0',
    platform: 'mobile',
    online: true,
    firstOccurredAt: '2026-08-31T00:00:00.000Z',
    lastOccurredAt: '2026-08-31T00:00:00.000Z',
    occurrenceCount: 1,
    ...overrides,
  }
}

test('진단 API는 허용 목록 밖 개인정보 필드를 거부한다', () => {
  assert.equal(validateDiagnosticPayload(payload()).ok, true)
  assert.equal(validateDiagnosticPayload(payload({ email: 'private@example.com' })).ok, false)
  assert.equal(validateDiagnosticPayload(payload({ userId: 'user-1' })).ok, false)
  assert.equal(validateDiagnosticPayload(payload({ message: 'original error' })).ok, false)
})

test('인증 사용자별 짧은 반복 요청은 서버 인스턴스에서 제한한다', () => {
  resetDiagnosticRateLimitForTests()
  for (let index = 0; index < 20; index += 1) assert.equal(allowDiagnosticRequest('user-1', 1_000), true)
  assert.equal(allowDiagnosticRequest('user-1', 1_000), false)
  assert.equal(allowDiagnosticRequest('user-1', 61_000), true)
})

test('진단 API는 인증 후 service-role RPC에 안전한 payload만 전달한다', async () => {
  resetDiagnosticRateLimitForTests()
  const previousFetch = globalThis.fetch
  const env = Object.fromEntries(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].map(key => [key, process.env[key]]))
  process.env.VITE_SUPABASE_URL = 'https://project.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    if (url.endsWith('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1', email: 'private@example.com' }) }
    return { ok: true }
  }
  const response = responseRecorder()
  await handler({ method: 'POST', headers: { authorization: 'Bearer session-token' }, body: payload() }, response)
  assert.equal(response.statusCode, 202)
  assert.equal(requests.length, 2)
  assert.match(requests[1].url, /record_app_diagnostic$/)
  assert.doesNotMatch(requests[1].options.body, /private@example.com|user-1|session-token/)
  globalThis.fetch = previousFetch
  for (const [key, value] of Object.entries(env)) {
    if (value) process.env[key] = value
    else delete process.env[key]
  }
})
