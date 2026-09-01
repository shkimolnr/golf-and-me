import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  getAnalyticsConfiguration,
  getAnalyticsConsent,
  initializeAnalytics,
  resetAnalyticsForTests,
  setAnalyticsConsent,
  trackEvent,
  trackScreen,
} from '../src/lib/analytics.js'

const analyticsSource = await readFile(new URL('../src/lib/analytics.js', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')

const productionConfig = Object.freeze({
  enabled: true,
  measurementId: 'G-TEST1234',
  targetEnvironment: 'production',
  runtimeEnvironment: 'production',
})

function createStorage() {
  const values = new Map()
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  }
}

function installBrowser(storage = createStorage(), href = 'https://golf-and-me.vercel.app/') {
  const scripts = []
  global.window = {
    localStorage: storage,
    sessionStorage: createStorage(),
    performance: { mark() {} },
    location: new URL(href),
  }
  global.document = {
    head: { appendChild: script => scripts.push(script) },
    createElement: () => ({ dataset: {} }),
    querySelector: selector => selector === 'script[data-golf-and-me-ga4]'
      ? scripts.find(script => script.dataset.golfAndMeGa4 === 'true') || null
      : null,
  }
  return scripts
}

beforeEach(() => {
  resetAnalyticsForTests()
})

afterEach(() => {
  delete global.window
  delete global.document
})

test('기본 동의 상태에서는 GA 스크립트와 이벤트가 전송되지 않는다', () => {
  const scripts = installBrowser()
  assert.equal(getAnalyticsConsent(), 'unknown')
  assert.equal(initializeAnalytics(productionConfig), false)
  assert.equal(trackScreen('login'), false)
  assert.equal(scripts.length, 0)
})

test('허용 후 GA4를 정확히 한 번 초기화하고 자동 page_view를 끈다', () => {
  const scripts = installBrowser()
  assert.equal(setAnalyticsConsent(true, productionConfig), 'granted')
  assert.equal(scripts.length, 1)
  assert.equal(scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-TEST1234')
  assert.equal(initializeAnalytics(productionConfig), false)
  assert.equal(scripts.length, 1)
  assert.deepEqual(Array.from(window.dataLayer.at(-1)), ['config', 'G-TEST1234', {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_referrer: '',
  }])
})

test('새로고침 뒤 저장된 허용 상태로 GA4를 다시 초기화한다', () => {
  const storage = createStorage()
  installBrowser(storage)
  setAnalyticsConsent(true, productionConfig)

  resetAnalyticsForTests()
  delete global.window
  delete global.document
  const scripts = installBrowser(storage)

  assert.equal(getAnalyticsConsent(), 'granted')
  assert.equal(initializeAnalytics(productionConfig), true)
  assert.equal(scripts.length, 1)
})

test('화면 전환은 명시적 허용 목록 이벤트로 한 번씩만 보낼 수 있다', () => {
  installBrowser()
  setAnalyticsConsent(true, productionConfig)
  assert.equal(trackScreen('home'), true)
  assert.equal(trackScreen('unknown-screen'), false)
  assert.deepEqual(Array.from(window.dataLayer.at(-1)), ['event', 'screen_view', { screen_name: 'home' }])
})

test('이벤트별 allowlist는 허용되지 않은 개인정보와 임의 매개변수를 제거한다', () => {
  installBrowser()
  setAnalyticsConsent(true, productionConfig)
  assert.equal(trackEvent('round_create', {
    is_manual_course: true,
    has_course_data: false,
    email: 'private@example.com',
    user_id: 'private-user-id',
    course_name: '비공개 골프장',
  }), true)
  assert.deepEqual(Array.from(window.dataLayer.at(-1)), ['event', 'round_create', {
    is_manual_course: true,
    has_course_data: false,
  }])
  assert.equal(trackEvent('diagnostic_failure', { stage: 'oauth' }), false)
})

test('분석 철회 직후부터 이벤트 전송을 중단하고 선택은 기기에 저장한다', () => {
  installBrowser()
  setAnalyticsConsent(true, productionConfig)
  assert.equal(trackScreen('home'), true)
  assert.equal(setAnalyticsConsent(false, productionConfig), 'denied')
  assert.equal(getAnalyticsConsent(), 'denied')
  assert.equal(window['ga-disable-G-TEST1234'], true)
  assert.equal(trackScreen('news'), false)
})

test('Preview 환경은 Production 측정 ID를 초기화하지 않는다', () => {
  const scripts = installBrowser()
  const previewWithProductionId = { ...productionConfig, runtimeEnvironment: 'preview' }
  setAnalyticsConsent(true, previewWithProductionId)
  assert.equal(getAnalyticsConfiguration(previewWithProductionId).canInitialize, false)
  assert.equal(initializeAnalytics(previewWithProductionId), false)
  assert.equal(scripts.length, 0)
})

test('Preview 전용 측정은 DebugView 검증 표식을 추가한다', () => {
  installBrowser()
  const previewConfig = {
    ...productionConfig,
    targetEnvironment: 'preview',
    runtimeEnvironment: 'preview',
  }
  setAnalyticsConsent(true, previewConfig)
  assert.deepEqual(Array.from(window.dataLayer.at(-1)), ['config', 'G-TEST1234', {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_referrer: '',
    debug_mode: true,
  }])
})

test('측정 ID가 없거나 비활성화여도 앱 동작을 막지 않는다', () => {
  const scripts = installBrowser()
  const disabledConfig = { ...productionConfig, enabled: false, measurementId: '' }
  assert.equal(setAnalyticsConsent(true, disabledConfig), 'granted')
  assert.equal(initializeAnalytics(disabledConfig), false)
  assert.equal(trackScreen('home'), false)
  assert.equal(scripts.length, 0)
})

test('GA4 형식이 아닌 측정 ID는 초기화하지 않는다', () => {
  const scripts = installBrowser()
  const invalidConfig = { ...productionConfig, measurementId: 'not-a-ga4-id' }
  setAnalyticsConsent(true, invalidConfig)
  assert.equal(getAnalyticsConfiguration(invalidConfig).measurementIdConfigured, false)
  assert.equal(initializeAnalytics(invalidConfig), false)
  assert.equal(scripts.length, 0)
})

test('OAuth 토큰이나 콜백 코드가 주소에 남아 있으면 GA4 초기화를 보류한다', () => {
  const scripts = installBrowser(createStorage(), 'https://golf-and-me.vercel.app/?code=one-time-code#access_token=secret')
  assert.equal(setAnalyticsConsent(true, productionConfig), 'granted')
  assert.equal(initializeAnalytics(productionConfig), false)
  assert.equal(scripts.length, 0)

  window.location = new URL('https://golf-and-me.vercel.app/')
  assert.equal(initializeAnalytics(productionConfig), true)
  assert.equal(scripts.length, 1)
  assert.doesNotMatch(JSON.stringify(window.dataLayer), /one-time-code|access_token|secret/)
})

test('GA4는 GTM과 운영 진단 이벤트를 사용하지 않는다', () => {
  assert.match(analyticsSource, /gtag\/js\?id=/)
  assert.doesNotMatch(analyticsSource, /gtm\.js/)
  assert.doesNotMatch(analyticsSource, /diagnostic_failure|diagnostic_recovery|recordDiagnosticEvent/)
})

test('온보딩 전 선택과 계정 설정 변경 UI가 있으며 제품 흐름 이벤트를 연결한다', () => {
  assert.match(appSource, /서비스 개선에[\s\S]*도움을 주실래요/)
  assert.match(appSource, />허용</)
  assert.match(appSource, />괜찮아요</)
  assert.doesNotMatch(appSource, /analytics-consent-shell/)
  assert.match(appSource, /analyticsConsent === 'unknown' && \([\s\S]*onboarding-progress/)
  assert.match(appSource, /initializeAnalytics\(\)/)
  assert.match(appSource, /analyticsConsent === 'granted' && analyticsAddressReady/)
  assert.match(appSource, /서비스 개선 분석 허용/)
  assert.match(appSource, /trackScreen\(analyticsScreen\)/)
  assert.match(appSource, /trackEvent\('onboarding_complete'/)
  assert.match(appSource, /trackEvent\('round_complete'/)
  assert.match(appSource, /trackEvent\('onboarding_complete'/)
  assert.match(appSource, /서비스 개선 분석 허용/)
})

test('제품 이벤트는 재시도와 완료 기록 수정에서 중복 집계되지 않는다', () => {
  assert.match(appSource, /completedOnboardingStepsRef\.current\.has\(step\)/)
  assert.match(appSource, /analyticsSyncIssueStagesRef\.current\.has\(stage\)/)
  assert.match(appSource, /trackSaveDelayed\('remote_load'/)
  assert.match(appSource, /if \(!completedHole\) trackEvent\('hole_start'/)
  assert.match(appSource, /if \(!holeWasCompleted\) \{[\s\S]*trackEvent\('hole_complete'[\s\S]*trackEvent\('round_milestone'/)
})
