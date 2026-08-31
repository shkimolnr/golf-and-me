export function calculateRoundStats(round) {
  if (round?.remoteSummaryOnly && round.statsSummary) return round.statsSummary
  const roundHoles = round?.holes || []
  const holes = roundHoles.filter(hole => Number.isFinite(hole.score))
  const holesWithPar = holes.filter(hole => Number.isFinite(hole.par))
  const frontHoles = roundHoles.slice(0, 9).filter(hole => Number.isFinite(hole.score))
  const backHoles = roundHoles.slice(9, 18).filter(hole => Number.isFinite(hole.score))
  const frontHolesWithPar = frontHoles.filter(hole => Number.isFinite(hole.par))
  const backHolesWithPar = backHoles.filter(hole => Number.isFinite(hole.par))
  const totalScore = holes.reduce((sum, hole) => sum + hole.score, 0)
  const totalPar = holesWithPar.reduce((sum, hole) => sum + hole.par, 0)
  const scoreWithPar = holesWithPar.reduce((sum, hole) => sum + hole.score, 0)
  const frontScore = frontHoles.reduce((sum, hole) => sum + hole.score, 0)
  const backScore = backHoles.reduce((sum, hole) => sum + hole.score, 0)
  const frontPar = frontHolesWithPar.reduce((sum, hole) => sum + hole.par, 0)
  const backPar = backHolesWithPar.reduce((sum, hole) => sum + hole.par, 0)
  const frontScoreWithPar = frontHolesWithPar.reduce((sum, hole) => sum + hole.score, 0)
  const backScoreWithPar = backHolesWithPar.reduce((sum, hole) => sum + hole.score, 0)
  const puttHoles = holes.filter(hole => Number.isFinite(hole.officialPutts) || Number.isFinite(hole.putts))
  const puttValues = puttHoles.map(hole => Number.isFinite(hole.officialPutts) ? hole.officialPutts : hole.putts)
  const totalPutts = puttValues.reduce((sum, value) => sum + value, 0)
  const penaltyStrokes = holes.reduce((sum, hole) => sum + (Number.isFinite(hole.penaltyStrokes) ? hole.penaltyStrokes : 0), 0)
  const obCount = holes.reduce((sum, hole) => sum + (Number.isFinite(hole.obCount) ? hole.obCount : 0), 0)
  const penaltyCount = holes.reduce((sum, hole) => sum + (Number.isFinite(hole.penaltyCount) ? hole.penaltyCount : 0), 0)
  const firHoles = holes.filter(hole => hole.par !== 3 && typeof hole.fir === 'boolean')
  const girHoles = holes.filter(hole => typeof hole.gir === 'boolean')
  const firHits = firHoles.filter(hole => hole.fir).length
  const girHits = girHoles.filter(hole => hole.gir).length
  const scoreDiffs = holesWithPar.map(hole => hole.score - hole.par)
  const outcomeCounts = new Map()
  scoreDiffs.forEach(value => {
    const key = value >= 3 ? 'triplePlus' : String(value)
    outcomeCounts.set(key, (outcomeCounts.get(key) || 0) + 1)
  })
  const scoreOutcomes = [...outcomeCounts.entries()]
    .map(([key, count]) => ({
      key,
      value: key === 'triplePlus' ? 3 : Number(key),
      label: scoreOutcomeLabel(key),
      count,
    }))
    .sort((a, b) => a.value - b.value)

  return {
    enteredHoles: holes.length,
    parRecordedHoles: holesWithPar.length,
    missingParHoles: holes.length - holesWithPar.length,
    totalScore,
    totalPar,
    toPar: holesWithPar.length ? scoreWithPar - totalPar : null,
    frontScore,
    backScore,
    frontToPar: frontHolesWithPar.length ? frontScoreWithPar - frontPar : null,
    backToPar: backHolesWithPar.length ? backScoreWithPar - backPar : null,
    parCount: scoreDiffs.filter(value => value === 0).length,
    bogeyCount: scoreDiffs.filter(value => value === 1).length,
    doubleBogeyCount: scoreDiffs.filter(value => value === 2).length,
    triplePlusCount: scoreDiffs.filter(value => value >= 3).length,
    scoreOutcomes,
    holeInOneCount: holes.filter(hole => hole.score === 1).length,
    totalPutts,
    puttAttempts: puttHoles.length,
    averagePutts: puttHoles.length ? totalPutts / puttHoles.length : null,
    onePuttCount: puttValues.filter(value => value === 1).length,
    twoPuttCount: puttValues.filter(value => value === 2).length,
    threePlusPuttCount: puttValues.filter(value => value >= 3).length,
    penaltyStrokes,
    obCount,
    penaltyCount,
    firHits,
    firAttempts: firHoles.length,
    girHits,
    girAttempts: girHoles.length,
  }
}

export function calculateCumulativeStats(rounds = []) {
  const completedRounds = rounds.filter(round => round?.status === 'completed')
  const roundSummaries = completedRounds.map(round => calculateRoundStats(round))
  const scoreSummaries = roundSummaries.filter(summary => summary.enteredHoles > 0)
  const totalScore = scoreSummaries.reduce((sum, summary) => sum + summary.totalScore, 0)
  const totalPutts = roundSummaries.reduce((sum, summary) => sum + summary.totalPutts, 0)
  const puttAttempts = roundSummaries.reduce((sum, summary) => sum + summary.puttAttempts, 0)
  const firHits = roundSummaries.reduce((sum, summary) => sum + summary.firHits, 0)
  const firAttempts = roundSummaries.reduce((sum, summary) => sum + summary.firAttempts, 0)
  const girHits = roundSummaries.reduce((sum, summary) => sum + summary.girHits, 0)
  const girAttempts = roundSummaries.reduce((sum, summary) => sum + summary.girAttempts, 0)

  return {
    roundCount: completedRounds.length,
    scoredRoundCount: scoreSummaries.length,
    averageScore: scoreSummaries.length ? totalScore / scoreSummaries.length : null,
    bestScore: scoreSummaries.length ? Math.min(...scoreSummaries.map(summary => summary.totalScore)) : null,
    totalPutts,
    puttAttempts,
    averagePutts: puttAttempts ? totalPutts / puttAttempts : null,
    firHits,
    firAttempts,
    girHits,
    girAttempts,
  }
}

function scoreOutcomeLabel(key) {
  if (key === 'triplePlus') return '트리플+'
  const value = Number(key)
  if (value <= -4) return `${value}`
  if (value === -3) return '알바트로스'
  if (value === -2) return '이글'
  if (value === -1) return '버디'
  if (value === 0) return '파'
  if (value === 1) return '보기'
  return '더블'
}

export function formatPercent(hits, attempts) {
  return attempts ? `${Math.round((hits / attempts) * 100)}%` : '—'
}
