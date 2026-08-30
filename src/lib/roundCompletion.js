export function roundCompletionState(round) {
  const holes = Array.isArray(round?.holes) ? round.holes : []
  const missingHoles = holes.filter(hole => !Number.isFinite(hole.score))
  return {
    enteredCount: holes.length - missingHoles.length,
    missingHoles,
    canComplete: holes.length === 18 && missingHoles.length === 0,
  }
}

