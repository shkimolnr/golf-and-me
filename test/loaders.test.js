import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const app = read('src/App.jsx')
const loaders = read('src/components/Loaders.jsx')
const css = read('src/index.css')

test('긴 대기 화면 두 곳은 같은 퍼팅 모션과 같은 문구를 쓴다', () => {
  assert.equal((app.match(/<PuttLoader \/>/g) || []).length, 2)
  assert.match(loaders, /label = '불러오는 중이에요'/)
  assert.doesNotMatch(app, /className="spinner"/)
  assert.doesNotMatch(css, /\.spinner \{/)
})

test('버튼 안의 짧은 대기 세 곳은 통통 튀는 공을 쓴다', () => {
  assert.equal((app.match(/<BounceBall \/>/g) || []).length, 3)
  for (const text of ['불러오는 중…', '보내는 중…', '삭제 중…']) {
    assert.match(app, new RegExp(`<BounceBall /> ${text}`))
  }
})

test('퍼팅은 직선·플랫한 공·그림자 없음, 홀컵에 떨어진 뒤 깃발이 펄럭인다', () => {
  assert.match(loaders, /className="gm-putt-roll"/)
  assert.match(loaders, /className="gm-putt-flag"/)
  assert.doesNotMatch(loaders, /gm-putt-shadow|gm-putt-spin/)
  assert.match(css, /@keyframes gm-putt-roll \{[\s\S]*?translate\(90px,11px\)/)
  assert.match(css, /@keyframes gm-putt-flutter/)
})

test('로딩 모션은 0.3초 뒤에 나타나고 동작 줄이기 설정에서는 멈춘다', () => {
  assert.match(css, /\.gm-loader \{[^}]*animation: gm-in \.25s ease \.3s both/)
  assert.match(css, /\.gm-bounce \{[^}]*animation: gm-in \.2s ease \.3s both/)
  assert.match(css, /prefers-reduced-motion: reduce\) \{[^}]*\.gm-putt-roll[^}]*animation: none/)
})

test('확인용 화면은 개발 서버에서만 열린다', () => {
  assert.match(app, /const devLoaderView = import\.meta\.env\.DEV \? new URLSearchParams\(window\.location\.search\)\.get\('loader'\) : null/)
  assert.match(app, /if \(devLoaderView\) return <LoaderGallery view=\{devLoaderView\} \/>/)
})
