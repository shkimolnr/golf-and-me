# GA4 트랙 handoff

## 범위와 상태

- 작업 브랜치: `codex/ga4-direct-consent`
- 기준 커밋: `6623461`
- Production 배포, GA4 속성 생성·활성화, Vercel 환경변수 등록은 수행하지 않았습니다.
- GTM, Firebase, Sentry와 Supabase 진단 테이블/API는 이 변경에 포함하지 않았습니다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `.env.example` | GTM 예시를 GA4 직접 연동 환경변수로 교체하고 환경 분리를 명시 |
| `src/lib/analytics.js` | 동의·직접 `gtag.js` 초기화·이벤트별 allowlist·명시적 SPA 화면 이벤트 구현 |
| `src/App.jsx` | 온보딩 전 1회 선택 화면, 계정 메뉴의 철회/재허용, 제품 흐름 이벤트 연결 |
| `src/index.css` | 동의 화면과 계정 메뉴 제어 스타일 |
| `test/analytics.test.js` | 동의, 스크립트, 철회, allowlist, Preview 격리 자동 테스트 |

## 결정된 GA4 동작

- 기본값은 `unknown`(OFF)이며 `golf-and-me:analytics-consent`에 `granted` 또는 `denied`만 기기별로 저장합니다. 로그인 세션과는 연결하지 않습니다.
- 동의 전에는 GA 스크립트를 넣지 않고 이벤트도 보내지 않습니다.
- 허용 시 `https://www.googletagmanager.com/gtag/js?id=...`를 한 번만 추가하며 `send_page_view: false`로 자동 페이지뷰를 끕니다.
- 철회하면 `ga-disable-<measurement-id>`를 설정하고 `trackEvent()`도 동의 상태를 다시 확인해 이후 이벤트 전송을 중단합니다. 이미 내려받은 스크립트 파일 자체는 브라우저 캐시에서 즉시 삭제할 수 없지만, 데이터 전송은 코드와 GA disable 플래그 양쪽에서 막습니다.
- SPA 화면 전환은 `screen_view`와 허용된 익명 화면명으로만 전송합니다. React Strict Mode의 중복 렌더링은 마지막 화면 ref로 방지합니다.
- `VITE_APP_ENV`와 `VITE_ANALYTICS_ENV`가 정확히 같은 경우에만 초기화합니다. Preview는 Preview 전용 측정 ID를 쓰거나 `VITE_ANALYTICS_ENABLED=false`여야 하며, Production ID를 Preview에 넣으면 초기화되지 않습니다.
- `diagnostic_failure`, `diagnostic_recovery`, `recordDiagnosticEvent`는 GA 코드에서 제거했습니다. 운영 오류의 영속·전송은 DB 트랙만 담당합니다.

## 제품 이벤트와 허용 매개변수

| 이벤트 | 허용 매개변수 |
|---|---|
| `screen_view` | `screen_name`: login, onboarding, home, new_round, clubs, scorecard, hole_detail, round_result, news, feedback |
| `login_start` | `stage`: oauth_request |
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

## 검증 결과

- `npm test`: 123 passed, 0 failed
- `npm run build`: passed
- 빌드 시 기존 `index.html`의 `VITE_SUPABASE_URL` 미설정 경고만 발생했습니다. GA 변경 실패가 아니며 실제 환경변수를 넣으면 해소됩니다.

## 사용자가 해야 할 일 — 아직 실행하지 않음

1. GA4에서 광고 기능, Google Signals, 리마케팅·광고 개인화를 끄고 웹 데이터 스트림을 만듭니다.
2. Development/Preview/Production을 분리합니다. Development는 `VITE_ANALYTICS_ENABLED=false`, Preview는 비활성화 또는 별도 Preview 속성 ID, Production은 별도 Production 속성 ID를 사용합니다.
3. 각 Vercel 환경에 아래를 해당 환경 값으로 등록합니다. 실제 ID는 저장소에 커밋하지 않습니다.

   ```text
   VITE_GA_MEASUREMENT_ID=G-...
   VITE_ANALYTICS_ENABLED=true|false
   VITE_APP_ENV=development|preview|production
   VITE_ANALYTICS_ENV=development|preview|production
   ```

4. GA4 데이터 보관기간을 가능한 짧게 설정하고 내부 운영자/개발자 트래픽 필터를 검토합니다.
5. Preview에서 테스트할 경우 Preview 전용 속성의 DebugView를 열고, 허용 전 네트워크 요청이 없는지와 허용 후 각 이벤트·매개변수를 확인합니다.
6. 개인정보처리방침 확정, GA4 실제 설정 검토, DebugView 검증 뒤에만 Production 활성화를 승인합니다.

## DebugView·수동 확인 시나리오

1. 깨끗한 브라우저 저장소에서 로그인 후 온보딩 선택 화면이 보이는지 확인합니다. 개발자 도구 Network에서 허용 전 `googletagmanager.com/gtag/js`와 `google-analytics.com` 요청이 없어야 합니다.
2. `괜찮아요`를 선택합니다. 온보딩과 기록 기능은 계속 작동하고 GA 요청은 계속 없어야 합니다.
3. 계정 메뉴에서 분석 허용을 켭니다. 스크립트가 한 번만 로드되고 DebugView에 `screen_view` 이후의 허용 이벤트만 보여야 합니다.
4. 온보딩, 새 라운드, 홀 임시 저장, 홀 완료, 1/3/9/18홀, 라운드 완료, 결과 화면을 진행합니다. 표의 이벤트와 매개변수만 확인합니다.
5. 계정 메뉴에서 다시 끕니다. 이후 화면 전환·기록에 대해 GA 요청과 DebugView 이벤트가 새로 생기지 않아야 합니다. 서비스 기능은 유지되어야 합니다.
6. 모바일 Safari에서도 `허용`과 `괜찮아요` 모두 눌리는지, 텍스트가 잘리지 않는지 확인합니다.

## 컨트롤타워 통합 주의점

- 현재 main의 미커밋 `analytics.js`/`App.jsx`는 GA4와 운영 진단을 함께 전송하는 이전 구조입니다. 이 브랜치를 통합할 때 `recordDiagnosticEvent` 경로를 되살리지 마세요.
- 공유 충돌 지점은 `src/App.jsx`의 analytics import, 진단 helper, OAuth/원격 hydration/계정 삭제 호출부와 계정 메뉴입니다. DB 트랙이 diagnostics transport를 넣을 때 GA 코드와 수동으로 병합해야 합니다.
- `README.md`, `PRD.md`, `DECISIONS.md`, `OPERATIONS.md`, `BACKLOG.md`, `PROJECT_RULES.md`, `PRIVACY_POLICY_DRAFT.md`의 최종 통합은 컨트롤타워가 합니다. 반드시 반영할 결정은 다음입니다: **Golf & Me는 GTM·Firebase를 사용하지 않고 GA4를 직접 연동하며, 제품 분석은 선택 동의 대상이다. 최소 운영 오류 진단은 Supabase 별도 체계로 분리하고, 개인정보·골프 기록·자유 입력은 어느 쪽에도 보내지 않는다.**

## 남은 작업

- DB 트랙: Supabase `app_diagnostics`, 서버 API, RLS, rate limit/dedupe/queue/보관·삭제 정책 및 테스트.
- 컨트롤타워: 위 관리문서·처리방침을 실제 설정과 일치하도록 갱신하고, UI 문구의 “오류 발생 여부”가 GA 제품 분석이 아닌 별도 최소 운영 진단을 뜻한다는 점을 고지에서 명확히 검토.
- 운영: GA4 속성·Vercel 환경변수·DebugView 검증 및 Production 활성화 승인.
