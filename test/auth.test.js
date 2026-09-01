import test from 'node:test'
import assert from 'node:assert/strict'
import {
  authCallbackError,
  clearAuthCallbackFromAddress,
  googleOAuthOptions,
  sanitizedAuthCallbackPath,
  shouldReportAuthCallbackFailure,
} from '../src/lib/auth.js'

test('Google 재로그인은 계정 선택 화면을 표시하고 현재 접속 주소로 돌아온다', () => {
  assert.deepEqual(googleOAuthOptions('http://192.168.45.211:5190'), {
    redirectTo: 'http://192.168.45.211:5190/',
    queryParams: { prompt: 'select_account' },
  })
})

test('기존 implicit 로그인 토큰은 주소에서 모두 제거한다', () => {
  const href = 'https://golf-and-me.vercel.app/#access_token=secret&refresh_token=refresh&provider_token=google&expires_in=3600'
  assert.equal(sanitizedAuthCallbackPath(href), '/')
})

test('PKCE 콜백 코드는 다른 쿼리를 보존하며 제거한다', () => {
  const href = 'https://golfand.me/?source=beta&code=one-time-code&sb_flow_id=flow#section'
  assert.equal(sanitizedAuthCallbackPath(href), '/?source=beta#section')
})

test('인증과 무관한 해시는 변경하지 않는다', () => {
  assert.equal(sanitizedAuthCallbackPath('https://golfand.me/#scorecard'), null)
})

test('OAuth 오류 설명을 읽고 주소를 정리한다', () => {
  const browserWindow = {
    location: { href: 'https://golfand.me/?error=invalid_request&error_description=OAuth+state+expired' },
    history: {
      state: { screen: 'login' },
      replaceState(state, title, path) {
        this.result = { state, title, path }
      },
    },
  }

  assert.equal(authCallbackError(browserWindow.location.href), 'OAuth state expired')
  assert.equal(clearAuthCallbackFromAddress(browserWindow), true)
  assert.deepEqual(browserWindow.history.result, {
    state: { screen: 'login' },
    title: '',
    path: '/',
  })
})

test('유효한 세션이 복원되면 과거 OAuth 오류를 현재 로그인 실패로 표시하지 않는다', () => {
  assert.equal(shouldReportAuthCallbackFailure('OAuth state expired', { user: { id: 'user-1' } }), false)
  assert.equal(shouldReportAuthCallbackFailure('OAuth state expired', null), true)
  assert.equal(shouldReportAuthCallbackFailure('', null), false)
})
