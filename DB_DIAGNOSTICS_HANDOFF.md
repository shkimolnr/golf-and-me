# Supabase 운영 진단 트랙 handoff

## 범위와 상태

- 작업 브랜치: `codex/supabase-diagnostics`
- 기준 브랜치: `codex/ga4-direct-consent` (`de501ba`)
- 2026-08-31 Production Supabase SQL Editor에서 migration을 적용하고 `app_diagnostics` 테이블 생성을 확인했습니다. Vercel Production에 `SUPABASE_SERVICE_ROLE_KEY`를 Secret으로 등록하고 앱을 배포했습니다. server-role DB 함수는 비식별 test incident의 실패 2회→한 행 count 2→복구 연결을 실제 확인한 뒤 test 행을 삭제했습니다. GA4 설정·인증 브라우저 전송 종단간 검증·보관 삭제 scheduler는 아직 수행하지 않았습니다.
- GA4·GTM·Firebase·Sentry와 분석 동의 UI는 변경하지 않았습니다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `supabase/migrations/202608310002_app_diagnostics.sql` | RLS가 켜진 `app_diagnostics`, service-role 전용 RPC, 보관 삭제 함수 |
| `supabase/rollbacks/202608310002_app_diagnostics_rollback.sql` | 미적용/테스트 환경용 롤백 |
| `api/diagnostics.js` | 인증·서버 필드 검증·짧은 반복 요청 제한·service-role RPC 호출 |
| `src/lib/diagnostics.js` | 허용 단계·분류, 안전한 HTTP 상태·임시 incident·복구 연결 |
| `src/lib/diagnosticsTransport.js` | 최대 20건 로컬 큐, 동일 incident 갱신, 인증된 전송·재시도 |
| `src/App.jsx` | 기존 DB 오류 호출부만 새 transport에 연결하고 profile save·round delete 분류를 보강 |
| `test/diagnostics*.test.js` | DB/서버/전송/개인정보 차단 검증 |

## DB 및 API 계약

브라우저는 테이블에 직접 삽입하지 않습니다. 인증된 `POST /api/diagnostics`만 호출하고, API는 세션을 검증한 뒤 `SUPABASE_SERVICE_ROLE_KEY`로 `record_app_diagnostic` RPC를 실행합니다.

전송·저장하는 필드:

- 임시 `incidentId` (실패와 복구 연결용 난수 UUID)
- `stage`, `category`, 안전한 HTTP 상태
- 앱 버전, 일반화된 플랫폼, 온라인 여부
- 최초/최근 발생 시각, 발생 횟수
- 복구 시각과 지속 시간

명시적으로 전송·저장하지 않는 값:

- 사용자 UUID·이메일·이름·토큰·세션·전체 URL
- 골프장/코스/라운드/홀/샷/클럽·점수·메모·자유 입력
- 원본 오류 메시지·stack trace

인증 확인에는 사용자 UUID를 잠시 사용하지만 DB와 로그에는 저장하지 않습니다. API의 1분 20회 제한도 현재 Vercel 인스턴스 메모리에만 존재하는 보조 방어이며, 영속 제한이 아닙니다. 동일 incident는 DB에서 최신 시각과 최대 발생 횟수로 원자적으로 갱신합니다.

## 현재 연결한 앱 단계

- `oauth`
- `profile_load`, `profile_save`
- `rounds_load`, `rounds_save`, `rounds_delete`
- `club_bag_load`, `club_bag_save`
- `account_delete`

OAuth 시작/콜백이 **로그인 전** 실패한 경우에는 인증된 요청만 허용하는 정책 때문에 원격 DB 진단으로 보내지 않습니다. 로그인 세션이 있는 상태에서의 인증 관련 오류는 `oauth` 단계로 전송할 수 있습니다. 로그인 전 OAuth 실패까지 중앙 수집하려면 별도의 단기 익명 진단 토큰 정책이 필요하며, 이번 결정에는 포함하지 않았습니다.

DB schema는 향후 `distance_history_*`, `local_storage_parse`, `remote_hydration_delay`, `remote_retry`, `api_call`도 받아들이지만, 관련 앱 코드 계측은 이번 범위에 포함하지 않았습니다.

## 큐·복구 규칙

- 같은 stage/category incident는 새 행을 만들지 않고 occurrence count와 최근 시각만 갱신합니다.
- 서로 다른 category는 별도 incident로 유지하고, 정상 복구 시 각각 recovery로 마감합니다.
- 네트워크/API 실패 시 안전한 payload만 기기에 최대 20건 보관합니다. 전송 자체 실패는 다시 진단 이벤트를 만들지 않습니다.
- 로그인 세션이 있고 온라인일 때 재전송하며, 명시적 로그아웃 시 남은 큐를 비워 다른 계정에 전달하지 않습니다.
- 서버는 형식·enum·길이·시간·횟수와 필드 allowlist를 다시 확인합니다.

## 보관

- `purge_expired_app_diagnostics()`는 원시 진단을 마지막 발생 뒤 30일, 복구된 incident를 복구 뒤 7일에 삭제합니다.
- 이 함수의 **실제 정기 실행은 아직 설정하지 않았습니다.** Supabase `pg_cron` 또는 Vercel Cron 중 운영 권한·비용·점검 책임을 정한 뒤 service-role 전용 호출로 연결해야 합니다.

## 검증 결과

- `npm test`: 132 passed, 0 failed
- `npm run build`: passed (전용 worktree에 원본의 `node_modules`를 임시 링크해 실행). `VITE_SUPABASE_URL`이 없는 로컬 빌드 경고만 있으며 생성물·링크는 제거했습니다.
- 2026-08-31 Production SQL Editor에서 비식별 `api_call`/`network` test incident를 실패 2회와 복구 1회로 실행했습니다. 결과는 한 행, `occurrence_count=2`, `recovered=true`, `recovery_duration_ms=5000`이었고 곧바로 해당 UUID 한 행을 삭제한 뒤 0건을 재확인했습니다. 이 검증은 DB 함수 범위이며 인증 브라우저→Vercel API 전송을 대신하지 않습니다.

## 남은 외부·운영 작업

1. 전용 테스트 계정 또는 통제된 네트워크 차단으로 인증 브라우저→Vercel API→Supabase의 실패→재시도→복구를 한 번 검증합니다. incident 중복 합산, 금지 항목 미저장, 전송 실패가 앱을 막지 않는지 함께 확인합니다.
2. `/api/diagnostics`의 Preview 검증을 마친 뒤 `purge_expired_app_diagnostics()`의 실행 주체를 선택·활성화합니다.
3. 개인정보처리방침에 Supabase 최소 운영 진단의 목적·항목·보관기간(30일/복구 7일)·문의 방법·국외 처리 정보를 실제 설정과 맞춰 반영합니다.

## GA4/컨트롤타워 통합 주의점

- `src/lib/analytics.js`에 `diagnostic_failure`, `diagnostic_recovery`를 되살리면 안 됩니다. 이 트랙은 GA4 동의와 독립적으로 동작합니다.
- `src/App.jsx`는 공유 충돌 파일입니다. 이번 변경은 diagnostics import/helper, hydration·저장·OAuth·탈퇴 오류 지점만 만졌습니다. GA4의 analytics import, 동의 UI, `trackEvent`/`trackScreen` 호출부는 유지했습니다.
- 최종 관리 문서와 개인정보처리방침은 컨트롤타워가 GA4 handoff와 이 문서를 함께 기준으로 통합합니다. 필수 결정: **제품 분석은 GA4 선택 동의, 최소 운영 오류 진단은 Supabase 별도 체계이며, 개인정보·골프 기록·자유 입력은 둘 다 전송하지 않는다.**
