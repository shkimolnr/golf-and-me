import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { hasUnseenNews, latestNewsId, newsItems, newsSeenStorageKey } from '../src/data/news.js'

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')

test('핵심 비동기 준비 상태는 스크린리더에 상태로 전달된다', () => {
  assert.match(appSource, /로그인 상태를 확인하고 있어요.<\/p>/)
  assert.match(appSource, /내 플레이 정보를 준비하고 있어요.<\/p>/)
  assert.ok((appSource.match(/<p role="status">/g) || []).length >= 2)
})

test('골프백의 두 화면은 탭 관계와 현재 선택 상태를 제공한다', () => {
  assert.match(appSource, /role="tablist" aria-label="골프백 관리 메뉴"/)
  assert.match(appSource, /role="tab" aria-selected=\{clubStage === 'composition'\}/)
  assert.match(appSource, /role="tab" aria-selected=\{clubStage === 'distance'\}/)
})

test('홈은 기록이 전혀 없을 때 중복 통계 빈 상태를 만들지 않는다', () => {
  assert.match(appSource, /\{rounds\.length > 0 && <section className="home-report"/)
})

test('모달은 열린 뒤 초점을 받고 Escape로 닫을 수 있다', () => {
  assert.match(appSource, /document\.querySelector\('\.account-layer \.close-button/)
  assert.match(appSource, /event\.key !== 'Escape'/)
  assert.match(appSource, /previouslyFocused instanceof HTMLElement/)
})

test('라운드 수정 화면은 잠금 여부와 관계없이 같은 제목을 사용한다', () => {
  assert.match(appSource, /<h1>\{editingActiveRound \? '라운드 정보' : '새 라운드'\}<\/h1>/)
  assert.doesNotMatch(appSource, /아직 \$\{missingHoleLabel\(\)\} 기록이 남았어요/)
})

test('신규 홀은 임시 저장과 명시적 완료 동작을 함께 제공한다', () => {
  assert.match(appSource, /<div className="hole-save-actions">/)
  assert.match(appSource, />임시 저장<\/button>/)
  assert.match(appSource, /disabled=\{!holeCanFinalize\}>홀 기록 완료<\/button>/)
  assert.match(appSource, /현재 기록/)
  assert.match(appSource, /샷 \{holeCompletion\.swingCount\}/)
  assert.match(appSource, /벌타 \{holeCompletion\.penaltyStrokes\}/)
})

test('샷 클럽은 현재 ID와 당시 표시명 스냅샷을 저장한다', () => {
  assert.match(appSource, /clubId: String\(clubSnapshot\.id\)/)
  assert.match(appSource, /clubSnapshot \}/)
  assert.match(appSource, /과거 사용 클럽/)
})

test('신규 사용자는 티 설정과 클럽 구성을 3단계로 마친다', () => {
  assert.match(appSource, /clubSetupReturn === 'onboarding'/)
  assert.match(appSource, /clubSetupReturn === 'new-round'/)
  assert.match(appSource, /clubSetupReturn === 'onboarding' \? '이 구성으로 시작하기'/)
  assert.match(appSource, /id="onboarding-distance-unit-label">주로 사용하는<br \/>거리 단위<\/span>/)
  assert.match(appSource, /aria-label="기본 거리 단위"/)
  assert.match(appSource, /미터 M/)
  assert.match(appSource, /야드 YD/)
  assert.doesNotMatch(appSource, /비거리는 나중에 입력하기/)
  assert.match(appSource, /온보딩 3\/3 단계/)
  assert.match(appSource, /클럽 정보가 부족해요/)
  assert.match(appSource, /클럽별 비거리도 기록할 수 있어요/)
})

test('신규 골프백은 드라이버와 퍼터만 기본 선택한다', () => {
  const defaultClubBlock = appSource.slice(appSource.indexOf('const initialClubDrafts'), appSource.indexOf('function emptyShot'))
  assert.match(defaultClubBlock, /\['드라이버·우드', '1'\]/)
  assert.match(defaultClubBlock, /퍼터:PT/)
  assert.doesNotMatch(defaultClubBlock, /\['아이언'/)
  assert.doesNotMatch(defaultClubBlock, /\['웨지'/)
})

test('테스트 계정 요청은 로그인 약관 뒤에 간결한 보조 경로로 표시한다', () => {
  const googleButtonIndex = appSource.indexOf('Google로 계속하기')
  const legalIndex = appSource.indexOf('계속하면 서비스 이용약관')
  const testAccessIndex = appSource.indexOf('⚠️ 처음 오신 분만!')
  assert.ok(googleButtonIndex < legalIndex)
  assert.ok(legalIndex < testAccessIndex)
  assert.match(appSource, /placeholder="example@gmail.com"/)
  assert.match(appSource, /'승인 요청'/)
  assert.doesNotMatch(appSource, /신청한 이메일은 테스트 계정 등록을 위해/)
})

test('전체 새소식은 홈과 계정 메뉴에서 같은 정적 목록으로 열린다', () => {
  assert.match(appSource, /className="news-header-button"/)
  assert.match(appSource, /function openNews\(\)/)
  assert.match(appSource, /<MegaphoneIcon \/>/)
  assert.match(appSource, /className="news-unseen-dot"/)
  assert.match(appSource, /screen === 'news'/)
  assert.ok(newsItems.length >= 1)
  assert.ok(newsItems.every(item => item.id && item.date && item.category && item.title && item.body))
  assert.ok(newsItems.every(item => item.title.length <= 30), '새소식 제목은 30자 이내여야 한다')
  assert.ok(newsItems.every(item => item.body.length <= 120), '새소식 본문은 120자 이내여야 한다')
})

test('새소식 점은 최신 글을 해당 기기에서 확인할 때까지 표시한다', () => {
  assert.equal(latestNewsId(newsItems), newsItems[0].id)
  assert.equal(hasUnseenNews(null, newsItems), true)
  assert.equal(hasUnseenNews(newsItems[0].id, newsItems), false)
  assert.equal(newsSeenStorageKey('user-1'), 'golf-and-me:news-seen:user-1')
})
