const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateTestAccessRequest(body) {
  const email = String(body?.email || '').trim().toLowerCase()
  if (!email || email.length > 254 || !emailPattern.test(email)) {
    return { ok: false, message: 'Google 계정 이메일을 확인해주세요.' }
  }
  if (body?.website) return { ok: false, silent: true }
  if (body?.consent !== true) {
    return { ok: false, message: '이메일 전달 안내를 확인해주세요.' }
  }
  return { ok: true, email }
}

function respond(response, status, payload) {
  response.status(status).json(payload)
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return respond(response, 405, { message: '지원하지 않는 요청입니다.' })
  }

  const validation = validateTestAccessRequest(request.body)
  if (!validation.ok) {
    if (validation.silent) return respond(response, 202, { ok: true })
    return respond(response, 400, { message: validation.message })
  }

  const webhookUrl = process.env.SLACK_TEST_ACCESS_WEBHOOK_URL
  if (!webhookUrl) {
    return respond(response, 503, { message: '지금은 신청을 받을 수 없어요. 잠시 후 다시 시도해주세요.' })
  }

  try {
    const slackResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: validation.email,
      }),
    })
    if (!slackResponse.ok) throw new Error(`Slack responded ${slackResponse.status}`)
    return respond(response, 202, { ok: true })
  } catch {
    return respond(response, 502, { message: '신청을 전달하지 못했어요. 잠시 후 다시 시도해주세요.' })
  }
}
