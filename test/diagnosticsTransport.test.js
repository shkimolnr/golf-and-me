import test from 'node:test'
import assert from 'node:assert/strict'
import { createDiagnosticsTransport, diagnosticPayload } from '../src/lib/diagnosticsTransport.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
  }
}

function record(overrides = {}) {
  return {
    incidentId: '00000000-0000-4000-8000-000000000010',
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

test('전송 payload는 허용된 비식별 필드만 만든다', () => {
  const payload = diagnosticPayload('failure', record())
  assert.deepEqual(Object.keys(payload).sort(), [
    'appVersion', 'category', 'firstOccurredAt', 'httpStatus', 'incidentId', 'kind', 'lastOccurredAt', 'occurrenceCount', 'online', 'platform', 'stage',
  ].sort())
  assert.equal(diagnosticPayload('failure', { ...record(), email: 'private@example.com' }), null)
  assert.equal(diagnosticPayload('failure', { ...record(), stage: 'course_name' }), null)
})

test('같은 incident는 최신 실패 한 건으로 합치고 큐를 20건으로 제한한다', () => {
  const storage = memoryStorage()
  const transport = createDiagnosticsTransport({ storage, fetchImpl: null, schedule: null })
  transport.enqueue('failure', record())
  transport.enqueue('failure', record({ occurrenceCount: 2, lastOccurredAt: '2026-08-31T00:01:00.000Z' }))
  assert.equal(transport.size(), 1)
  for (let index = 0; index < 25; index += 1) {
    transport.enqueue('failure', record({ incidentId: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}` }))
  }
  assert.equal(transport.size(), 20)
})

test('인증된 요청만 보내고 실패한 전송은 큐에 남겨 재시도한다', async () => {
  const storage = memoryStorage()
  let fail = true
  const requests = []
  const transport = createDiagnosticsTransport({
    storage,
    getAccessToken: async () => 'session-token',
    fetchImpl: async (_url, options) => {
      requests.push(options)
      if (fail) throw new Error('offline')
      return { ok: true }
    },
    schedule: null,
  })
  transport.enqueue('failure', record())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(transport.size(), 1)
  assert.match(requests[0].headers.Authorization, /^Bearer /)
  fail = false
  await transport.flush()
  assert.equal(transport.size(), 0)
})
