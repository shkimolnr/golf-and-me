import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyKnownCourseTemplate,
  findKnownCourse,
  getKnownCourse,
  searchKnownCourses,
  segmentNamesForCourse,
  selectKnownCourse,
} from '../src/data/courseData.js'

function emptyRound(overrides = {}) {
  return {
    courseId: null,
    courseName: '',
    frontCourseName: '',
    backCourseName: '',
    tee: '레드',
    distanceUnit: 'M',
    holes: Array.from({ length: 18 }, (_, index) => ({ holeNumber: index + 1, par: null, distance: null })),
    ...overrides,
  }
}

test('기존 레이크사이드 데이터는 유지된다', () => {
  const course = getKnownCourse('lakeside')
  assert.equal(course.name, '레이크사이드 컨트리클럽')
  assert.deepEqual(course.segments.map(segment => segment.name), ['OUT', 'IN'])
})

test('홀 정보가 없는 수동 라운드는 추정값 없이 전반 1–9, 후반 10–18 순서로 유지된다', () => {
  const manual = applyKnownCourseTemplate(emptyRound({
    courseName: '트리니티클럽', frontCourseName: 'OUT', backCourseName: 'IN',
  }))
  assert.deepEqual(manual.holes.map(hole => hole.holeNumber), Array.from({ length: 18 }, (_, index) => index + 1))
  assert.ok(manual.holes.every(hole => hole.par == null && hole.distance == null))
  assert.ok(manual.holes.every(hole => hole.sourceOfficialHole == null))
})

test('플라자CC 용인은 별칭으로 검색되고 TIGER와 LION 각 18홀을 가진다', () => {
  const course = findKnownCourse('플라자 용인')
  assert.equal(course.id, 'plaza-yongin')
  assert.deepEqual(course.segments.map(segment => [segment.name, segment.holes.length]), [['TIGER', 18], ['LION', 18]])
})

test('18홀 코스 선택 시 같은 코스의 전반과 후반을 기본값으로 사용한다', () => {
  const course = getKnownCourse('plaza-yongin')
  const selected = selectKnownCourse(course, emptyRound())
  assert.deepEqual(segmentNamesForCourse(course.id), ['TIGER OUT', 'TIGER IN', 'LION OUT', 'LION IN'])
  assert.equal(selected.frontCourseName, 'TIGER OUT')
  assert.equal(selected.backCourseName, 'TIGER IN')
})

test('TIGER OUT/IN은 공식 1–9번과 10–18번을 차례로 연결한다', () => {
  const templated = applyKnownCourseTemplate(emptyRound({
    courseId: 'plaza-yongin',
    courseName: '플라자CC 용인',
    frontCourseName: 'TIGER OUT',
    backCourseName: 'TIGER IN',
  }))
  assert.deepEqual(templated.holes.map(hole => hole.sourceOfficialHole), Array.from({ length: 18 }, (_, index) => index + 1))
  assert.equal(templated.holes[0].par, 5)
  assert.equal(templated.holes[0].distance, 483)
  assert.equal(templated.holes[17].par, 4)
  assert.equal(templated.holes[17].distance, 245)
})

test('서로 다른 18홀 코스 구간도 선택한 공식 홀을 연결한다', () => {
  const templated = applyKnownCourseTemplate(emptyRound({
    courseId: 'plaza-yongin',
    courseName: '플라자CC 용인',
    frontCourseName: 'TIGER OUT',
    backCourseName: 'LION IN',
  }))
  assert.equal(templated.holes[8].sourceOfficialHole, 9)
  assert.equal(templated.holes[9].sourceOfficialHole, 10)
  assert.equal(templated.holes[9].distance, 422)
})

test('기존 TIGER/TIGER 저장 기록도 1–9번과 10–18번으로 호환한다', () => {
  const templated = applyKnownCourseTemplate(emptyRound({
    courseId: 'plaza-yongin', courseName: '플라자CC 용인', frontCourseName: 'TIGER', backCourseName: 'TIGER',
  }))
  assert.equal(templated.holes[0].sourceOfficialHole, 1)
  assert.equal(templated.holes[9].sourceOfficialHole, 10)
})

test('서원힐스와 서원밸리는 별칭으로 검색되고 공식 코스 구간을 제공한다', () => {
  assert.equal(findKnownCourse('서원힐스').id, 'seowon-hills')
  assert.equal(findKnownCourse('서원밸리 컨트리클럽').id, 'seowon-valley')
  assert.deepEqual(segmentNamesForCourse('seowon-hills'), ['WEST', 'SOUTH', 'EAST'])
  assert.deepEqual(segmentNamesForCourse('seowon-valley'), ['서원코스', '밸리코스'])
  assert.deepEqual(searchKnownCourses('서원').map(course => course.id), ['seowon-valley', 'seowon-hills'])
})

test('서원밸리 코스 선택은 PAR와 티별 공식 거리를 플레이 순서에 연결한다', () => {
  const templated = applyKnownCourseTemplate(emptyRound({
    courseId: 'seowon-valley',
    courseName: '서원밸리CC',
    frontCourseName: '서원코스',
    backCourseName: '밸리코스',
    tee: '레드',
  }))

  assert.deepEqual(templated.holes.slice(0, 2).map(hole => [hole.sourceOfficialHole, hole.par, hole.distance]), [
    [1, 4, 260],
    [2, 5, 412],
  ])
  assert.deepEqual(
    [templated.holes[9].sourceOfficialHole, templated.holes[9].par, templated.holes[9].distance],
    [1, 4, 275],
  )
})
