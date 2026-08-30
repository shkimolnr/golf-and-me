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

export function validateHoleCompletion({ par = null, distance = '', shots = [], putts = null } = {}) {
  const totals = calculateHoleTotals(shots, putts)
  const recordedIndexes = shots.reduce((indexes, shot, index) => {
    if (isRecordedShot(shot)) indexes.push(index)
    return indexes
  }, [])
  const blockingMessages = []

  if (!Number.isFinite(par)) blockingMessages.push('PAR를 선택해주세요.')
  if (!recordedIndexes.length || recordedIndexes[0] !== 0) {
    blockingMessages.push('티샷 기록이 필요해요.')
  } else {
    const lastRecordedIndex = recordedIndexes[recordedIndexes.length - 1]
    const hasSequenceGap = Array.from({ length: lastRecordedIndex + 1 }, (_, index) => index)
      .some(index => !isRecordedShot(shots[index]))
    if (hasSequenceGap) blockingMessages.push('샷 순서를 확인해주세요. 앞 샷부터 이어서 입력해야 해요.')
  }
  if (recordedIndexes.some(index => !String(shots[index]?.club || '').trim())) {
    blockingMessages.push('사용한 샷의 클럽을 선택해주세요.')
  }
  if (hasIncompleteOb(shots)) blockingMessages.push('OB 처리 방법과 이어지는 재샷을 확인해주세요.')
  if (!Number.isFinite(putts)) blockingMessages.push('퍼팅 수를 선택해주세요.')

  const missingDistanceCount = recordedIndexes.filter(index => {
    const value = index === 0 ? distance : shots[index]?.remainingDistance
    return value === '' || value == null
  }).length
  const advisoryMessages = missingDistanceCount
    ? [`거리 미입력 샷이 ${missingDistanceCount}개 있어요. 완료할 수 있지만 거리 분석에서는 제외돼요.`]
    : []

  return {
    ...totals,
    canFinalize: blockingMessages.length === 0,
    blockingMessages,
    advisoryMessages,
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
