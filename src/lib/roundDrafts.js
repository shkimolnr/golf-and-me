function timestamp(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

export function latestHoleDraft(localDraft, syncedDraft) {
  if (!localDraft) return syncedDraft || null
  if (!syncedDraft) return localDraft
  return timestamp(syncedDraft.draftUpdatedAt) > timestamp(localDraft.draftUpdatedAt) ? syncedDraft : localDraft
}

export function upsertRoundHoleDraft(round, draft, draftUpdatedAt = new Date().toISOString()) {
  if (!round || !draft) return round
  const savedDraft = { ...draft, draftUpdatedAt }
  return {
    ...round,
    draftHoles: { ...(round.draftHoles || {}), [draft.holeNumber]: savedDraft },
    updatedAt: draftUpdatedAt,
  }
}

export function removeRoundHoleDraft(round, holeNumber, updatedAt = new Date().toISOString()) {
  if (!round) return round
  const nextDrafts = { ...(round.draftHoles || {}) }
  delete nextDrafts[holeNumber]
  return { ...round, draftHoles: nextDrafts, updatedAt }
}

export function clearRoundHoleDrafts(round, updatedAt = new Date().toISOString()) {
  return round ? { ...round, draftHoles: {}, updatedAt } : round
}
