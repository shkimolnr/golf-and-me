export function pendingRoundDeletionKey(userId) {
  return `golf-and-me:pending-round-deletions:${userId}`
}

export function loadPendingRoundDeletions(storage, userId) {
  try {
    const value = JSON.parse(storage.getItem(pendingRoundDeletionKey(userId)) || '[]')
    return Array.isArray(value) ? [...new Set(value.map(String))] : []
  } catch {
    storage.removeItem(pendingRoundDeletionKey(userId))
    return []
  }
}

export function savePendingRoundDeletions(storage, userId, roundIds) {
  const normalized = [...new Set((roundIds || []).map(String))]
  if (normalized.length) storage.setItem(pendingRoundDeletionKey(userId), JSON.stringify(normalized))
  else storage.removeItem(pendingRoundDeletionKey(userId))
  return normalized
}

export function excludePendingRoundDeletions(rounds, roundIds) {
  const deleted = new Set((roundIds || []).map(String))
  return (rounds || []).filter(round => !deleted.has(String(round.id)))
}
