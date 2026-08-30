export function resetNavigationForExplicitSignOut(storage, userId, savedAt = new Date().toISOString()) {
  if (!storage || !userId) return false
  storage.setItem(`golf-and-me:navigation:${userId}`, JSON.stringify({ screen: 'home', savedAt }))
  return true
}
