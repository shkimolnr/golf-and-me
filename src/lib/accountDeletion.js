export function clearLocalUserData(storage, userId) {
  if (!storage || !userId) return []
  const marker = `:${userId}`
  const keys = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith('golf-and-me:') && key.includes(marker)) keys.push(key)
  }
  keys.forEach(key => storage.removeItem(key))
  return keys
}

export async function deleteRemoteAccount(client) {
  if (!client) return { error: new Error('Supabase client is required') }
  return client.rpc('delete_own_account')
}
