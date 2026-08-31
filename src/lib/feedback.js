export const MAX_FEEDBACK_LENGTH = 500

export async function sendFeedback(message, accessToken) {
  const response = await fetch('/api/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ message, website: '' }),
  })

  let payload = {}
  try {
    payload = await response.json()
  } catch {
    payload = {}
  }

  if (!response.ok) {
    throw new Error(payload.message || '의견을 전달하지 못했어요. 잠시 후 다시 시도해주세요.')
  }
  return true
}
