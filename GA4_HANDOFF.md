# GA4 트랙 handoff

## 범위와 상태

- 작업 브랜치: `codex/ga4-consent-audit`
- 기준 커밋: `d1fde41`
- 기존 GA4 직접 연동이 main에 통합된 상태에서 동의 UX와 재접속 초기화만 추가 점검했습니다.
- Production 배포, GA4 속성 생성·활성화, Vercel 환경변수 등록은 수행하지 않았습니다.
- GTM, Firebase, Sentry와 Supabase 진단 테이블/API는 이 변경에 포함하지 않았습니다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `.env.example` | GTM 예시를 GA4 직접 연동 환경변수로 교체하고 환경 분리를 명시 |
| `src/lib/analytics.js` | 동의·직접 `gtag.js` 초기화·이벤트별 allowlist·명시적 SPA 화면 이벤트 구현 |
| `src/App.jsx` | 온보딩을 막지 않는 1회 선택 안내, 저장된 허용 상태의 재접속 초기화, 개발 전용 신규 온보딩 확인 경로 |
| `src/index.css` | 동의 화면과 계정 메뉴 제어 스타일 |
| `test/analytics.test.js` | 동의, 스크립트, 철회, allowlist, Preview 격리 자동 테스트 |

## 결정된 GA4 동작

- 기본값은 `unknown`(OFF)이며 `golf-and-me:analytics-consent`에 `granted` 또는 `denied`만 기기별로 저장합니다. 로그인 세션과는 연결하지 않습니다.
- 동의 전에는 GA 스크립트를 넣지 않고 이벤트도 보내지 않습니다.
- 선택 안내는 온보딩 위에 함께 표시되며, 선택하지 않아도 `시작하기`와 다음 단계를 진행할 수 있습니다.
- 이전에 허용한 기기에서는 새로고침·재접속 후 저장된 상태를 읽어 GA4를 다시 초기화합니다.
- 허용 시 `https://www.googletagmanager.com/gtag/js?id=...`를 한 번만 추가하며 `send_page_view: false`로 자동 페이지뷰를 끕니다.
- OAuth 코드·토큰·오류값이 주소에 남은 동안은 초기화를 보류하고 주소 정리 후 시작합니다. 설정에서도 `page_referrer`를 비우고 Google Signals·광고 개인화 신호를 명시적으로 끕니다.
- 철회하면 `ga-disable-<measurement-id>`를 설정하고 `trackEvent()`도 동의 상태를 다시 확인해 이후 이벤트 전송을 중단합니다. 이미 내려받은 스크립트 파일 자체는 브라우저 캐시에서 즉시 삭제할 수 없지만, 데이터 전송은 코드와 GA disable 플래그 양쪽에서 막습니다.
- SPA 화면 전환은 `screen_view`와 허용된 익명 화면명으로만 전송합니다. React Strict Mode의 중복 렌더링은 마지막 화면 ref로 방지합니다.
- `VITE_APP_ENV`와 `VITE_ANALYTICS_ENV`가 정확히 같은 경우에만 초기화합니다. Preview는 Preview 전용 측정 ID를 쓰거나 `VITE_ANALYTICS_ENABLED=false`여야 하며, Production ID를 Preview에 넣으면 초기화되지 않습니다.
- `diagnostic_failure`, `diagnostic_recovery`, `recordDiagnosticEvent`는 GA 코드에서 제거했습니다. 운영 오류의 영속·전송은 DB 트랙만 담당합니다.

## 제품 이벤트와 허용 매개변수

| 이벤트 | 허용 매개변수 |
|---|---|
| `screen_view` | `screen_name`: login, onboarding, home, new_round, clubs, scorecard, hole_detail, round_result, news, feedback |
| `auth_attempt` | `stage`: oauth_request — 사용자 의미는 `로그인 시작` |
| `login_success` | `stage`: session_restored, records_ready; `duration_ms`: 0~24시간 |
| `login_fail` | `stage`: oauth_start, oauth_callback |
| `onboarding_step` | `step`: 1~3; `status`: viewed, complete |
| `onboarding_complete` | `status`: complete |
| `club_setup_complete` | `status`: saved; `source`: onboarding, account |
| `round_create` | `is_manual_course`, `has_course_data` (boolean) |
| `hole_start`, `hole_draft_save`, `hole_complete`, `round_result_view` | `completed_holes`: 0~18 |
| `round_milestone` | `milestone`: 1, 3, 9, 18; `completed_holes`: 0~18 |
| `round_complete` | `completed_holes`: 18; `duration_ms`: 0~24시간 |
| `save_delayed` | `stage`: offline, remote_load, remote_save; `online` |
| `save_recovered` | `stage`: remote_load, remote_save; `online`: true |
| `account_delete_complete` | `status`: success |

이외 이벤트, 누락·형식 오류 매개변수, 이메일·UUID·토큰·전체 URL·골프장/코스명·스코어·홀/샷/클럽 원본·메모·자유 입력·원본 오류/stack은 전송하지 않습니다. 각 이벤트는 자기 schema에 정의된 모든 필수 매개변수가 유효할 때만 전송합니다.

GA4가 분석 동의 상태에서 기본 측정을 위해 자동 생성하는 `first_visit`, `session_start`, `user_engagement`는 위 17개 앱 제품 이벤트와 구분한 기술 이벤트로 허용합니다. 이 이벤트도 동의 전·철회 후에는 전송하지 않으며 광고 개인화에는 사용하지 않습니다.

## 검증 결과

- `npm test`: 156 passed, 0 failed
- `npm run build`: passed
- 빌드 시 기존 `index.html`의 `VITE_SUPABASE_URL` 미설정 경고만 발생했습니다. GA 변경 실패가 아니며 실제 환경변수를 넣으면 해소됩니다.
- 모바일 크기(390×844) 로컬 확인: 동의 안내와 `시작하기`가 함께 보이고, 미선택 상태로 2/3 단계 진입 후에도 서비스 흐름이 유지됐습니다.
- 개발 전용 재현 주소는 `?preview=1&onboarding=1`입니다. `import.meta.env.DEV` 조건이라 Production에서는 활성화되지 않습니다.
- 제품 이벤트 중복 감사: 완료 홀 열람·수정은 `hole_start`·`hole_complete`·`round_milestone`을 다시 만들지 않고, 같은 온보딩 단계 완료와 같은 저장 지연 재시도는 세션에서 한 번만 집계합니다. 원격 조회 실패에는 누락돼 있던 `save_delayed(remote_load)`를 복구 이벤트와 짝지었습니다.

## Production 활성화 전 남은 일

Preview 전용 계정·속성·웹 스트림과 Vercel 브랜치 환경 분리는 완료했습니다. Development는 비활성 상태이며 Production은 변경하지 않았습니다. Production 승인 시 별도 Production 속성·스트림과 아래 환경값을 준비합니다. 실제 ID는 저장소에 커밋하지 않습니다.

   ```text
   VITE_GA_MEASUREMENT_ID=G-...
   VITE_ANALYTICS_ENABLED=true|false
   VITE_APP_ENV=development|preview|production
   VITE_ANALYTICS_ENV=development|preview|production
   ```

1. GA4 데이터 보관기간을 가능한 짧게 설정하고 내부 운영자/개발자 트래픽 필터를 검토합니다.
2. 개인정보처리방침 확정과 GA4 실제 설정 검토 뒤에만 Production 활성화를 승인합니다.

## 외부 설정 기준

| 서비스 | 환경 | 항목 | 목적 | 기대 결과 | 검증 방법 |
|---|---|---|---|---|---|
| GA4 | 공통 | Golf & Me 계정·속성 생성, 광고 기능·Google Signals·리마케팅 비활성화, 짧은 보관기간 설정 | 제품 분석 전용 속성 준비 | 광고 목적 기능 없이 선택 동의 데이터만 수집할 기반 확보 | GA4 관리 화면의 데이터 설정·보관·신호 설정 캡처와 값 교차검증 |
| GA4 | Preview | Preview 전용 웹 데이터 스트림 생성 | Production 데이터와 테스트 이벤트 분리 | `G-...` 형식의 Preview 측정 ID 발급 | DebugView에서 Preview 기기 이벤트만 표시되는지 확인 |
| Vercel | Preview | `VITE_GA_MEASUREMENT_ID`, `VITE_ANALYTICS_ENABLED=true`, `VITE_APP_ENV=preview`, `VITE_ANALYTICS_ENV=preview` | 검증용 빌드에서만 GA4 활성화 | 환경 일치 시에만 Preview GA 스크립트 로드 | 배포 환경변수 범위 확인 후 분석 거부·허용·철회 시나리오 실행 |
| GA4/Vercel | Production | Production 웹 스트림·측정 ID와 Production 환경변수 | 공개 서비스 제품 분석 활성화 | Preview와 분리된 Production 이벤트 수집 | 사용자 승인, 처리방침 확정, Preview DebugView 통과 후 별도 Production 검증 |

Production 행은 사용자 승인 전 실행하지 않습니다. 실제 측정 ID나 비밀값은 저장소와 handoff에 기록하지 않습니다.

## DebugView·수동 확인 시나리오

1. 깨끗한 브라우저 저장소에서 로그인 후 온보딩 선택 화면이 보이는지 확인합니다. 개발자 도구 Network에서 허용 전 `googletagmanager.com/gtag/js`와 `google-analytics.com` 요청이 없어야 합니다.
2. `괜찮아요`를 선택합니다. 온보딩과 기록 기능은 계속 작동하고 GA 요청은 계속 없어야 합니다.
3. 계정 메뉴에서 분석 허용을 켭니다. 스크립트가 한 번만 로드되고 DebugView에 `screen_view` 이후의 허용 이벤트만 보여야 합니다.
4. 온보딩, 새 라운드, 홀 임시 저장, 홀 완료, 1/3/9/18홀, 라운드 완료, 결과 화면을 진행합니다. 표의 이벤트와 매개변수만 확인합니다.
5. 계정 메뉴에서 다시 끕니다. 이후 화면 전환·기록에 대해 GA 요청과 DebugView 이벤트가 새로 생기지 않아야 합니다. 서비스 기능은 유지되어야 합니다.
6. 모바일 Safari에서도 `허용`과 `괜찮아요` 모두 눌리는지, 텍스트가 잘리지 않는지 확인합니다.

## 2026-09-01 로컬 Preview 종단 검증

실제 GA4 속성을 오염시키지 않도록 테스트 측정 ID `G-TEST1234`와 Preview 환경 일치 조건으로 브라우저 검증했습니다.

- 동의 전 GA 스크립트: 0개
- `허용` 직후 GA 스크립트: 1개
- 계정 메뉴에서 철회: 체크 해제, 새 스크립트 추가 없음
- 재허용: 체크 복원, 스크립트는 계속 1개로 중복 없음
- 새로고침: 허용 상태 유지, 스크립트 1개로 재초기화
- 동의 안내와 온보딩 `시작하기`는 함께 표시되며 서비스 흐름을 막지 않음

로컬 시나리오 검증 뒤 실제 Preview 측정 ID를 연결해 아래 종단 검증까지 완료했습니다.

## 2026-09-01 실제 GA4 Preview 종단 검증

- Analytics 계정 `Golf & Me`, 속성 `Golf & Me Preview`, Preview 전용 웹 스트림을 사용했습니다.
- 측정 ID와 분석 활성화 값은 Vercel의 `codex/preview-diagnostics` Preview 브랜치에만 적용했습니다. Production은 변경하지 않았습니다.
- 배포 `75ad883`에서 실시간 활성 사용자 1명과 `screen_view`, `user_engagement`, `first_visit`, `session_start`, `save_delayed`, `save_recovered` 수신을 확인했습니다.
- Preview 이벤트에만 `debug_mode`를 붙여 DebugView에서 `screen_view`와 `user_engagement`를 확인했습니다.
- 실제 URL·query·fragment·referrer는 보내지 않고 `page_location=https://golf-and-me.invalid/`, 고정 `page_title`, 빈 referrer만 전송되는 것을 DebugView에서 확인했습니다.
- 분석 허용을 끈 뒤 새소식 화면 전환과 새로고침을 실행해도 추가 이벤트가 생기지 않았습니다. 검증 후 기존 허용 상태로 복원했습니다.
- 거부 상태에서 같은 Preview 주소를 새 문서로 다시 열었을 때 GA 스크립트는 0개였고, 새소식 화면으로 이동한 뒤에도 0개를 유지했습니다. DebugView에도 거부 전 마지막 이벤트 이후 신규 이벤트가 없었으며 로그인·홈·새소식 기능은 정상 작동했습니다. 검증 후 허용을 다시 켰을 때 스크립트는 정확히 1개였습니다.
- 이메일·UUID·토큰·골프장명·스코어·홀/샷/클럽 원본·메모·자유 입력은 DebugView 이벤트 매개변수에 없었습니다.
- 최종 Preview 배포 `ae0d42b`에서 로그아웃 후 Google 재로그인 1회를 실행했습니다. DebugView의 실제 발생 순서는 `screen_view → auth_attempt → login_success → screen_view`였고, `auth_attempt`와 해당 로그인 흐름의 `login_success`는 각각 정확히 1회였습니다. Google 계정 선택 화면까지의 click 동작은 네트워크·페이지 로딩을 포함해 582ms였으며 앱 코드가 추가한 대기 시간은 0ms였습니다.
- 사용자 의미인 `로그인 시작`의 실제 GA4 이벤트명은 `auth_attempt`, 매개변수는 `stage=oauth_request`로 확정합니다. 기존 `login_start`는 실제 Preview에서 수신되지 않아 운영 이벤트명으로 사용하지 않습니다.
- 후속 Preview 재로그인 검증에서 `auth_attempt(stage=oauth_request)`는 1회, `login_success`는 `session_restored`와 `records_ready`가 각각 1회 수신됐습니다. `duration_ms`는 각각 16,616ms와 17,208ms로 허용 범위 안이었고, 실제 순서도 `auth_attempt → session_restored → records_ready`와 일치했습니다. 두 성공 이벤트의 `page_location`은 고정 비식별 값이었고 `non_personalized_ads=1`도 유지됐습니다.
- 관리 설정을 읽기 전용으로 재확인한 결과 이벤트 데이터 보관은 2개월, 사용자 데이터 보관은 14개월이며 `새 사용자 활동 발생 시 재설정`은 켜져 있습니다. `Internal Traffic` 제외 필터는 테스트 상태지만 웹 스트림의 내부 트래픽 규칙은 0개라 현재 제외되는 트래픽은 없습니다. Preview는 검증 활동을 보는 환경이므로 내부 트래픽 제외 규칙은 만들지 않고, 보관기간은 현재 최소값을 유지합니다. 재활동 시 보관 재설정을 끌지는 별도 승인 후 결정합니다.

## 컨트롤타워 통합 주의점

- GA4 제품 분석과 Supabase 운영 진단은 분리된 현재 구조를 유지합니다. GA4 경로에 `recordDiagnosticEvent`를 다시 연결하거나 운영 진단 데이터를 섞지 마세요.
- 공유 충돌 지점은 `src/App.jsx`의 analytics import, 진단 helper, OAuth/원격 hydration/계정 삭제 호출부와 계정 메뉴입니다. DB 트랙이 diagnostics transport를 넣을 때 GA 코드와 수동으로 병합해야 합니다.
- `README.md`, `PRD.md`, `DECISIONS.md`, `OPERATIONS.md`, `BACKLOG.md`, `PROJECT_RULES.md`, `PRIVACY_POLICY_DRAFT.md`의 최종 통합은 컨트롤타워가 합니다. 반드시 반영할 결정은 다음입니다: **Golf & Me는 GTM·Firebase를 사용하지 않고 GA4를 직접 연동하며, 제품 분석은 선택 동의 대상이다. 최소 운영 오류 진단은 Supabase 별도 체계로 분리하고, 개인정보·골프 기록·자유 입력은 어느 쪽에도 보내지 않는다.**

## 남은 작업

- DB 트랙: Supabase `app_diagnostics`, 서버 API, RLS, rate limit/dedupe/queue/보관·삭제 정책 및 테스트.
- 컨트롤타워: 위 관리문서·처리방침을 실제 설정과 일치하도록 갱신하고, UI 문구의 “오류 발생 여부”가 GA 제품 분석이 아닌 별도 최소 운영 진단을 뜻한다는 점을 고지에서 명확히 검토.
- 운영: GA4 속성·Vercel 환경변수·DebugView 검증 및 Production 활성화 승인.
