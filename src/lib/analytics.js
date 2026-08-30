const allowedEvents = new Set([
  'login_start', 'login_success', 'login_fail',
  'onboarding_step', 'club_setup_complete',
  'round_create', 'hole_start', 'hole_draft_save', 'hole_complete',
  'round_milestone', 'round_complete', 'round_result_view',
  'save_delayed', 'save_recovered', 'account_delete_complete',
])

const allowedParameters = new Set([
  'stage', 'step', 'status', 'milestone', 'duration_ms', 'online',
  'is_manual_course', 'has_course_data', 'completed_holes',
])

const consentKey = 'golf-and-me:analytics-consent'
const authStartedKey = 'golf-and-me:auth-started-at'
const loginMeasurementsKey = 'golf-and-me:login-measurements'
let analyticsReady = false

function hasConsent() {
  return window.localStorage.getItem(consentKey) === 'granted'
}

function safeParameters(parameters = {}) {
  return Object.fromEntries(Object.entries(parameters).filter(([key, value]) => (
    allowedParameters.has(key)
    && ['string', 'number', 'boolean'].includes(typeof value)
  )))
}

export function initializeAnalytics() {
  const containerId = import.meta.env.VITE_GTM_ID
  const enabled = import.meta.env.VITE_ANALYTICS_ENABLED === 'true'
  if (!enabled || !containerId || !hasConsent() || analyticsReady) return false
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`
  document.head.appendChild(script)
  analyticsReady = true
  return true
}

export function setAnalyticsConsent(granted) {
  window.localStorage.setItem(consentKey, granted ? 'granted' : 'denied')
  if (granted) initializeAnalytics()
}

export function trackEvent(event, parameters = {}) {
  if (!allowedEvents.has(event) || !analyticsReady) return false
  window.dataLayer.push({ event, ...safeParameters(parameters) })
  return true
}

export function startLoginMeasurement() {
  const startedAt = Date.now()
  window.sessionStorage.setItem(authStartedKey, String(startedAt))
  performance.mark('golf-and-me:login-start')
  trackEvent('login_start', { stage: 'oauth_request' })
}

export function measureLoginStage(stage) {
  const startedAt = Number(window.sessionStorage.getItem(authStartedKey))
  if (!Number.isFinite(startedAt)) return null
  const durationMs = Math.max(0, Date.now() - startedAt)
  performance.mark(`golf-and-me:login-${stage}`)
  let measurements = []
  try {
    measurements = JSON.parse(window.localStorage.getItem(loginMeasurementsKey)) || []
  } catch {
    measurements = []
  }
  window.localStorage.setItem(loginMeasurementsKey, JSON.stringify([
    ...measurements,
    { stage, durationMs, measuredAt: new Date().toISOString() },
  ].slice(-20)))
  trackEvent('login_success', { stage, duration_ms: durationMs })
  if (stage === 'records_ready') window.sessionStorage.removeItem(authStartedKey)
  return durationMs
}

export function recordLoginFailure(stage) {
  trackEvent('login_fail', { stage })
}

export const analyticsEventNames = Object.freeze([...allowedEvents])
