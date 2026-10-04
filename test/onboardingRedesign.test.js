import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const appSource = read('src/App.jsx')
const css = read('src/index.css')
const serviceWorker = read('public/sw.js')

test('온보딩 환영 화면은 V2 문구와 코스 영상을 사용한다', () => {
  assert.match(appSource, /Listen to your game\./)
  assert.match(appSource, /오늘의 플레이에서<br \/>내일의 골프를 발견하세요\./)
  assert.match(appSource, /<video autoPlay muted playsInline preload="metadata" poster="\/onboarding-course-poster\.jpg" src="\/onboarding-course-preview\.mp4" \/>/)
  assert.doesNotMatch(appSource, /Welcome to Golf &amp; Me/)
  assert.doesNotMatch(appSource, /당신의 골프 성장 여정을 시작해볼게요/)
  assert.ok(existsSync(new URL('../public/onboarding-course-poster.jpg', import.meta.url)))
  assert.ok(statSync(new URL('../public/onboarding-course-preview.mp4', import.meta.url)).size > 100_000)
})

test('2·3단계 안내 문구는 V2 문구를 쓴다', () => {
  assert.match(appSource, /새 라운드를 만들 때 기본으로 적용됩니다\.<br \/>라운드 작성 시 변경할 수 있어요\./)
  assert.match(appSource, /<strong>내 골프백<\/strong>에서 언제든 변경할 수 있습니다\./)
})

test('온보딩 단계는 같은 탭 새로고침에서 1·2단계로 복원하고 완료하면 지운다', () => {
  assert.match(appSource, /ONBOARDING_STEP_STORAGE_KEY = 'golf-and-me:onboarding-step'/)
  assert.match(appSource, /window\.sessionStorage\.getItem\(ONBOARDING_STEP_STORAGE_KEY\) === '2' \? 2 : 1/)
  assert.equal((appSource.match(/setOnboardingStep\(resumedOnboardingStep\(\)\)/g) || []).length, 4)
  assert.match(appSource, /function completeOnboarding\(\) \{[\s\S]*?forgetOnboardingStep\(\)/)
  assert.match(appSource, /rememberOnboardingStep\(2\)\s*\n\s*setOnboardingStep\(2\)\s*\n\s*trackEvent\('onboarding_step', \{ step: 1, status: 'complete' \}\)/)
})

test('온보딩 중에만 문서 스크롤을 잠그고 하단 버튼을 고정한다', () => {
  assert.match(appSource, /classList\.add\('is-onboarding'\)/)
  assert.match(appSource, /classList\.remove\('is-onboarding'\)/)
  assert.match(css, /html\.is-onboarding, html\.is-onboarding body \{[^}]*overflow: hidden;[^}]*overscroll-behavior-y: none/)
  assert.match(css, /html\.is-onboarding \.app-shell \{[^}]*overflow-y: auto/)
  assert.match(css, /\.onboarding-content > \.primary, \.onboarding-club-bag \.club-next-button \{ position: fixed;/)
  assert.match(css, /env\(safe-area-inset-bottom, 0px\)/)
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.onboarding-welcome-media video \{ display: none; \}/)
})

test('서비스워커는 영상 같은 Range 요청을 다루지 않고 부분(206) 응답을 캐시하지 않는다', () => {
  assert.match(serviceWorker, /if \(request\.headers\.has\('range'\)\) return/)
  assert.match(serviceWorker, /if \(response\.status === 200\) await cache\.put\(request, response\.clone\(\)\)/)
  assert.doesNotMatch(serviceWorker, /if \(response\.ok\) await cache\.put\(request, response\.clone\(\)\)/)
})

test('온보딩 다시보기 스위치는 개발 미리보기에서만 동작한다', () => {
  assert.match(appSource, /const previewOnboarding = isPreviewMode && new URLSearchParams\(window\.location\.search\)\.get\('onboarding'\) === '1'/)
  assert.match(appSource, /const isPreviewMode = import\.meta\.env\.DEV && /)
})
