import { calculateRoundStats } from './roundStats.js'

function roundTimestamp(round) {
  return round?.updatedAt || round?.completedAt || round?.createdAt || ''
}

export function createRemoteRoundVersionMap(rounds = []) {
  return new Map(rounds.filter(round => round?.id).map(round => [String(round.id), roundTimestamp(round)]))
}

export function selectRoundsNeedingRemoteSave(rounds = [], remoteVersions = new Map()) {
  return rounds.filter(round => round?.id && remoteVersions.get(String(round.id)) !== roundTimestamp(round))
}

export function markRoundsAsRemoteSaved(remoteVersions, rounds = []) {
  const nextVersions = new Map(remoteVersions)
  rounds.forEach(round => {
    if (!round?.id) return
    const id = String(round.id)
    const nextTimestamp = roundTimestamp(round)
    const currentTimestamp = nextVersions.get(id) || ''
    if (nextTimestamp >= currentTimestamp) nextVersions.set(id, nextTimestamp)
  })
  return nextVersions
}

function timestampValue(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

export function sortRoundsForList(rounds = [], status = 'in_progress') {
  return [...rounds].sort((left, right) => {
    const leftTimestamp = status === 'completed'
      ? left.playedAt || left.completedAt || left.updatedAt || left.createdAt
      : left.updatedAt || left.createdAt || left.playedAt
    const rightTimestamp = status === 'completed'
      ? right.playedAt || right.completedAt || right.updatedAt || right.createdAt
      : right.updatedAt || right.createdAt || right.playedAt
    const timestampDifference = timestampValue(rightTimestamp) - timestampValue(leftTimestamp)
    if (timestampDifference) return timestampDifference
    return String(left.id || '').localeCompare(String(right.id || ''))
  })
}

export function mergeRoundCollections(localRounds = [], remoteRounds = []) {
  const merged = new Map(localRounds.map(round => [round.id, round]))

  remoteRounds.forEach(remoteRound => {
    const localRound = merged.get(remoteRound.id)
    if (!localRound || roundTimestamp(remoteRound) > roundTimestamp(localRound)) {
      merged.set(remoteRound.id, remoteRound)
    }
  })

  return [...merged.values()]
}

export function resolveOnboardingProfile(localProfile, remoteProfile) {
  if (remoteProfile?.onboardingCompleted) {
    return {
      completed: true,
      defaultTee: remoteProfile.defaultTee || '화이트',
      defaultDistanceUnit: remoteProfile.defaultDistanceUnit || 'M',
      shouldSaveRemote: false,
    }
  }

  if (localProfile?.defaultTee) {
    return {
      completed: true,
      defaultTee: localProfile.defaultTee,
      defaultDistanceUnit: localProfile.defaultDistanceUnit || 'M',
      shouldSaveRemote: true,
    }
  }

  return { completed: false, defaultTee: '화이트', defaultDistanceUnit: 'M', shouldSaveRemote: false }
}

export function serializeRoundRow(userId, round) {
  const updatedAt = roundTimestamp(round) || '1970-01-01T00:00:00.000Z'
  const summary = calculateRoundStats(round)
  return {
    id: String(round.id),
    user_id: userId,
    course_id: round.courseId || null,
    course_name: round.courseName || '',
    front_course_name: round.frontCourseName || '',
    back_course_name: round.backCourseName || '',
    tee: round.tee || '화이트',
    distance_unit: round.distanceUnit || 'M',
    played_at_local: round.playedAt || null,
    status: round.status === 'completed' ? 'completed' : 'in_progress',
    completed_at: round.completedAt || null,
    entered_holes: summary.enteredHoles,
    par_recorded_holes: summary.parRecordedHoles,
    total_score: summary.enteredHoles ? summary.totalScore : null,
    score_to_par: summary.toPar,
    total_putts: summary.puttAttempts ? summary.totalPutts : null,
    putt_attempts: summary.puttAttempts,
    fir_hits: summary.firHits,
    fir_attempts: summary.firAttempts,
    gir_hits: summary.girHits,
    gir_attempts: summary.girAttempts,
    stats_summary: summary,
    payload: round,
    updated_at: updatedAt,
  }
}

export async function loadRemoteRounds(client, userId) {
  const { data, error } = await client
    .from('rounds')
    .select('payload')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return (data || []).map(row => row.payload).filter(Boolean)
}

export async function saveRemoteRounds(client, userId, rounds) {
  if (!rounds.length) return
  const rows = rounds.map(round => serializeRoundRow(userId, round))
  let { error } = await client
    .from('rounds')
    .upsert(rows, { onConflict: 'id' })

  if (error?.code === '42703' || error?.code === 'PGRST204') {
    const legacyRows = rows.map(({
      entered_holes: _enteredHoles,
      par_recorded_holes: _parRecordedHoles,
      total_score: _totalScore,
      score_to_par: _scoreToPar,
      total_putts: _totalPutts,
      putt_attempts: _puttAttempts,
      fir_hits: _firHits,
      fir_attempts: _firAttempts,
      gir_hits: _girHits,
      gir_attempts: _girAttempts,
      stats_summary: _statsSummary,
      ...legacyRow
    }) => legacyRow)
    const legacyResult = await client.from('rounds').upsert(legacyRows, { onConflict: 'id' })
    error = legacyResult.error
  }

  if (error) throw error
}

export async function deleteRemoteRound(client, userId, roundId) {
  const { error } = await client
    .from('rounds')
    .delete()
    .eq('user_id', userId)
    .eq('id', String(roundId))

  if (error) throw error
}

export async function loadRemoteProfile(client, userId) {
  let { data, error } = await client
    .from('profiles')
    .select('default_tee, default_distance_unit, onboarding_completed')
    .eq('id', userId)
    .maybeSingle()

  if (error?.code === '42703') {
    const legacyResult = await client
      .from('profiles')
      .select('default_tee, onboarding_completed')
      .eq('id', userId)
      .maybeSingle()
    data = legacyResult.data
    error = legacyResult.error
  }
  if (error) throw error
  if (!data) return null
  return {
    defaultTee: data.default_tee || '화이트',
    defaultDistanceUnit: data.default_distance_unit || 'M',
    onboardingCompleted: Boolean(data.onboarding_completed),
  }
}

export async function saveRemoteProfile(client, userId, profile) {
  const row = {
    id: userId,
    default_tee: profile.defaultTee || '화이트',
    default_distance_unit: profile.defaultDistanceUnit || 'M',
    onboarding_completed: true,
    updated_at: new Date().toISOString(),
  }
  let { error } = await client
    .from('profiles')
    .upsert(row, { onConflict: 'id' })

  if (error?.code === '42703') {
    const { default_distance_unit: _ignored, ...legacyRow } = row
    const legacyResult = await client.from('profiles').upsert(legacyRow, { onConflict: 'id' })
    error = legacyResult.error
  }
  if (error) throw error
}
