import { applyKnownCourseTemplate, getKnownCourse } from './courseData.js'

function baseHoles() {
  return Array.from({ length: 18 }, (_, index) => ({
    holeNumber: index + 1,
    par: null,
    swingCount: null,
    score: null,
    putts: null,
    fir: undefined,
    gir: undefined,
    obCount: 0,
    penaltyCount: 0,
    penaltyStrokes: 0,
  }))
}

function recordedHole(hole, score, index) {
  const suggestedPutts = index % 5 === 0 ? 1 : index % 4 === 0 ? 3 : 2
  const putts = Math.min(suggestedPutts, Math.max(0, score - 1))
  const requestedTrouble = index % 9 === 1 ? 'penalty' : index % 9 === 4 ? 'ob_replay' : index % 9 === 7 ? 'ob_forward' : null
  const requestedPenaltyStrokes = requestedTrouble === 'penalty' || requestedTrouble === 'ob_replay' ? 1 : requestedTrouble === 'ob_forward' ? 2 : 0
  const canUseTrouble = score - putts - requestedPenaltyStrokes >= (requestedTrouble === 'ob_replay' ? 2 : 1)
  const trouble = canUseTrouble ? requestedTrouble : null
  const penaltyStrokes = trouble === 'penalty' || trouble === 'ob_replay' ? 1 : trouble === 'ob_forward' ? 2 : 0
  const swingCount = Math.max(1, score - putts - penaltyStrokes)
  const clubs = hole.par === 3 ? ['7아이언', 'PW', 'SW'] : ['드라이버', '유틸리티', 'PW', 'SW']
  const shots = Array.from({ length: swingCount }, (_, shotIndex) => ({
    sequence: shotIndex + 1,
    club: clubs[Math.min(shotIndex, clubs.length - 1)],
    remainingDistance: shotIndex === 0 ? '' : Math.max(18, Math.round((hole.distance || 300) / (shotIndex + 2))),
    troubleDirection: null,
    troubleType: null,
    obRelief: null,
    provisionalFor: null,
  }))
  if (trouble === 'penalty') {
    shots[0].troubleDirection = index % 2 ? 'right' : 'left'
    shots[0].troubleType = 'penalty'
  }
  if (trouble === 'ob_replay' || trouble === 'ob_forward') {
    shots[0].troubleDirection = index % 2 ? 'right' : 'left'
    shots[0].troubleType = 'ob'
    shots[0].obRelief = trouble === 'ob_replay' ? 'replay' : 'forward'
    if (trouble === 'ob_replay' && shots[1]) shots[1].provisionalFor = 0
  }
  return {
    ...hole,
    shots,
    putts,
    puttingDistance: index % 3 === 0 ? 8 : 5,
    puttingSteps: index % 3 === 0 ? 10 : 7,
    swingCount,
    obCount: trouble?.startsWith('ob_') ? 1 : 0,
    penaltyCount: trouble === 'penalty' ? 1 : 0,
    penaltyStrokes,
    score,
    fir: hole.par === 3 ? null : !trouble,
    gir: swingCount + penaltyStrokes <= hole.par - 2,
  }
}

function makeRound({ id, courseId, front, back, tee, playedAt, status, scoreOffsets, enteredCount = 18 }) {
  const course = getKnownCourse(courseId)
  const round = applyKnownCourseTemplate({
    id,
    courseId,
    courseName: course.name,
    frontCourseName: front,
    backCourseName: back,
    courseNameDetail: `${front} / ${back}`,
    tee,
    distanceUnit: 'M',
    playedAt,
    companionMemo: '',
    status,
    createdAt: `${playedAt}:00+09:00`,
    holes: baseHoles(),
  })
  return {
    ...round,
    holes: round.holes.map((hole, index) => index < enteredCount ? recordedHole(hole, hole.par + scoreOffsets[index % scoreOffsets.length], index) : hole),
  }
}

function makeManualTrinityRound() {
  const pars = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4]
  const scoreOffsets = [0, 1, 0, 2, -1, 1, 0, 2, 1, 0, 1, -1, 2, 0, 1, 0, 2, 1]
  const holes = baseHoles().map((hole, index) => {
    const par = pars[index]
    const hasHoleDistance = index % 2 === 0
    const distance = hasHoleDistance
      ? (par === 3 ? 135 + index * 2 : par === 5 ? 425 + index * 3 : 305 + index * 3)
      : null
    return recordedHole({
      ...hole,
      par,
      parSource: 'user',
      distance,
      distanceSource: hasHoleDistance ? 'user' : null,
    }, par + scoreOffsets[index], index)
  })
  return {
    id: 'preview-trinity-manual-draft',
    courseId: null,
    courseName: '트리니티클럽',
    frontCourseName: 'OUT',
    backCourseName: 'IN',
    courseNameDetail: 'OUT / IN',
    tee: '레드',
    distanceUnit: 'M',
    playedAt: '2026-08-30T10:55',
    companionMemo: '',
    status: 'completed',
    createdAt: '2026-08-30T10:55:00+09:00',
    holes,
  }
}

function makeManualTrinityMissingParRound() {
  const baseRound = makeManualTrinityRound()
  const missingParIndexes = new Set([3, 10, 16])
  return {
    ...baseRound,
    id: 'preview-trinity-missing-par-complete',
    playedAt: '2026-08-30T11:20',
    createdAt: '2026-08-30T11:20:00+09:00',
    holes: baseRound.holes.map((hole, index) => missingParIndexes.has(index)
      ? { ...hole, par: null, parSource: null, sourcePar: null }
      : hole),
  }
}

export const PREVIEW_ROUNDS_VERSION = '8'

export function createPreviewRounds() {
  return [
    makeRound({ id: 'preview-lakeside-draft', courseId: 'lakeside', front: 'IN', back: 'OUT', tee: '레드', playedAt: '2026-08-28T06:28', status: 'in_progress', scoreOffsets: [0, 1, 0, -1, 1], enteredCount: 11 }),
    makeRound({ id: 'preview-eastvalley-draft', courseId: 'eastvalley', front: '동코스', back: '남코스', tee: '레드', playedAt: '2026-08-29T07:12', status: 'in_progress', scoreOffsets: [1, 0, 2, 0], enteredCount: 7 }),
    makeRound({ id: 'preview-plaza-yongin-draft', courseId: 'plaza-yongin', front: 'TIGER OUT', back: 'TIGER IN', tee: '레드', playedAt: '2026-08-30T07:08', status: 'in_progress', scoreOffsets: [0, 1, -1, 0], enteredCount: 4 }),
    makeManualTrinityRound(),
    makeManualTrinityMissingParRound(),
    makeRound({ id: 'preview-lakeside-high-score', courseId: 'lakeside', front: 'OUT', back: 'IN', tee: '레드', playedAt: '2026-08-30T08:18', status: 'completed', scoreOffsets: [-2, -4, -1, 5, 0, 1, -3, 2, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5] }),
    makeRound({ id: 'preview-lakeside-balanced-high-score', courseId: 'lakeside', front: 'OUT', back: 'IN', tee: '레드', playedAt: '2026-08-30T08:28', status: 'completed', scoreOffsets: [-1, 0, 1, 2, 3, 5] }),
    makeRound({ id: 'preview-namseoul-complete', courseId: 'namseoul', front: 'OUT', back: 'IN', tee: '화이트', playedAt: '2026-08-17T07:04', status: 'completed', scoreOffsets: [0, 1, 0, 1, 2] }),
    makeRound({ id: 'preview-arumdaun-complete', courseId: 'sg-arumdaun', front: 'HILL', back: 'LAKE', tee: '레드', playedAt: '2026-08-09T06:52', status: 'completed', scoreOffsets: [1, 0, 1, -1, 2, 0] }),
    makeRound({ id: 'preview-eunhwasam-complete', courseId: 'eunhwasam', front: 'WEST', back: 'EAST', tee: '화이트', playedAt: '2026-08-03T06:41', status: 'completed', scoreOffsets: [1, 0, 1, 2, 0, -1] }),
  ]
}

export function mergePreviewRounds(existingRounds, refreshIds = []) {
  const previewRounds = createPreviewRounds()
  const refreshSet = new Set(refreshIds)
  const retainedRounds = (Array.isArray(existingRounds) ? existingRounds : []).filter(item => !refreshSet.has(item.id))
  const existingRoundIds = new Set(retainedRounds.map(item => item.id))
  return [...retainedRounds, ...previewRounds.filter(item => !existingRoundIds.has(item.id))]
}
