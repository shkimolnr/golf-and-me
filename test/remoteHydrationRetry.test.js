import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REMOTE_HYDRATION_MAX_AUTOMATIC_RETRIES,
  REMOTE_HYDRATION_RETRY_DELAY_MS,
  scheduleRemoteHydrationRetry,
  shouldScheduleRemoteHydrationRetry,
} from '../src/lib/remoteHydrationRetry.js'

test('원격 기록 자동 재시도는 온라인에서 세션당 한 번만 허용한다', () => {
  assert.equal(REMOTE_HYDRATION_MAX_AUTOMATIC_RETRIES, 1)
  assert.equal(shouldScheduleRemoteHydrationRetry(0, true), true)
  assert.equal(shouldScheduleRemoteHydrationRetry(1, true), false)
  assert.equal(shouldScheduleRemoteHydrationRetry(0, false), false)
})

test('원격 기록 조회 실패는 5초 뒤 한 번 다시 시도한다', () => {
  let scheduledCallback = null
  let scheduledDelay = null
  let clearedTimer = null
  const browserWindow = {
    setTimeout(callback, delay) {
      scheduledCallback = callback
      scheduledDelay = delay
      return 'remote-hydration-retry'
    },
    clearTimeout(timer) {
      clearedTimer = timer
    },
  }
  let retryCount = 0

  const cancelRetry = scheduleRemoteHydrationRetry(browserWindow, () => { retryCount += 1 })

  assert.equal(scheduledDelay, REMOTE_HYDRATION_RETRY_DELAY_MS)
  scheduledCallback()
  assert.equal(retryCount, 1)

  cancelRetry()
  assert.equal(clearedTimer, 'remote-hydration-retry')
})
