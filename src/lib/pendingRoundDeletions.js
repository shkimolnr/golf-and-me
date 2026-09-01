export function pendingRoundDeletionKey(userId) {
  return `golf-and-me:pending-round-deletions:${userId}`
}

export function observedRoundTombstoneKey(userId) {
  return `golf-and-me:observed-round-tombstones:${userId}`
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

function normalizeTombstones(tombstones) {
  const byId = new Map()
  for (const tombstone of tombstones || []) {
    const id = String(tombstone?.id ?? tombstone?.roundId ?? tombstone?.round_id ?? '')
    if (!id) continue
    const deletedAt = String(tombstone?.deletedAt ?? tombstone?.deleted_at ?? '') || null
    const current = byId.get(id)
    if (!current || String(deletedAt || '') > String(current.deletedAt || '')) {
      byId.set(id, { id, deletedAt })
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id))
}

export function loadObservedRoundTombstones(storage, userId) {
  try {
    const value = JSON.parse(storage.getItem(observedRoundTombstoneKey(userId)) || '[]')
    return Array.isArray(value) ? normalizeTombstones(value) : []
  } catch {
    storage.removeItem(observedRoundTombstoneKey(userId))
    return []
  }
}

export function saveObservedRoundTombstones(storage, userId, tombstones) {
  const normalized = normalizeTombstones(tombstones)
  if (normalized.length) {
    storage.setItem(observedRoundTombstoneKey(userId), JSON.stringify(normalized))
  } else {
    storage.removeItem(observedRoundTombstoneKey(userId))
  }
  return normalized
}

export function mergeObservedRoundTombstones(current, incoming) {
  return normalizeTombstones([...(current || []), ...(incoming || [])])
}

export function roundDeletionIds(pendingRoundIds = [], observedTombstones = []) {
  return [...new Set([
    ...pendingRoundIds.map(String),
    ...normalizeTombstones(observedTombstones).map(item => item.id),
  ])]
}

export function clearDeletedRoundLocalArtifacts(storage, userId, roundIds) {
  const deleted = new Set((roundIds || []).map(String))
  if (!storage || !userId || !deleted.size) return []
  const removed = []
  const draftPrefix = `golf-and-me:hole-draft:${userId}:`
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith(draftPrefix)) continue
    const roundId = key.slice(draftPrefix.length).split(':')[0]
    if (deleted.has(roundId)) removed.push(key)
  }
  removed.forEach(key => storage.removeItem(key))

  const navigationKey = `golf-and-me:navigation:${userId}`
  try {
    const checkpoint = JSON.parse(storage.getItem(navigationKey) || 'null')
    if (deleted.has(String(checkpoint?.roundId))) {
      storage.setItem(navigationKey, JSON.stringify({ screen: 'home', savedAt: new Date().toISOString() }))
    }
  } catch {
    storage.removeItem(navigationKey)
  }
  return removed
}
