function roundTimestamp(round) {
  return round?.updatedAt || round?.completedAt || round?.createdAt || ''
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
      shouldSaveRemote: false,
    }
  }

  if (localProfile?.defaultTee) {
    return {
      completed: true,
      defaultTee: localProfile.defaultTee,
      shouldSaveRemote: true,
    }
  }

  return { completed: false, defaultTee: '화이트', shouldSaveRemote: false }
}

export function serializeRoundRow(userId, round) {
  const updatedAt = roundTimestamp(round) || '1970-01-01T00:00:00.000Z'
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
  const { error } = await client
    .from('rounds')
    .upsert(rounds.map(round => serializeRoundRow(userId, round)), { onConflict: 'id' })

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
  const { data, error } = await client
    .from('profiles')
    .select('default_tee, onboarding_completed')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return { defaultTee: data.default_tee || '화이트', onboardingCompleted: Boolean(data.onboarding_completed) }
}

export async function saveRemoteProfile(client, userId, profile) {
  const { error } = await client
    .from('profiles')
    .upsert({
      id: userId,
      default_tee: profile.defaultTee || '화이트',
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

  if (error) throw error
}
