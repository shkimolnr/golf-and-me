import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const appSource = read('src/App.jsx')
const css = read('src/index.css')

test('홈 상단은 진한 잉크색 로고 글자와 벨 아이콘 새소식 버튼을 쓴다', () => {
  assert.match(css, /\.brand-wordmark \{[^}]*color: #253044;[^}]*font-weight: 900/)
  assert.match(appSource, /<button className="news-header-button"[^>]*>\s*<AppIcon name="bell" \/>\s*\{unseenNews && <i className="news-unseen-dot" aria-hidden="true" \/>\}/)
  assert.doesNotMatch(appSource, /MegaphoneIcon|FeedbackIcon/)
})

test('내 계정 메뉴는 새 아이콘과 화살표 아이콘을 쓰고 응원하기는 준비 중으로 비활성이다', () => {
  for (const name of ['golfCart', 'bell', 'feedback', 'heart']) {
    assert.match(appSource, new RegExp(`<AppIcon name="${name}" />`))
  }
  assert.equal((appSource.match(/<AppIcon className="menu-chevron" name="chevronRight" \/>/g) || []).length, 4)
  assert.match(appSource, /<button className="account-menu-button" type="button" disabled>\s*<span><b aria-hidden="true"><AppIcon name="heart" \/><\/b><strong>응원하기<\/strong><em className="coming-soon-chip">준비 중<\/em><\/span>/)
  // 홈 기록 카드의 → 표시는 그대로 두고, 내 계정 메뉴 구간에서만 옛 화살표가 없어야 한다.
  const accountMenu = appSource.slice(appSource.indexOf('<button className="account-menu-button" type="button" onClick={openClubBag}>'), appSource.indexOf('{analyticsAvailable && ('))
  assert.doesNotMatch(accountMenu, /<i aria-hidden="true">→<\/i>/)
  assert.match(css, /\.account-menu-button:disabled \{ opacity: \.58; \}/)
})

test('새소식 안 읽음 표시는 초록 점이다', () => {
  assert.match(css, /\.news-unseen-dot \{[^}]*background: #059669/)
})

test('홈 화면 바로가기 아이콘은 V2의 apple-touch-icon(180×180)을 쓴다', () => {
  const html = read('index.html')
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png" \/>/)
  // PNG 헤더의 가로·세로가 180인지 확인한다.
  const png = readFileSync(new URL('../public/apple-touch-icon.png', import.meta.url))
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  assert.equal(png.readUInt32BE(16), 180)
  assert.equal(png.readUInt32BE(20), 180)
})
