export function hasUsableDistance(value) {
  if (value == null || value === '') return false
  const number = Number(value)
  return Number.isFinite(number) && number > 0
}

export function holeNeedsManualDistance(round, hole) {
  if ((!round?.courseId && !round?.courseTemplateId) || !hole) return false
  const sourceField = round.distanceUnit === 'YD' ? 'sourceDistanceYards' : 'sourceDistanceMeters'
  return !hasUsableDistance(hole[sourceField]) && !hasUsableDistance(hole.distance)
}

export function getRoundDistanceCoverage(round) {
  const holes = round?.holes || []
  const linked = Boolean(round?.courseId || round?.courseTemplateId)
  if (!linked || !holes.length) {
    return { linked, totalHoles: holes.length, sourceMissingHoles: 0, unresolvedMissingHoles: 0 }
  }

  const sourceField = round.distanceUnit === 'YD' ? 'sourceDistanceYards' : 'sourceDistanceMeters'
  const sourceMissing = holes.filter(hole => !hasUsableDistance(hole[sourceField]))
  const unresolvedMissing = sourceMissing.filter(hole => holeNeedsManualDistance(round, hole))

  return {
    linked,
    totalHoles: holes.length,
    sourceMissingHoles: sourceMissing.length,
    unresolvedMissingHoles: unresolvedMissing.length,
  }
}
