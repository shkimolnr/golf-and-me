import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getAnalyticsConfiguration } from '../src/lib/analytics.js'

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')

test('분석이 꺼진 배포에서는 분석 초기화가 불가능하다(화면 숨김 판단의 근거)', () => {
  assert.equal(getAnalyticsConfiguration({ enabled: false, measurementId: 'G-TEST', targetEnvironment: 'production', runtimeEnvironment: 'production' }).canInitialize, false)
  assert.equal(getAnalyticsConfiguration({ enabled: true, measurementId: '', targetEnvironment: 'production', runtimeEnvironment: 'production' }).canInitialize, false)
  assert.equal(getAnalyticsConfiguration({ enabled: true, measurementId: 'G-TEST', targetEnvironment: 'preview', runtimeEnvironment: 'production' }).canInitialize, false)
  assert.equal(getAnalyticsConfiguration({ enabled: true, measurementId: 'G-TEST', targetEnvironment: 'preview', runtimeEnvironment: 'preview' }).canInitialize, true)
})

test('분석 동의 화면과 계정 메뉴 토글은 분석을 쓸 수 있는 배포에서만 보인다', () => {
  assert.match(appSource, /const analyticsAvailable = getAnalyticsConfiguration\(\)\.canInitialize/)
  assert.match(appSource, /if \(analyticsAvailable && screen === 'onboarding' && analyticsConsent === 'unknown'\)/)
  assert.match(appSource, /\{analyticsAvailable && \(\s*<label className="analytics-consent-control">/)
})

test('계정 삭제 전후에 Google 연결 승인이 남는다는 안내를 보여준다', () => {
  assert.match(appSource, /GOOGLE_DISCONNECT_NOTICE = '계정과 기록을 삭제했어요\. Google 계정의 연결 승인은 삭제되지 않으니/)
  assert.match(appSource, /setAuthNotice\(GOOGLE_DISCONNECT_NOTICE\)\s*\n\s*setSession\(null\)/)
  assert.match(appSource, /\{authNotice && <p className="auth-notice" role="status">\{authNotice\}<\/p>\}/)
  assert.match(appSource, /Google 계정의 연결 승인은 삭제되지 않으며, 삭제 후 Google 계정 설정에서 직접 해제할 수 있어요/)
  // 새 로그인을 시작하면 이전 안내는 지운다.
  assert.match(appSource, /setAuthError\(''\)\s*\n\s*setAuthNotice\(''\)/)
})
