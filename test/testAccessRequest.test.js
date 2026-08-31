import test from 'node:test'
import assert from 'node:assert/strict'
import handler, { validateTestAccessRequest } from '../api/test-access-request.js'

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

test('테스트 계정 신청 이메일을 정규화하고 동의를 확인한다', () => {
  assert.deepEqual(validateTestAccessRequest({ email: '  TEST@Example.com ', consent: true }), { ok: true, email: 'test@example.com' })
  assert.equal(validateTestAccessRequest({ email: 'not-an-email', consent: true }).ok, false)
  assert.equal(validateTestAccessRequest({ email: 'test@example.com', consent: false }).ok, false)
})

test('Slack Webhook이 없으면 개인정보를 다른 위치에 저장하지 않고 신청을 중단한다', async () => {
  const previousWebhook = process.env.SLACK_TEST_ACCESS_WEBHOOK_URL
  delete process.env.SLACK_TEST_ACCESS_WEBHOOK_URL
  const response = responseRecorder()
  await handler({ method: 'POST', body: { email: 'test@example.com', consent: true } }, response)
  assert.equal(response.statusCode, 503)
  assert.match(response.payload.message, /신청을 받을 수 없어요/)
  if (previousWebhook) process.env.SLACK_TEST_ACCESS_WEBHOOK_URL = previousWebhook
})

test('유효한 신청은 이메일을 Slack plain_text 블록으로 전달한다', async () => {
  const previousWebhook = process.env.SLACK_TEST_ACCESS_WEBHOOK_URL
  const previousFetch = globalThis.fetch
  process.env.SLACK_TEST_ACCESS_WEBHOOK_URL = 'https://hooks.slack.test/example'
  let sentPayload
  globalThis.fetch = async (_url, options) => {
    sentPayload = JSON.parse(options.body)
    return { ok: true }
  }
  const response = responseRecorder()
  await handler({ method: 'POST', body: { email: 'test@example.com', consent: true } }, response)
  assert.equal(response.statusCode, 202)
  assert.equal(sentPayload.blocks[1].fields[0].text, 'Google 계정\ntest@example.com')
  globalThis.fetch = previousFetch
  if (previousWebhook) process.env.SLACK_TEST_ACCESS_WEBHOOK_URL = previousWebhook
  else delete process.env.SLACK_TEST_ACCESS_WEBHOOK_URL
})
