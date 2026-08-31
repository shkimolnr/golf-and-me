export async function requestTestAccess(email) {
  const response = await fetch('/api/test-access-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, consent: true, website: '' }),
  })

  let payload = {}
  try {
    payload = await response.json()
  } catch {
    payload = {}
  }

  if (!response.ok) {
    throw new Error(payload.message || '신청을 전달하지 못했어요. 잠시 후 다시 시도해주세요.')
  }
  return true
}
