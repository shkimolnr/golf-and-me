const MAX_FEEDBACK_LENGTH = 500

export function validateFeedback(body) {
  const message = String(body?.message || '').trim()
  if (body?.website) return { ok: false, silent: true }
  if (!message) return { ok: false, message: '의견을 입력해주세요.' }
  if (message.length > MAX_FEEDBACK_LENGTH) {
    return { ok: false, message: `의견은 ${MAX_FEEDBACK_LENGTH}자 이내로 입력해주세요.` }
  }
  return { ok: true, message }
}

function bearerToken(request) {
  const header = String(request.headers?.authorization || '')
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

async function authenticatedUser(token) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!token || !supabaseUrl || !supabaseAnonKey) return null

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
  })
  if (!response.ok) return null
  return response.json()
}

function respond(response, status, payload) {
  response.status(status).json(payload)
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return respond(response, 405, { message: '지원하지 않는 요청입니다.' })
  }

  const validation = validateFeedback(request.body)
  if (!validation.ok) {
    if (validation.silent) return respond(response, 202, { ok: true })
    return respond(response, 400, { message: validation.message })
  }

  let user
  try {
    user = await authenticatedUser(bearerToken(request))
  } catch {
    user = null
  }
  if (!user?.id) return respond(response, 401, { message: '로그인 상태를 다시 확인해주세요.' })

  const webhookUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL || process.env.SLACK_TEST_ACCESS_WEBHOOK_URL
  if (!webhookUrl) {
    return respond(response, 503, { message: '지금은 의견을 받을 수 없어요. 잠시 후 다시 시도해주세요.' })
  }

  try {
    const slackResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `의견 보내기\n${validation.message}` }),
    })
    if (!slackResponse.ok) throw new Error(`Slack responded ${slackResponse.status}`)
    return respond(response, 202, { ok: true })
  } catch {
    return respond(response, 502, { message: '의견을 전달하지 못했어요. 잠시 후 다시 시도해주세요.' })
  }
}
