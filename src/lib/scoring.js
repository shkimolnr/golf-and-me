export function isRecordedShot(shot) {
  if (!shot) return false
  return Boolean(
    shot.club
    || (shot.remainingDistance !== '' && shot.remainingDistance != null)
    || shot.troubleDirection
    || shot.troubleType
    || shot.provisionalFor != null
  )
}

export function penaltyStrokesForShot(shot) {
  if (!isRecordedShot(shot)) return 0
  if (shot.troubleType === 'penalty' || shot.troubleType === 'hazard') return 1
  if (shot.troubleType !== 'ob') return 0
  if (shot.obRelief === 'forward') return 2
  if (shot.obRelief === 'replay') return 1
  return 0
}

export function calculateHoleTotals(shots = [], putts = null) {
  const usedShots = shots.filter(isRecordedShot)
  const penaltyStrokes = usedShots.reduce((sum, shot) => sum + penaltyStrokesForShot(shot), 0)
  const puttingStrokes = Number.isFinite(putts) ? putts : 0
  return {
    usedShots,
    swingCount: usedShots.length,
    penaltyStrokes,
    score: usedShots.length + puttingStrokes + penaltyStrokes,
  }
}

export function terminalLieForShot(shots = [], shotIndex, putts = null, puttingStartLie = 'green') {
  if (!Number.isFinite(putts)) return null
  let lastRecordedIndex = -1
  shots.forEach((shot, index) => {
    if (isRecordedShot(shot)) lastRecordedIndex = index
  })
  if (shotIndex !== lastRecordedIndex) return null
  if (putts === 0) return '홀인'
  return puttingStartLie === 'fringe' ? '엣지' : '온 그린'
}

export function hasIncompleteOb(shots = []) {
  return shots.some((shot, index) => {
    if (!isRecordedShot(shot) || shot.troubleType !== 'ob') return false
    if (!['replay', 'forward'].includes(shot.obRelief)) return true
    return shot.obRelief === 'replay' && !isRecordedShot(shots[index + 1])
  })
}
