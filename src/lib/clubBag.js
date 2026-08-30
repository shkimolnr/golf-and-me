export function createDistanceSet({
  clubs = [],
  inputs = {},
  normalizedInputs = {},
  previousSet = null,
  basis = null,
  unit = 'M',
  id,
  recordedAt,
}) {
  const measuredClubs = clubs.filter(club => club.category !== '퍼터')
  const changedClubIds = measuredClubs
    .filter(club => inputs[club.id] !== '' && inputs[club.id] != null)
    .map(club => club.id)

  if (!changedClubIds.length) return null

  const canInherit = Boolean(previousSet && previousSet.basis === basis)
  const distances = Object.fromEntries(measuredClubs.map(club => {
    const entered = inputs[club.id]
    if (entered !== '' && entered != null) return [club.id, Number(entered)]
    if (!canInherit) return [club.id, null]
    const previousDistance = previousSet.distances?.[club.id]
    return [club.id, previousDistance == null ? null : convertDistance(previousDistance, previousSet.unit, unit)]
  }))
  const distancesM = Object.fromEntries(measuredClubs.map(club => {
    const entered = inputs[club.id]
    if (entered !== '' && entered != null) {
      const normalized = Number(normalizedInputs[club.id])
      return [club.id, Number.isFinite(normalized) ? normalized : distanceToMeters(entered, unit)]
    }
    if (!canInherit) return [club.id, null]
    const previousNormalized = Number(previousSet.distancesM?.[club.id])
    if (Number.isFinite(previousNormalized)) return [club.id, previousNormalized]
    const previousDistance = previousSet.distances?.[club.id]
    return [club.id, previousDistance == null ? null : distanceToMeters(previousDistance, previousSet.unit)]
  }))

  return {
    id,
    recordedAt,
    unit,
    basis,
    clubs: measuredClubs.map(club => ({ ...club })),
    distances,
    distancesM,
    changedClubIds,
  }
}

const YARDS_PER_METER = 1.0936133

export function distanceToMeters(value, unit = 'M') {
  const distance = Number(value)
  if (!Number.isFinite(distance)) return null
  return unit === 'YD' ? distance / YARDS_PER_METER : distance
}

export function distanceFromMeters(value, unit = 'M') {
  const distance = Number(value)
  if (!Number.isFinite(distance)) return null
  return Math.round(unit === 'YD' ? distance * YARDS_PER_METER : distance)
}

export function convertDistance(value, fromUnit = 'M', toUnit = 'M') {
  return distanceFromMeters(distanceToMeters(value, fromUnit), toUnit)
}

const categoryOrder = new Map([
  ['드라이버·우드', 0],
  ['유틸리티', 1],
  ['아이언', 2],
  ['웨지', 3],
  ['퍼터', 4],
])

function clubValueOrder(club) {
  if (club.category === '드라이버·우드') {
    if (club.value === '1' || club.label === 'D') return 0
    const number = Number.parseInt(club.value ?? club.label, 10)
    return Number.isFinite(number) ? number : 900
  }
  if (club.category === '유틸리티' || club.category === '아이언') {
    const number = Number.parseInt(club.value ?? club.label, 10)
    return Number.isFinite(number) ? number : 900
  }
  if (club.category === '웨지') {
    const namedOrder = { P: 0, A: 1, S: 2, L: 3 }
    const normalized = String(club.value ?? club.label ?? '').toUpperCase()
    if (normalized in namedOrder) return namedOrder[normalized]
    const loft = Number.parseInt(normalized, 10)
    return Number.isFinite(loft) ? 100 + loft : 900
  }
  return 0
}

export function compareClubOrder(left, right) {
  const categoryDifference = (categoryOrder.get(left.category) ?? 99) - (categoryOrder.get(right.category) ?? 99)
  if (categoryDifference) return categoryDifference
  const valueDifference = clubValueOrder(left) - clubValueOrder(right)
  if (valueDifference) return valueDifference
  return String(left.label || '').localeCompare(String(right.label || ''), 'ko', { numeric: true })
}

export function pairClubsForColumnLayout(clubs = []) {
  const orderedClubs = [...clubs].sort(compareClubOrder)
  const rowCount = Math.ceil(orderedClubs.length / 2)
  return Array.from({ length: rowCount }, (_, index) => [
    orderedClubs[index],
    orderedClubs[index + rowCount],
  ])
}
