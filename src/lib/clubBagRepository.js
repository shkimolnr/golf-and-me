import { compareClubOrder, distanceToMeters } from './clubBag.js'

function timestampValue(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

function newestTimestamp(values = []) {
  return values.reduce((latest, value) => timestampValue(value) > timestampValue(latest) ? value : latest, '')
}

export function mergeDistanceSets(localSets = [], remoteSets = []) {
  const sets = new Map()
  ;[...remoteSets, ...localSets].forEach(set => {
    if (!set?.id) return
    const current = sets.get(set.id)
    if (!current || timestampValue(set.recordedAt) >= timestampValue(current.recordedAt)) sets.set(set.id, set)
  })
  return [...sets.values()].sort((left, right) => timestampValue(right.recordedAt) - timestampValue(left.recordedAt))
}

export function resolveClubBag(localBag, remoteBag) {
  const hasRemoteConfiguration = Boolean(remoteBag?.compositionCompleted || remoteBag?.clubs?.length)
  const useLocalConfiguration = !hasRemoteConfiguration || timestampValue(localBag?.updatedAt) > timestampValue(remoteBag?.updatedAt)
  const configuration = useLocalConfiguration ? localBag : remoteBag
  const distanceSets = mergeDistanceSets(localBag?.distanceSets, remoteBag?.distanceSets)
  const activeClubIds = new Set((configuration?.clubs || []).map(club => String(club.id)))
  const inactiveClubs = [...(remoteBag?.inactiveClubs || []), ...(localBag?.inactiveClubs || [])]
    .filter((club, index, clubs) => club?.id && clubs.findIndex(item => String(item.id) === String(club.id)) === index)
    .filter(club => !activeClubIds.has(String(club.id)))
    .sort(compareClubOrder)

  return {
    clubs: configuration?.clubs || [],
    inactiveClubs,
    compositionCompleted: Boolean(configuration?.compositionCompleted),
    distanceUnit: distanceSets[0]?.unit || configuration?.distanceUnit || 'M',
    distanceSets,
    updatedAt: configuration?.updatedAt || null,
    shouldSaveRemote: useLocalConfiguration || distanceSets.length > (remoteBag?.distanceSets?.length || 0),
  }
}

export function clubBagSyncSignature(bag = {}) {
  const activeIds = (bag.clubs || []).map(club => String(club.id)).sort()
  const inactiveIds = (bag.inactiveClubs || []).map(club => String(club.id)).sort()
  const distanceSets = (bag.distanceSets || [])
    .map(set => `${String(set.id)}:${set.recordedAt || ''}`)
    .sort()
  return JSON.stringify({
    activeIds,
    inactiveIds,
    compositionCompleted: Boolean(bag.compositionCompleted),
    updatedAt: bag.updatedAt || null,
    distanceSets,
  })
}

function restoreClub(row) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {}
  return {
    id: row.client_id,
    category: payload.category || row.category || '',
    value: payload.value || row.name,
    label: payload.label || row.name,
    custom: Boolean(payload.custom),
  }
}

export function deserializeRemoteClubBag(clubRows = [], distanceRows = []) {
  const activeClubRows = clubRows.filter(row => row.active)
  const inactiveClubRows = clubRows.filter(row => !row.active)
  const clubsByRemoteId = new Map(clubRows.map(row => [row.id, restoreClub(row)]))
  const groupedSets = new Map()

  distanceRows.forEach(row => {
    if (!row.set_id) return
    const club = row.club_snapshot && Object.keys(row.club_snapshot).length
      ? row.club_snapshot
      : clubsByRemoteId.get(row.club_id)
    if (!club?.id) return
    const set = groupedSets.get(row.set_id) || {
      id: row.set_id,
      recordedAt: row.recorded_at,
      unit: row.distance_unit || 'M',
      basis: row.distance_basis || null,
      clubs: [],
      distances: {},
      distancesM: {},
      changedClubIds: [],
    }
    if (!set.clubs.some(item => item.id === club.id)) set.clubs.push(club)
    set.distances[club.id] = row.distance == null ? null : Number(row.distance)
    set.distancesM[club.id] = row.normalized_distance_m == null
      ? (row.distance == null ? null : distanceToMeters(row.distance, row.distance_unit))
      : Number(row.normalized_distance_m)
    if (row.is_changed) set.changedClubIds.push(club.id)
    groupedSets.set(row.set_id, set)
  })

  const distanceSets = [...groupedSets.values()]
    .map(set => ({ ...set, clubs: [...set.clubs].sort(compareClubOrder) }))
    .sort((left, right) => timestampValue(right.recordedAt) - timestampValue(left.recordedAt))

  return {
    clubs: activeClubRows.map(restoreClub).sort(compareClubOrder),
    inactiveClubs: inactiveClubRows.map(restoreClub).sort(compareClubOrder),
    compositionCompleted: activeClubRows.length > 0,
    distanceUnit: distanceSets[0]?.unit || 'M',
    distanceSets,
    updatedAt: newestTimestamp(clubRows.map(row => row.updated_at)),
  }
}

export async function loadRemoteClubBag(client, userId) {
  const [{ data: clubRows, error: clubError }, { data: latestDistanceRows, error: latestDistanceError }] = await Promise.all([
    client.from('user_clubs').select('id, client_id, name, category, sort_order, active, payload, updated_at').eq('user_id', userId),
    client.from('club_distance_history').select('set_id, recorded_at').eq('user_id', userId).order('recorded_at', { ascending: false }).limit(1),
  ])
  if (clubError) throw clubError
  if (latestDistanceError) throw latestDistanceError
  const latestSetId = latestDistanceRows?.[0]?.set_id
  let distanceRows = []
  if (latestSetId) {
    const { data, error } = await client
      .from('club_distance_history')
      .select('set_id, club_id, distance, distance_unit, distance_basis, normalized_distance_m, club_snapshot, is_changed, recorded_at')
      .eq('user_id', userId)
      .eq('set_id', latestSetId)
      .order('recorded_at', { ascending: false })
    if (error) throw error
    distanceRows = data || []
  }
  return deserializeRemoteClubBag(clubRows || [], distanceRows || [])
}

export async function loadRemoteClubDistanceHistory(client, userId) {
  const { data, error } = await client
    .from('club_distance_history')
    .select('set_id, club_id, distance, distance_unit, distance_basis, normalized_distance_m, club_snapshot, is_changed, recorded_at')
    .eq('user_id', userId)
    .order('recorded_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveRemoteClubBag(client, userId, bag) {
  const activeIds = new Set(bag.compositionCompleted ? (bag.clubs || []).map(club => club.id) : [])
  const allClubs = new Map()
  ;(bag.clubs || []).forEach(club => allClubs.set(club.id, club))
  ;(bag.inactiveClubs || []).forEach(club => allClubs.set(club.id, club))
  ;(bag.distanceSets || []).forEach(set => (set.clubs || []).forEach(club => allClubs.set(club.id, club)))
  if (!allClubs.size) return

  const updatedAt = bag.updatedAt || new Date().toISOString()
  const orderedClubs = [...allClubs.values()].sort(compareClubOrder)
  const { data: existingClubs, error: existingClubError } = await client
    .from('user_clubs')
    .select('id, client_id, active, updated_at')
    .eq('user_id', userId)
  if (existingClubError) throw existingClubError
  const remoteUpdatedAt = newestTimestamp((existingClubs || []).map(row => row.updated_at))
  const shouldSaveConfiguration = !remoteUpdatedAt || timestampValue(updatedAt) >= timestampValue(remoteUpdatedAt)

  if (shouldSaveConfiguration) {
    const clubRows = orderedClubs.map((club, index) => ({
      user_id: userId,
      client_id: String(club.id),
      name: club.label,
      category: club.category,
      sort_order: index,
      active: activeIds.has(club.id),
      payload: club,
      updated_at: updatedAt,
    }))
    const { error: clubSaveError } = await client.from('user_clubs').upsert(clubRows, { onConflict: 'user_id,client_id' })
    if (clubSaveError) throw clubSaveError

    // 새 구성을 먼저 안전하게 저장한 뒤 더 이상 쓰지 않는 기존 클럽만
    // 비활성화한다. 네트워크 오류가 나도 전체 구성이 잠시 사라지지 않게 한다.
    const obsoleteRemoteIds = (existingClubs || [])
      .filter(row => row.active && !activeIds.has(row.client_id))
      .map(row => row.id)
    if (obsoleteRemoteIds.length) {
      const { error: deactivateError } = await client
        .from('user_clubs')
        .update({ active: false, updated_at: updatedAt })
        .eq('user_id', userId)
        .in('id', obsoleteRemoteIds)
      if (deactivateError) throw deactivateError
    }
  } else {
    const existingClientIds = new Set((existingClubs || []).map(row => row.client_id))
    const missingHistoricalClubs = orderedClubs.filter(club => !existingClientIds.has(String(club.id)))
    if (missingHistoricalClubs.length) {
      const { error: historicalClubError } = await client.from('user_clubs').upsert(missingHistoricalClubs.map((club, index) => ({
        user_id: userId,
        client_id: String(club.id),
        name: club.label,
        category: club.category,
        sort_order: orderedClubs.length + index,
        active: false,
        payload: club,
        updated_at: remoteUpdatedAt,
      })), { onConflict: 'user_id,client_id' })
      if (historicalClubError) throw historicalClubError
    }
  }

  const { data: savedClubs, error: clubLoadError } = await client
    .from('user_clubs')
    .select('id, client_id')
    .eq('user_id', userId)
    .in('client_id', orderedClubs.map(club => String(club.id)))
  if (clubLoadError) throw clubLoadError
  const remoteIds = new Map((savedClubs || []).map(row => [row.client_id, row.id]))

  const distanceRows = (bag.distanceSets || []).flatMap(set => (set.clubs || []).map(club => ({
    user_id: userId,
    set_id: String(set.id),
    club_id: remoteIds.get(String(club.id)),
    distance: set.distances?.[club.id] ?? null,
    distance_unit: set.unit || 'M',
    distance_basis: set.basis || null,
    normalized_distance_m: set.distancesM?.[club.id] ?? (set.distances?.[club.id] == null ? null : distanceToMeters(set.distances[club.id], set.unit)),
    source: 'manual',
    recorded_at: set.recordedAt,
    club_snapshot: club,
    is_changed: Boolean(set.changedClubIds?.includes(club.id)),
  })).filter(row => row.club_id))

  if (!distanceRows.length) return
  const { error: distanceError } = await client
    .from('club_distance_history')
    .upsert(distanceRows, { onConflict: 'user_id,set_id,club_id' })
  if (distanceError) throw distanceError
}
