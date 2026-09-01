import { sanitizedAuthCallbackPath } from './auth.js'

const CONSENT_STORAGE_KEY = 'golf-and-me:analytics-consent'
const AUTH_STARTED_STORAGE_KEY = 'golf-and-me:auth-started-at'
const LOGIN_START_PENDING_STORAGE_KEY = 'golf-and-me:login-start-pending'
const LOGIN_MEASUREMENTS_STORAGE_KEY = 'golf-and-me:login-measurements'
const SCRIPT_SELECTOR = 'script[data-golf-and-me-ga4]'
const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/
const ANALYTICS_PAGE_LOCATION = 'https://golf-and-me.invalid/'

// Google 태그가 동의 후 자체 생성하는 기본 이벤트다. 앱에서는 이 이름을 직접 전송하지 않는다.
export const ga4AutomaticEventNames = Object.freeze([
  'first_visit',
  'session_start',
  'user_engagement',
])

const EVENT_SCHEMAS = Object.freeze({
  screen_view: { screen_name: ['login', 'onboarding', 'home', 'new_round', 'clubs', 'scorecard', 'hole_detail', 'round_result', 'news', 'feedback'] },
  login_start: { stage: ['oauth_request'] },
  login_success: { stage: ['session_restored', 'records_ready'], duration_ms: 'duration' },
  login_fail: { stage: ['oauth_start', 'oauth_callback'] },
  onboarding_step: { step: [1, 2, 3], status: ['viewed', 'complete'] },
  onboarding_complete: { status: ['complete'] },
  club_setup_complete: { status: ['saved'], source: ['onboarding', 'account'] },
  round_create: { is_manual_course: 'boolean', has_course_data: 'boolean' },
  hole_start: { completed_holes: 'holes' },
  hole_draft_save: { completed_holes: 'holes' },
  hole_complete: { completed_holes: 'holes' },
  round_milestone: { milestone: [1, 3, 9, 18], completed_holes: 'holes' },
  round_complete: { completed_holes: [18], duration_ms: 'duration' },
  round_result_view: { completed_holes: 'holes' },
  save_delayed: { stage: ['offline', 'remote_load', 'remote_save'], online: 'boolean' },
  save_recovered: { stage: ['remote_load', 'remote_save'], online: [true] },
  account_delete_complete: { status: ['success'] },
})

const allowedEnvironments = new Set(['development', 'preview', 'production'])
let analyticsReady = false
let activeMeasurementId = null
let activeRuntimeEnvironment = null

function browserWindow() {
  return typeof window === 'undefined' ? null : window
}

function storageFor(name) {
  const currentWindow = browserWindow()
  if (!currentWindow) return null
  try {
    return currentWindow[name]
  } catch {
    return null
  }
}

function readStorage(key) {
  try {
    return storageFor('localStorage')?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeStorage(key, value) {
  try {
    storageFor('localStorage')?.setItem(key, value)
  } catch {
    // 분석 선택을 저장하지 못해도 서비스 기능에는 영향을 주지 않는다.
  }
}

function currentEnvironment() {
  const env = import.meta.env ?? {}
  if (allowedEnvironments.has(env.VITE_APP_ENV)) return env.VITE_APP_ENV
  if (env.DEV) return 'development'
  return 'unknown'
}

function configuredAnalytics(config = {}) {
  const env = import.meta.env ?? {}
  return {
    enabled: config.enabled ?? env.VITE_ANALYTICS_ENABLED === 'true',
    measurementId: config.measurementId ?? env.VITE_GA_MEASUREMENT_ID ?? '',
    targetEnvironment: config.targetEnvironment ?? env.VITE_ANALYTICS_ENV ?? '',
    runtimeEnvironment: config.runtimeEnvironment ?? currentEnvironment(),
  }
}

function isMatchingAnalyticsEnvironment(config) {
  return allowedEnvironments.has(config.targetEnvironment)
    && config.targetEnvironment === config.runtimeEnvironment
}

function isValidMeasurementId(value) {
  return typeof value === 'string' && GA_MEASUREMENT_ID_PATTERN.test(value)
}

function isAllowedValue(rule, value) {
  if (Array.isArray(rule)) return rule.includes(value)
  if (rule === 'boolean') return typeof value === 'boolean'
  if (rule === 'holes') return Number.isInteger(value) && value >= 0 && value <= 18
  if (rule === 'duration') return Number.isInteger(value) && value >= 0 && value <= 86_400_000
  return false
}

function safeParameters(eventName, parameters = {}) {
  const schema = EVENT_SCHEMAS[eventName]
  if (!schema || !parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return null

  const safe = {}
  for (const [key, rule] of Object.entries(schema)) {
    if (!Object.hasOwn(parameters, key) || !isAllowedValue(rule, parameters[key])) return null
    safe[key] = parameters[key]
  }
  return safe
}

function addAnalyticsScript(measurementId) {
  const currentWindow = browserWindow()
  if (!currentWindow || typeof document === 'undefined') return false
  if (!document.querySelector(SCRIPT_SELECTOR)) {
    const script = document.createElement('script')
    script.async = true
    script.dataset.golfAndMeGa4 = 'true'
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`
    document.head.appendChild(script)
  }
  currentWindow.dataLayer = currentWindow.dataLayer || []
  currentWindow.gtag = currentWindow.gtag || function gtag() { currentWindow.dataLayer.push(arguments) }
  return true
}

export function getAnalyticsConsent() {
  const stored = readStorage(CONSENT_STORAGE_KEY)
  return stored === 'granted' || stored === 'denied' ? stored : 'unknown'
}

export function hasAnalyticsConsent() {
  return getAnalyticsConsent() === 'granted'
}

export function getAnalyticsConfiguration(config) {
  const resolved = configuredAnalytics(config)
  return Object.freeze({
    enabled: Boolean(resolved.enabled),
    measurementIdConfigured: isValidMeasurementId(resolved.measurementId),
    targetEnvironment: resolved.targetEnvironment || 'unset',
    runtimeEnvironment: resolved.runtimeEnvironment,
    canInitialize: Boolean(resolved.enabled && isValidMeasurementId(resolved.measurementId) && isMatchingAnalyticsEnvironment(resolved)),
  })
}

export function initializeAnalytics(config) {
  const resolved = configuredAnalytics(config)
  const currentWindow = browserWindow()
  if (!currentWindow || !resolved.enabled || !isValidMeasurementId(resolved.measurementId) || !isMatchingAnalyticsEnvironment(resolved) || !hasAnalyticsConsent()) return false
  if (typeof currentWindow.location?.href === 'string' && sanitizedAuthCallbackPath(currentWindow.location.href)) return false

  currentWindow[`ga-disable-${resolved.measurementId}`] = false
  if (analyticsReady && activeMeasurementId === resolved.measurementId) return false
  if (!addAnalyticsScript(resolved.measurementId)) return false

  currentWindow.gtag('js', new Date())
  currentWindow.gtag('config', resolved.measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_location: ANALYTICS_PAGE_LOCATION,
    page_title: 'Golf & Me',
    page_referrer: '',
    ignore_referrer: true,
    ...(resolved.runtimeEnvironment === 'preview' ? { debug_mode: true } : {}),
  })
  analyticsReady = true
  activeMeasurementId = resolved.measurementId
  activeRuntimeEnvironment = resolved.runtimeEnvironment
  return true
}

export function setAnalyticsConsent(granted, config) {
  const resolved = configuredAnalytics(config)
  const currentWindow = browserWindow()
  writeStorage(CONSENT_STORAGE_KEY, granted ? 'granted' : 'denied')
  if (isValidMeasurementId(resolved.measurementId) && currentWindow) currentWindow[`ga-disable-${resolved.measurementId}`] = !granted
  if (granted) initializeAnalytics(resolved)
  return getAnalyticsConsent()
}

export function trackEvent(eventName, parameters = {}) {
  const currentWindow = browserWindow()
  if (!EVENT_SCHEMAS[eventName] || !analyticsReady || !activeMeasurementId || !hasAnalyticsConsent() || currentWindow?.[`ga-disable-${activeMeasurementId}`]) return false
  const safe = safeParameters(eventName, parameters)
  if (!safe || !currentWindow?.gtag) return false
  currentWindow.gtag('event', eventName, activeRuntimeEnvironment === 'preview'
    ? { ...safe, debug_mode: true }
    : safe)
  return true
}

export function trackScreen(screenName) {
  return trackEvent('screen_view', { screen_name: screenName })
}

export function startLoginMeasurement() {
  const startedAt = Date.now()
  try {
    storageFor('sessionStorage')?.setItem(AUTH_STARTED_STORAGE_KEY, String(startedAt))
    if (hasAnalyticsConsent()) storageFor('sessionStorage')?.setItem(LOGIN_START_PENDING_STORAGE_KEY, 'true')
    else storageFor('sessionStorage')?.removeItem(LOGIN_START_PENDING_STORAGE_KEY)
    browserWindow()?.performance?.mark?.('golf-and-me:login-start')
  } catch {
    // 성능 측정 저장 실패는 로그인 흐름에 영향을 주지 않는다.
  }
}

export function flushPendingLoginStartMeasurement() {
  const sessionStorage = storageFor('sessionStorage')
  try {
    if (sessionStorage?.getItem(LOGIN_START_PENDING_STORAGE_KEY) !== 'true') return false
  } catch {
    return false
  }
  const tracked = trackEvent('login_start', { stage: 'oauth_request' })
  if (tracked) {
    try {
      sessionStorage?.removeItem(LOGIN_START_PENDING_STORAGE_KEY)
    } catch {
      // 중복 방지 상태를 지우지 못해도 로그인 흐름에는 영향을 주지 않는다.
    }
  }
  return tracked
}

export function measureLoginStage(stage) {
  let startedAt = Number.NaN
  try {
    startedAt = Number(storageFor('sessionStorage')?.getItem(AUTH_STARTED_STORAGE_KEY))
  } catch {
    // 아래에서 측정 없이 종료한다.
  }
  if (!Number.isFinite(startedAt)) return null
  const durationMs = Math.max(0, Date.now() - startedAt)
  try {
    browserWindow()?.performance?.mark?.(`golf-and-me:login-${stage}`)
    const stored = JSON.parse(readStorage(LOGIN_MEASUREMENTS_STORAGE_KEY) || '[]')
    const measurements = Array.isArray(stored) ? stored : []
    writeStorage(LOGIN_MEASUREMENTS_STORAGE_KEY, JSON.stringify([
      ...measurements,
      { stage, durationMs, measuredAt: new Date().toISOString() },
    ].slice(-20)))
  } catch {
    // 로컬 성능 이력은 선택적인 보조 정보다.
  }
  flushPendingLoginStartMeasurement()
  trackEvent('login_success', { stage, duration_ms: durationMs })
  if (stage === 'records_ready') {
    try {
      storageFor('sessionStorage')?.removeItem(AUTH_STARTED_STORAGE_KEY)
    } catch {
      // 로그인 흐름에는 영향 없음.
    }
  }
  return durationMs
}

export function recordLoginFailure(stage) {
  flushPendingLoginStartMeasurement()
  return trackEvent('login_fail', { stage })
}

export const analyticsEventNames = Object.freeze(Object.keys(EVENT_SCHEMAS))

// Node 기반 단위 테스트에서 모듈 상태를 격리하기 위한 용도다. 앱 코드에서는 사용하지 않는다.
export function resetAnalyticsForTests() {
  analyticsReady = false
  activeMeasurementId = null
  activeRuntimeEnvironment = null
}
