import test from 'node:test'
import assert from 'node:assert/strict'
import { googleOAuthOptions } from '../src/lib/auth.js'

test('Google 재로그인은 계정 선택 화면을 표시하고 현재 접속 주소로 돌아온다', () => {
  assert.deepEqual(googleOAuthOptions('http://192.168.45.211:5190'), {
    redirectTo: 'http://192.168.45.211:5190/',
    queryParams: { prompt: 'select_account' },
  })
})
