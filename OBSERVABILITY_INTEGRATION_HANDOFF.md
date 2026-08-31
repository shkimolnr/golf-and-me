# 관측 체계 통합 handoff

## 통합 기준

- 통합 브랜치: `codex/observability-integration`
- 포함 커밋: `de501ba Add consented direct GA4 analytics`, `9d84268 Add Supabase operational diagnostics`
- 코드 커밋은 이미 DB 트랙이 GA4 트랙을 부모로 두고 있어 두 커밋 사이의 Git 충돌은 없습니다.
- 이 문서와 관리 문서 변경 당시에는 실제 GA4·Vercel·Supabase 설정, DB migration, Preview/Production 배포를 실행하지 않았습니다. 이후 2026-08-31 Production Supabase에 `app_diagnostics` migration을 적용하고 테이블 생성을 확인했습니다.

## 확정 정책 초안

1. GTM, Firebase, Crashlytics, Sentry는 사용하지 않습니다.
2. 제품 분석은 GA4 직접 `gtag.js` 연동입니다. 기본값은 OFF이며, 동의 전 스크립트를 로드하지 않고 철회 뒤 이후 이벤트 전송을 멈춥니다.
3. 운영 오류 진단은 GA4와 분리된 Supabase `app_diagnostics` + 인증된 Vercel API입니다. GA4 거부가 최소 운영 진단을 끄지 않습니다.
4. 양쪽 모두 이메일·사용자 UUID·Google 토큰·전체 URL·골프 기록·자유 입력·원본 오류·stack을 보내지 않습니다. UUID는 진단 API 인증에서만 일시 확인하고 DB·로그에 저장하지 않습니다.
5. 운영 진단의 기본 삭제 기준은 원시 기록 30일, 복구 incident 7일입니다. 실제 scheduler·정책 게시 전에는 운영 수집을 활성화하지 않습니다.

## `main` dirty 변경과의 충돌 관리

현재 `main`에는 다음 미커밋 변경이 있습니다.

- 문서: `.env.example`, `README.md`, `BACKLOG.md`, `DECISIONS.md`, `OPERATIONS.md`, `PRD.md`, `PROJECT_RULES.md`
- 이전 GA 임시 구현: `src/App.jsx`, `src/index.css`, `src/lib/analytics.js`, `test/analytics.test.js`
- 별도 미추적 산출물: `.tmp-ppt-review/`, `.tmp-yardage-review/`, `outputs/`

따라서 `main`을 이 브랜치에 병합하거나 이 브랜치를 `main`에 덮어쓰면 안 됩니다. 특히 기존 문서는 “GTM/GA4와 단일 분석 동의가 오류 진단도 제어”하는 이전 정책이고, 새 초안은 이를 “GA4 제품 분석 / Supabase 운영 진단”으로 분리합니다.

컨트롤타워 병합 순서:

1. `de501ba`와 `9d84268`의 코드 diff를 기준으로 새 작업 브랜치에 반영합니다.
2. `main`의 dirty 문서에서 관측 체계와 무관한 문장만 한 줄씩 재검토해 보존합니다.
3. 이 브랜치의 7개 관리 문서와 개인정보처리방침 초안을 기준으로 정책 문구를 수동 통합합니다.
4. 이전 `recordDiagnosticEvent`/`diagnostic_failure` GA4 경로는 되살리지 않습니다.
5. `.tmp-*`, `outputs/`는 관측 체계와 무관하므로 그대로 둡니다.

공유 파일 중 수동 대조가 필요한 위치:

- `src/App.jsx`: GA4 import·동의 UI·화면 이벤트와 Supabase diagnostics import·helper·hydration/저장/탈퇴 호출부
- `src/lib/analytics.js`, `test/analytics.test.js`, `src/index.css`: GA4 트랙 소유
- `src/lib/diagnostics.js`, `src/lib/diagnosticsTransport.js`, `api/diagnostics.js`, migration·diagnostics test: DB 트랙 소유
- `.env.example`: GA4 공개 환경변수와 Vercel 전용 `SUPABASE_SERVICE_ROLE_KEY` 설명을 한 문서에서 혼동하지 않도록 대조

## staging 수동 병합 결과

- staging 브랜치: `codex/observability-main-integration`
- 기준 커밋: current main dirty baseline `d461ebe Preserve current main changes for observability integration`
- 병합 대상: `955270a Document observability integration` (선행 코드 `de501ba`, `9d84268` 포함)
- 충돌 파일 11개(`.env.example`, 관리 문서 6개, `src/App.jsx`, `src/index.css`, `src/lib/analytics.js`, `test/analytics.test.js`)는 main을 수정하지 않고 staging에서 한 블록씩 수동 대조했습니다.
- 관측 정책 충돌은 `DEC-060`의 확정 정책을 우선했습니다. 즉, 이전 `recordDiagnosticEvent`·`diagnostic_failure`/`diagnostic_recovery` GA4 경로와 “하나의 동의가 오류 진단도 제어”한다는 문구는 제거했습니다.
- `src/App.jsx`의 관측 외 기존 변경과 자동으로 병합된 부분은 유지했습니다. 관측 변경은 GA4의 `getAnalyticsConsent`·명시적 화면 이벤트·온보딩 선택 UI와 Supabase 진단 transport·재시도 복구 연결만 추가했습니다.
- `PRIVACY_POLICY_DRAFT.md`의 main 기존 초안은 보존하고, GA4 선택 분석과 독립 운영 진단의 항목·보유기간·국외 처리 확인 항목만 추가했습니다.
- staging 결과 검증: `npm test` 132 passed, `npm run build` 성공. 로컬 환경의 기존 `%VITE_SUPABASE_URL%` 미설정 경고만 발생했으며 실제 환경변수·migration·Secret·배포는 실행하지 않았습니다.

## Preview 배포 전 검증 시나리오

### 0. 코드·DB 준비

1. 통합 브랜치에서 `npm test`, `npm run build`, `git diff --check`를 실행합니다.
2. Supabase 테스트 프로젝트의 백업과 `202608310002_app_diagnostics_rollback.sql`을 확인한 뒤 migration을 적용합니다.
3. Vercel Preview에만 해당 테스트 프로젝트의 `SUPABASE_SERVICE_ROLE_KEY`를 Secret으로 등록합니다. 브라우저 번들·Git·VITE 변수에는 넣지 않습니다.
4. Preview GA4는 비활성화하거나 Preview 전용 측정 ID를 사용합니다. Production 측정 ID를 Preview 변수에 넣지 않습니다.

### 1. GA4 동의·이벤트

1. 깨끗한 브라우저 저장소로 Preview에 로그인해 온보딩 전 선택 화면을 확인합니다.
2. 선택 전과 `괜찮아요` 선택 뒤 DevTools Network에서 `googletagmanager.com/gtag/js`, `google-analytics.com` 요청이 없는지 확인합니다. 로그인·온보딩·라운드 기록은 계속 동작해야 합니다.
3. 계정 메뉴에서 허용을 켜고, 스크립트가 한 번만 로드되며 Preview GA4 DebugView에 `screen_view`와 허용 이벤트만 보이는지 확인합니다.
4. 온보딩, 클럽 구성, 라운드 생성, 홀 임시 저장·완료, 1/3/9/18홀, 라운드 완료·결과를 진행합니다. 이벤트명·매개변수가 `GA4_HANDOFF.md` 표와 일치하고 금지 정보가 없는지 확인합니다.
5. 계정 메뉴에서 다시 끈 뒤 화면 전환·기록을 해도 새 GA 요청과 DebugView 이벤트가 없는지 확인합니다.
6. 모바일 Safari에서 선택 화면 버튼이 동등하게 동작하고 핵심 흐름을 막지 않는지 확인합니다.

### 2. Supabase 운영 진단

1. 로그인 상태의 Preview에서 브라우저 Network request blocking으로 Preview Supabase REST 요청만 일시 차단한 뒤 새로고침합니다. `profile_load` 또는 해당 조회 실패가 안전한 진단으로 저장되는지 운영 DB에서 확인합니다.
2. 차단을 해제하고 자동 재시도 뒤 정상 복구합니다. 동일 incident의 최근 시각·횟수가 갱신되고 recovery 시각·duration이 연결되는지 확인합니다.
3. 같은 오류를 반복해도 새 행이 계속 늘지 않는지, DB 행에 이메일·UUID·토큰·URL·골프 데이터·원본 오류·stack이 없는지 확인합니다.
4. 일시 오프라인 또는 API 5xx 상황에서도 홀 입력·기기 저장이 멈추지 않는지, 안전한 큐가 최대 20건으로 제한되고 온라인 복구 후 재전송되는지 확인합니다.
5. Vercel Function 로그에 요청 본문·Authorization 토큰·Supabase 원본 오류가 출력되지 않는지 확인합니다.
6. 보관 삭제 scheduler는 이 Preview 시나리오를 통과하고 실행 책임을 확정하기 전까지 켜지 않습니다.

## 사용자 설정 체크리스트 — 아직 실행하지 않음

- [ ] GA4 계정/속성과 Preview·Production 웹 데이터 스트림 생성
- [ ] GA4 광고 기능, Google Signals, 리마케팅·광고 개인화 비활성화 및 보관기간·내부 트래픽 필터 확인
- [ ] Vercel 환경별 `VITE_GA_MEASUREMENT_ID`, `VITE_ANALYTICS_ENABLED`, `VITE_APP_ENV`, `VITE_ANALYTICS_ENV` 등록
- [ ] Supabase 테스트 프로젝트 백업·migration·rollback 확인, Preview에서 `app_diagnostics` API 검증
- [ ] Vercel Preview/Production Secret `SUPABASE_SERVICE_ROLE_KEY` 등록 (절대 `VITE_` 사용 금지)
- [ ] `purge_expired_app_diagnostics()` 실행 주체를 Supabase `pg_cron` 또는 Vercel Cron 중 선택하고 권한·비용·점검 책임 확정
- [ ] 개인정보처리방침의 운영자·문의처·국외 이전·수탁자·GA4 보관기간·진단 보관기간을 실제 설정과 대조
- [ ] GA4 DebugView, Supabase 진단 DB, Vercel 로그의 Preview 증거를 검토한 뒤 Production 활성화를 명시적으로 승인
