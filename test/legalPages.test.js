import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const terms = read('public/terms.html')
const privacy = read('public/privacy.html')
const app = read('src/App.jsx')
const serviceWorker = read('public/sw.js')

test('약관과 방침은 운영자·문의처를 포함한 공개 정적 페이지로 존재한다', () => {
  for (const page of [terms, privacy]) {
    assert.match(page, /<html lang="ko">/)
    assert.match(page, /\(주\)오엘엔알/)
    assert.match(page, /시행일: 2026년 10월 5일/)
  }
  assert.match(terms, /help@golfand\.me/)
  assert.match(privacy, /privacy@golfand\.me/)
})

test('게시본에 확인 필요 같은 미완성 표식이 남아 있지 않다', () => {
  for (const page of [terms, privacy]) {
    assert.doesNotMatch(page, /\[확인 필요\]|\[확정 필요\]|\[계약 대조 필요\]|TODO|TBD|data-pending/)
  }
})

test('Supabase 저장 위치는 사용자가 대시보드에서 확인한 서울 리전으로 표기한다', () => {
  assert.match(privacy, /Supabase<\/td>\s*<td>주 저장 위치: 대한민국 서울\(ap-northeast-2\)/)
})

test('GA4를 사용하지 않는다는 방침과 앱의 분석 기본값이 어긋나지 않는다', () => {
  assert.match(privacy, /현재 서비스는 제품 분석.+사용하지 않으며/)
})

test('로그인 화면과 계정 메뉴가 약관·방침 페이지로 연결된다', () => {
  assert.match(app, /className="legal">계속하면 <a href="\/terms\.html" target="_blank" rel="noopener noreferrer">/)
  assert.match(app, /<a href="\/privacy\.html" target="_blank" rel="noopener noreferrer">개인정보 처리방침<\/a>에 동의하며, 만 14세 이상임을 확인합니다\./)
  assert.match(app, /className="account-legal-links"/)
})

test('서비스워커는 정적 정책 페이지가 앱 화면 캐시를 덮어쓰지 않게 한다', () => {
  assert.match(serviceWorker, /STATIC_PAGE_PATHS = new Set\(\['\/terms\.html', '\/privacy\.html'\]\)/)
  const bypass = serviceWorker.indexOf('STATIC_PAGE_PATHS.has(url.pathname)')
  const navigate = serviceWorker.indexOf("request.mode === 'navigate'")
  assert.ok(bypass > 0 && bypass < navigate, '정책 페이지 예외는 navigate 처리보다 먼저 와야 한다')
})

test('이용약관·개인정보처리방침 제목 아래에는 버전과 시행일만 표시한다(운영자는 본문에 있음)', () => {
  for (const page of [terms, privacy]) {
    assert.match(page, /<p class="meta">v1\.0 · 시행일: 2026년 10월 5일<\/p>/)
    assert.doesNotMatch(page, /class="meta">[^<]*(운영자|최종 수정일)/)
    assert.match(page, /\(주\)오엘엔알/)
  }
})
