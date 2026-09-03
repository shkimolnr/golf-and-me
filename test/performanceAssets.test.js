import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')

test('브랜드 폰트는 모바일 전송량이 작은 WOFF2를 우선 사용한다', () => {
  const fontFace = css.match(/@font-face\s*\{[^}]+\}/)?.[0] || ''
  assert.match(fontFace, /Griun_Cherrie-Rg\.woff2/)
  assert.match(fontFace, /format\("woff2"\)/)
  assert.doesNotMatch(fontFace, /\.ttf/)
  assert.match(fontFace, /font-display:\s*swap/)
})

test('로그인 전에 Supabase와 Google 연결을 미리 준비한다', () => {
  assert.match(html, /rel="preconnect" href="%VITE_SUPABASE_URL%" crossorigin/)
  assert.match(html, /rel="preconnect" href="https:\/\/accounts\.google\.com"/)
})

test('로그인 버튼 윗선은 화면 세로 중앙에 고정하고 약관 문구는 가까이 둔다', () => {
  assert.match(css, /\.auth-login-actions\s*\{[^}]*position:\s*fixed;[^}]*top:\s*50dvh;/)
  assert.match(css, /\.auth-login-actions \.google-button\s*\{[^}]*margin-top:\s*0;/)
  assert.match(css, /\.auth-login-actions \.legal\s*\{[^}]*margin:\s*10px 0 0;/)
})
