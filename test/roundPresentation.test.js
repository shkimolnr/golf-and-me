import test from 'node:test'
import assert from 'node:assert/strict'
import { compactCoursePair } from '../src/lib/roundPresentation.js'

test('같은 18홀 코스의 OUT/IN 요약은 코스명을 한 번만 표시한다', () => {
  assert.equal(compactCoursePair('TIGER OUT', 'TIGER IN'), 'TIGER OUT / IN')
})

test('서로 다른 코스 조합은 전체 명칭을 유지한다', () => {
  assert.equal(compactCoursePair('TIGER OUT', 'LION IN'), 'TIGER OUT / LION IN')
  assert.equal(compactCoursePair('동코스', '남코스'), '동코스 / 남코스')
})
