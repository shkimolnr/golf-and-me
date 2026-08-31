import test from 'node:test'
import assert from 'node:assert/strict'
import handler, { validateFeedback } from '../api/feedback.js'

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

test('의견은 공백을 정리하고 500자 이내에서만 받는다', () => {
  assert.deepEqual(validateFeedback({ message: '  버튼이 잘 안 보여요.  ' }), { ok: true, message: '버튼이 잘 안 보여요.' })
  assert.equal(validateFeedback({ message: '  ' }).ok, false)
  assert.equal(validateFeedback({ message: '가'.repeat(501) }).ok, false)
})

test('로그인 토큰이 없으면 의견을 전달하지 않는다', async () => {
  const response = responseRecorder()
  await handler({ method: 'POST', headers: {}, body: { message: '좋아요.' } }, response)
  assert.equal(response.statusCode, 401)
})

test('로그인 회원의 의견만 Slack으로 전달하고 사용자 정보는 포함하지 않는다', async () => {
  const previousFetch = globalThis.fetch
  const previousUrl = process.env.VITE_SUPABASE_URL
  const previousKey = process.env.VITE_SUPABASE_ANON_KEY
  const previousWebhook = process.env.SLACK_FEEDBACK_WEBHOOK_URL
  process.env.VITE_SUPABASE_URL = 'https://project.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SLACK_FEEDBACK_WEBHOOK_URL = 'https://hooks.slack.test/feedback'
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    if (url.endsWith('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1', email: 'private@example.com' }) }
    return { ok: true }
  }

  const response = responseRecorder()
  await handler({ method: 'POST', headers: { authorization: 'Bearer session-token' }, body: { message: '필드에서 글씨가 흐려요.' } }, response)
  assert.equal(response.statusCode, 202)
  assert.equal(requests.length, 2)
  assert.deepEqual(JSON.parse(requests[1].options.body), { text: '의견 보내기\n필드에서 글씨가 흐려요.' })
  assert.doesNotMatch(requests[1].options.body, /private@example.com|user-1|session-token/)

  globalThis.fetch = previousFetch
  if (previousUrl) process.env.VITE_SUPABASE_URL = previousUrl; else delete process.env.VITE_SUPABASE_URL
  if (previousKey) process.env.VITE_SUPABASE_ANON_KEY = previousKey; else delete process.env.VITE_SUPABASE_ANON_KEY
  if (previousWebhook) process.env.SLACK_FEEDBACK_WEBHOOK_URL = previousWebhook; else delete process.env.SLACK_FEEDBACK_WEBHOOK_URL
})
