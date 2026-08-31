export const REMOTE_HYDRATION_RETRY_DELAY_MS = 5000
export const REMOTE_HYDRATION_MAX_AUTOMATIC_RETRIES = 1

export function shouldScheduleRemoteHydrationRetry(attemptCount, online = true) {
  return online && attemptCount < REMOTE_HYDRATION_MAX_AUTOMATIC_RETRIES
}

export function scheduleRemoteHydrationRetry(browserWindow, onRetry) {
  const timer = browserWindow.setTimeout(onRetry, REMOTE_HYDRATION_RETRY_DELAY_MS)
  return () => browserWindow.clearTimeout(timer)
}
