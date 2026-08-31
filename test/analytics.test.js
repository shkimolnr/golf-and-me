import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const analyticsSource = await readFile(new URL('../src/lib/analytics.js', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')

test('분석 도구는 명시적 활성화와 사용자 동의가 모두 있어야 로드된다', () => {
  assert.match(analyticsSource, /VITE_ANALYTICS_ENABLED === 'true'/)
  assert.match(analyticsSource, /!enabled \|\| !containerId \|\| !hasConsent\(\)/)
})

test('분석 이벤트 파라미터는 비식별 허용 목록만 전송한다', () => {
  assert.match(analyticsSource, /allowedParameters\.has\(key\)/)
  for (const forbidden of ['email', 'course_name', 'club_name', 'round_id', 'user_id']) {
    assert.doesNotMatch(analyticsSource.match(/const allowedParameters[\s\S]*?\]\)/)?.[0] || '', new RegExp(forbidden))
  }
})

test('오류 진단 이벤트는 비식별 단계·분류·횟수·버전만 허용한다', () => {
  assert.match(analyticsSource, /'diagnostic_failure', 'diagnostic_recovery'/)
  for (const parameter of ['error_category', 'occurrence_count', 'app_version']) assert.match(analyticsSource, new RegExp(`'${parameter}'`))
})

test('로그인과 핵심 라운드 흐름을 단계별로 계측한다', () => {
  assert.match(appSource, /startLoginMeasurement\(\)/)
  assert.match(appSource, /measureLoginStage\('session_restored'\)/)
  assert.match(appSource, /measureLoginStage\('records_ready'\)/)
  assert.match(appSource, /trackEvent\('hole_draft_save'/)
  assert.match(appSource, /trackEvent\('hole_complete'/)
  assert.match(appSource, /trackEvent\('round_complete'/)
})
