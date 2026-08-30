export function isRoundStructureLocked(round, draftHoleNumbers = []) {
  if (!round) return false
  if (round.status === 'completed') return true
  const drafted = new Set(draftHoleNumbers.map(Number))
  return Boolean(round.holes?.slice(3).some(hole => (
    Number.isFinite(hole.score) || drafted.has(Number(hole.holeNumber))
  )))
}

export function needsRoundStructureChoice(hasStructuralChange, hasRecordedData, locked) {
  return Boolean(hasStructuralChange && hasRecordedData && !locked)
}
