export const REMOTE_HYDRATION_RETRY_DELAY_MS = 5000

export function scheduleRemoteHydrationRetry(browserWindow, onRetry) {
  const timer = browserWindow.setTimeout(onRetry, REMOTE_HYDRATION_RETRY_DELAY_MS)
  return () => browserWindow.clearTimeout(timer)
}
