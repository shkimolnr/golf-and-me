import database from './golfCourseDatabase.json' with { type: 'json' }

const teeKeys = { '블랙': 'black', '블루': 'blue', '화이트': 'white', '골드': 'gold', '레드': 'red' }

function normalize(value) {
  return (value || '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()
}

export function getKnownCourse(id) {
  return database.courses.find(course => course.id === id) || null
}

export function findKnownCourse(value) {
  const query = normalize(value)
  if (!query) return null
  return database.courses.find(course => normalize(course.name) === query || course.aliases.some(alias => normalize(alias) === query)) || null
}

export function searchKnownCourses(value) {
  const query = normalize(value)
  if (query.length < 2) return []
  return database.courses.filter(course => normalize(course.name).includes(query) || course.aliases.some(alias => normalize(alias).includes(query))).slice(0, 5)
}

function segmentOptionNames(course) {
  return course.segments.flatMap(segment => segment.holes.length >= 18
    ? [`${segment.name} OUT`, `${segment.name} IN`]
    : [segment.name])
}

export function segmentNamesForCourse(id) {
  const course = getKnownCourse(id)
  return course ? segmentOptionNames(course) : []
}

function legacyHalfName(course, value, half) {
  const segment = course.segments.find(item => normalize(item.name) === normalize(value))
  return segment?.holes.length >= 18 ? `${segment.name} ${half === 'front' ? 'OUT' : 'IN'}` : value
}

export function selectKnownCourse(course, currentRound) {
  const names = segmentOptionNames(course)
  const savedFrontName = legacyHalfName(course, currentRound.frontCourseName, 'front')
  const savedBackName = legacyHalfName(course, currentRound.backCourseName, 'back')
  const frontCourseName = names.includes(savedFrontName) ? savedFrontName : (names[0] || '')
  return {
    ...currentRound,
    courseId: course.id,
    courseName: course.name,
    frontCourseName,
    backCourseName: names.includes(savedBackName) ? savedBackName : (names[1] || frontCourseName),
  }
}

function resolveNineHoleSegment(course, value, fallbackHalf) {
  const direct = course.segments.find(segment => normalize(segment.name) === normalize(value))
  if (direct) {
    if (direct.holes.length === 9) return { segment: direct, holes: direct.holes }
    if (direct.holes.length >= 18) return {
      segment: direct,
      holes: fallbackHalf === 'front' ? direct.holes.slice(0, 9) : direct.holes.slice(-9),
    }
  }
  const derived = course.segments.find(segment => {
    if (segment.holes.length < 18) return false
    return normalize(`${segment.name} OUT`) === normalize(value) || normalize(`${segment.name} IN`) === normalize(value)
  })
  if (!derived) return { segment: null, holes: [] }
  const isOut = normalize(`${derived.name} OUT`) === normalize(value)
  return { segment: derived, holes: isOut ? derived.holes.slice(0, 9) : derived.holes.slice(-9) }
}

export function applyKnownCourseTemplate(round) {
  const course = getKnownCourse(round.courseId)
  if (!course) return round
  const front = resolveNineHoleSegment(course, round.frontCourseName, 'front')
  const back = resolveNineHoleSegment(course, round.backCourseName, 'back')
  const frontHoles = front.holes
  const backHoles = back.holes
  if (frontHoles.length !== 9 || backHoles.length !== 9) return round

  const teeKey = teeKeys[round.tee] || 'white'
  const unit = round.distanceUnit === 'YD' ? 'yd' : 'm'
  const templateId = `${database.version}:${course.id}:${round.frontCourseName}:${round.backCourseName}:${teeKey}:${unit}`
  if (round.courseTemplateId === templateId) return round
  const templateHoles = [...frontHoles, ...backHoles]
  return {
    ...round,
    courseId: course.id,
    courseName: course.name,
    distanceUnit: unit === 'yd' ? 'YD' : 'M',
    courseTemplateId: templateId,
    holes: round.holes.map((hole, index) => {
      const source = templateHoles[index]
      const distance = source.distances[teeKey]
      const oldSourceDistance = round.distanceUnit === 'YD' ? hole.sourceDistanceYards : hole.sourceDistanceMeters
      const distanceWasAutomatic = hole.distanceSource === 'course_database'
        || hole.distance == null
        || hole.distance === ''
        || (oldSourceDistance != null && Number(hole.distance) === oldSourceDistance)
        || (oldSourceDistance == null && hole.distance === 0 && Boolean(round.courseTemplateId))
      const parWasAutomatic = hole.parSource === 'course_database' || hole.sourcePar == null || hole.par === hole.sourcePar
      return {
        ...hole,
        par: parWasAutomatic ? source.par : hole.par,
        sourcePar: source.par,
        parSource: parWasAutomatic ? 'course_database' : 'user',
        distance: distanceWasAutomatic ? (distance?.[unit] ?? 0) : hole.distance,
        distanceSource: distanceWasAutomatic ? 'course_database' : 'user',
        sourceDistanceMeters: distance?.m ?? null,
        sourceDistanceYards: distance?.yd ?? null,
        sourceOfficialHole: source.number,
      }
    }),
  }
}

export { database as golfCourseDatabase }
