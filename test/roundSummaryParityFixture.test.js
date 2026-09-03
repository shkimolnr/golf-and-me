import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateRoundStats } from '../src/lib/roundStats.js'
import { roundSummaryParityFixtures } from '../testSupport/roundSummaryParityFixtures.js'

for (const fixture of roundSummaryParityFixtures) {
  test(`JS 라운드 요약 fixture: ${fixture.name}`, () => {
    assert.deepEqual(calculateRoundStats(fixture.payload), fixture.expected)
  })
}
