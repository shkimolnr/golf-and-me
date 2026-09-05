import test from 'node:test'
import assert from 'node:assert/strict'
import database from '../src/data/golfCourseDatabase.json' with { type: 'json' }

const standardTeeKeys = ['black', 'blue', 'white', 'gold', 'red']
const expectedCourseIds = [
  'namseoul',
  'eastvalley',
  'eunhwasam',
  'sg-arumdaun',
  'lakeside',
  'plaza-yongin',
  'seowon-valley',
  'seowon-hills',
  'haesley-nine-bridges',
]

function normalize(value) {
  return value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()
}

test('골프장 스냅샷은 기존 골프장을 보존하고 ID와 별칭 충돌이 없다', () => {
  assert.equal(database.version, '2026-09-05.1')
  assert.equal(database.defaultUnit, 'M')
  assert.deepEqual(database.courses.map(course => course.id), expectedCourseIds)

  const ids = new Set()
  const segmentIds = new Set()
  const labels = new Map()
  for (const course of database.courses) {
    assert.equal(ids.has(course.id), false, `중복 골프장 ID: ${course.id}`)
    ids.add(course.id)

    for (const label of [course.name, ...course.aliases]) {
      const key = normalize(label)
      const owner = labels.get(key)
      assert.ok(!owner || owner === course.id, `별칭 충돌: ${label} (${owner}, ${course.id})`)
      labels.set(key, course.id)
    }

    for (const segment of course.segments) {
      assert.equal(segmentIds.has(segment.id), false, `중복 코스 구간 ID: ${segment.id}`)
      segmentIds.add(segment.id)
    }
  }
})

test('모든 코스 구간의 홀, PAR, 거리 단위와 결측값이 정규화 규칙을 따른다', () => {
  for (const course of database.courses) {
    assert.match(course.sourceUrl, /^https:\/\//)
    assert.match(course.firstCollectedAt, /^\d{4}-\d{2}-\d{2}$/)
    assert.match(course.lastVerifiedAt, /^\d{4}-\d{2}-\d{2}$/)

    for (const segment of course.segments) {
      assert.ok([9, 18].includes(segment.holes.length), `${course.id}/${segment.id} 홀 수`)
      assert.equal(new Set(segment.holes.map(hole => hole.number)).size, segment.holes.length)

      for (const hole of segment.holes) {
        assert.ok([3, 4, 5, 6].includes(hole.par), `${segment.id} ${hole.number} PAR`)
        assert.ok(hole.hcp == null || Number.isInteger(hole.hcp), `${segment.id} ${hole.number} HCP`)

        for (const tee of standardTeeKeys) {
          assert.ok(Object.hasOwn(hole.distances, tee), `${segment.id} ${hole.number} ${tee} 누락`)
          const distance = hole.distances[tee]
          if (distance == null) continue
          assert.equal(Number.isInteger(distance.m), true)
          assert.equal(distance.yd, Math.round(distance.m * 1.0936133))
        }
      }
    }
  }

  const seowonValley = database.courses.find(course => course.id === 'seowon-valley')
  assert.ok(seowonValley.segments.every(segment => segment.holes.every(hole => hole.distances.black == null)))
})

test('해슬리 특수데이터는 V1 표준 티와 분리해 손실 없이 보존한다', () => {
  const haesley = database.courses.find(course => course.id === 'haesley-nine-bridges')
  const holes = haesley.segments.flatMap(segment => segment.holes)
  assert.equal(holes.length, 18)
  assert.ok(holes.every(hole => Number.isInteger(hole.hcpWomen)))
  assert.ok(holes.every(hole => hole.distances.tournament))
  assert.ok(holes.every(hole => hole.distances.tournament.yd === Math.round(hole.distances.tournament.m * 1.0936133)))
})
