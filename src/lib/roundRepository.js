import { calculateRoundStats } from './roundStats.js'

function roundTimestamp(round) {
  return round?.updatedAt || round?.completedAt || round?.createdAt || ''
}

export function createRemoteRoundVersionMap(rounds = []) {
  return new Map(rounds.filter(round => round?.id).map(round => [String(round.id), roundTimestamp(round)]))
}

export function selectRoundsNeedingRemoteSave(rounds = [], remoteVersions = new Map(), deletedRoundIds = []) {
  const deleted = new Set((deletedRoundIds || []).map(String))
  return rounds.filter(round => round?.id
    && !deleted.has(String(round.id))
    && remoteVersions.get(String(round.id)) !== roundTimestamp(round))
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

export function mergeRoundCollectionsWithDeletions(localRounds = [], remoteRounds = [], deletedRoundIds = []) {
  const deleted = new Set((deletedRoundIds || []).map(String))
  return mergeRoundCollections(localRounds, remoteRounds)
    .filter(round => round?.id && !deleted.has(String(round.id)))
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

const roundSummaryColumns = [
  'id', 'course_id', 'course_name', 'front_course_name', 'back_course_name', 'tee', 'distance_unit',
  'played_at_local', 'status', 'completed_at', 'updated_at', 'entered_holes', 'par_recorded_holes',
  'total_score', 'score_to_par', 'total_putts', 'putt_attempts', 'fir_hits', 'fir_attempts',
  'gir_hits', 'gir_attempts', 'stats_summary',
].join(', ')

function missingRoundSummarySchema(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  return ['42703', 'PGRST200', 'PGRST204'].includes(code)
    || (message.includes('column') && ['entered_holes', 'stats_summary'].some(column => message.includes(column)))
}

export function deserializeRemoteRoundSummary(row) {
  const statsSummary = {
    enteredHoles: Number(row.entered_holes) || 0,
    parRecordedHoles: Number(row.par_recorded_holes) || 0,
    missingParHoles: Math.max(0, (Number(row.entered_holes) || 0) - (Number(row.par_recorded_holes) || 0)),
    totalScore: row.total_score == null ? 0 : Number(row.total_score),
    toPar: row.score_to_par == null ? null : Number(row.score_to_par),
    totalPutts: row.total_putts == null ? 0 : Number(row.total_putts),
    puttAttempts: Number(row.putt_attempts) || 0,
    firHits: Number(row.fir_hits) || 0,
    firAttempts: Number(row.fir_attempts) || 0,
    girHits: Number(row.gir_hits) || 0,
    girAttempts: Number(row.gir_attempts) || 0,
    ...(row.stats_summary && typeof row.stats_summary === 'object' ? row.stats_summary : {}),
  }
  return {
    id: row.id,
    courseId: row.course_id || null,
    courseName: row.course_name || '',
    frontCourseName: row.front_course_name || '',
    backCourseName: row.back_course_name || '',
    tee: row.tee || '화이트',
    distanceUnit: row.distance_unit || 'M',
    playedAt: row.played_at_local || null,
    status: row.status === 'completed' ? 'completed' : 'in_progress',
    completedAt: row.completed_at || null,
    updatedAt: row.updated_at || null,
    holes: [],
    statsSummary,
    remoteSummaryOnly: true,
  }
}

async function loadLegacyRemoteRounds(client, userId) {
  const { data, error } = await client
    .from('rounds')
    .select('payload')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return (data || []).map(row => row.payload).filter(Boolean)
}

export async function loadRemoteRounds(client, userId) {
  const [{ data: draftRows, error: draftError }, { data: completedRows, error: completedError }] = await Promise.all([
    client.from('rounds').select('payload').eq('user_id', userId).eq('status', 'in_progress').order('updated_at', { ascending: false }),
    client.from('rounds').select(roundSummaryColumns).eq('user_id', userId).eq('status', 'completed').order('played_at_local', { ascending: false }),
  ])

  if (missingRoundSummarySchema(completedError)) return loadLegacyRemoteRounds(client, userId)
  if (draftError) throw draftError
  if (completedError) throw completedError
  return [
    ...(draftRows || []).map(row => row.payload).filter(Boolean),
    ...(completedRows || []).map(deserializeRemoteRoundSummary),
  ]
}

export async function loadRemoteRoundTombstones(client, userId) {
  const { data, error } = await client
    .from('round_tombstones')
    .select('round_id, deleted_at')
    .eq('user_id', userId)
    .order('deleted_at', { ascending: false })
  if (error) throw error
  return (data || []).map(row => ({
    id: String(row.round_id),
    deletedAt: row.deleted_at || null,
  }))
}

export async function loadRemoteRoundSyncState(client, userId) {
  const [rounds, tombstones] = await Promise.all([
    loadRemoteRounds(client, userId),
    loadRemoteRoundTombstones(client, userId),
  ])
  return { rounds, tombstones }
}

export async function loadRemoteRoundTombstone(client, userId, roundId) {
  const { data, error } = await client
    .from('round_tombstones')
    .select('round_id, deleted_at')
    .eq('user_id', userId)
    .eq('round_id', String(roundId))
    .maybeSingle()
  if (error) throw error
  return data ? { id: String(data.round_id), deletedAt: data.deleted_at || null } : null
}

export async function loadRemoteRoundDetail(client, userId, roundId) {
  const { data, error } = await client
    .from('rounds')
    .select('payload')
    .eq('user_id', userId)
    .eq('id', String(roundId))
    .maybeSingle()
  if (error) throw error
  return data?.payload || null
}

export async function saveRemoteRounds(client, userId, rounds, deletedRoundIds = []) {
  const deleted = new Set((deletedRoundIds || []).map(String))
  const safeRounds = (rounds || []).filter(round => round?.id && !deleted.has(String(round.id)))
  if (!safeRounds.length) return
  const rows = safeRounds.map(round => serializeRoundRow(userId, round))
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
  const tombstone = await loadRemoteRoundTombstone(client, userId, roundId)
  if (!tombstone) {
    const confirmationError = new Error('round_delete_not_confirmed')
    confirmationError.code = 'ROUND_DELETE_NOT_CONFIRMED'
    throw confirmationError
  }
  return tombstone
}

export function isRoundTombstonedError(error) {
  return String(error?.code || '') === '23505'
    && /round_tombstoned|rounds_tombstone_guard/i.test(
      `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`,
    )
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
