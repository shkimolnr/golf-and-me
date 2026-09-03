# Golf & Me Alpha 운영 기준

최종 정리: 2026-09-03

## 1. 환경과 주소

- 프로덕션: `https://golf-and-me.vercel.app`
- 로컬 개발: `http://127.0.0.1:5190/`
- 로그인 없는 프리뷰: 로컬 개발 주소에만 `?preview=1` 사용
- 프로덕션에서는 프리뷰 우회를 활성화하지 않습니다.
- Vercel 기본 도메인은 별도 DNS 설정 없이 HTTPS를 제공합니다. 독립 도메인을 연결할 때만 DNS와 OAuth 허용 주소를 함께 변경합니다.
- 2026-08-30 기준 Vercel Production에서 Google OAuth 로그인과 기존 Supabase 계정 데이터 복원을 확인했습니다.

## 2. 배포 절차

1. `npm test`와 `npm run build`를 통과합니다.
2. 비밀키와 개인정보가 Git 또는 빌드 결과에 포함되지 않았는지 확인합니다.
3. GitHub `main`에 푸시해 연결된 Vercel Production 배포를 시작합니다.
4. Vercel Production 주소에서 로그인 → 홈 → 라운드 열기 → 저장 → 재접속을 확인합니다.
5. 인증 주소를 바꾸면 Supabase Auth의 Site URL·Redirect URL과 Google OAuth 설정을 함께 확인합니다.

문제가 생기면 Vercel의 직전 정상 배포로 롤백합니다. OpenAI Sites의 이전 Alpha 배포는 외부 접근을 종료했고 Supabase Redirect 허용 목록에서도 제거했으므로 운영·롤백 경로로 사용하지 않습니다. DB 마이그레이션은 대응하는 `supabase/rollback/` 파일을 먼저 검토하고, 사용자 데이터가 있는 운영 DB에는 자동 롤백하지 않습니다.

### TASK-051 파생 데이터 무결성 적용 기록

- Preview와 Production에 `202609010002_derived_data_integrity.sql`을 적용해 동일 소유자 복합 FK 3개, 유효한 unique index 3개, 파생 테이블 직접 DML 차단과 payload 동기화 함수·trigger를 확인했습니다.
- Production의 기존 3라운드·54홀은 `202609030001_round_child_integrity_backfill.sql`로 재생성했습니다. 원본 `rounds.payload`·`updated_at`, 전체 라운드 4·홀 72·샷 68·tombstone 0을 보존했고 두 번째 실행 대상은 0입니다.
- 2026-09-03 읽기 전용 재감사에서 Preview는 라운드 0·tombstone 3, Production은 라운드 4·홀 72·샷 68·tombstone 0이었고, 두 환경 모두 002 사후검증 `PASS`, 데이터 불일치·고아 데이터·권한 위반 0이었습니다.
- migration 002 SHA-256은 `65e27a53f2eade4da9e69f127b46c1f70e6a94bb9ad26e538bb01656427d80d6`, backfill SHA-256은 `edbdb1b5bfa4ac15cff6afad869062267d68332df4d8952bc71b4fde9a55f2ed`입니다. 적용 완료된 운영 DB에는 두 migration을 다시 실행하지 않습니다.

### TASK-052 라운드 요약 동기화 적용 기록

- migration 003은 TASK-051 backfill 다음 순서를 보장하도록 `202609030002_round_summary_sync.sql`로 재발행했습니다.
- 2026-09-03 Preview에서 적용 전 READ ONLY gate `READY`·blocker 0·backfill 대상 0을 확인하고 사용자 승인 후 단일 transaction으로 적용했습니다.
- 적용 후 함수 2개와 BEFORE trigger 1개가 승인 hash와 일치하고, payload 검증 위반·summary cache mismatch·002 선행 객체 회귀가 모두 0임을 확인했습니다.
- 같은 날 Production READ ONLY preflight도 `READY`, blocker 0, 기존 4개 라운드의 backfill 대상 0으로 확인한 뒤 사용자 승인에 따라 단일 transaction으로 적용했습니다.
- Production 사후 gate는 `READY`, 대상 함수·trigger는 승인 hash와 정확히 일치했고 summary mismatch·backfill 대상·payload 위반은 모두 0이었습니다. 라운드 4·홀 72·샷 68·tombstone 0도 그대로 보존됐습니다.
- migration 003 SHA-256은 `f2ec50283c62513869a38491c3eb2e17bdd1253305e1c908df67c143d98ce35e`입니다. 적용 완료된 Preview·Production DB에는 다시 실행하지 않습니다.

### Beta 테스트 계정 신청 연결

1. 신청을 받을 비공개 Slack 채널에 Incoming Webhook을 생성합니다.
2. Vercel Production 환경변수 `SLACK_TEST_ACCESS_WEBHOOK_URL`에 Webhook URL을 비밀값으로 등록합니다. `VITE_` 접두사를 붙이지 않고 Git이나 브라우저 번들에 포함하지 않습니다.
3. Vercel Production 환경변수 `VITE_TEST_ACCESS_REQUEST_ENABLED=true`를 등록합니다.
4. 재배포한 뒤 로그인 화면에서 전용 테스트 이메일로 한 번 신청하고 Slack 수신 내용을 확인합니다.
5. Slack 메시지는 모바일에서 이메일만 바로 복사할 수 있도록 신청 이메일 한 줄만 표시합니다. 접수 시각은 Slack 메시지 시각으로 확인하며 IP·브라우저 정보·Golf & Me 기록은 전송하지 않습니다.
6. Golf & Me의 신청 절차는 실제 가입 승인이나 접근 통제로 작동하지 않습니다. 핵심 동기화·DB·진단 작업을 마친 뒤 `VITE_TEST_ACCESS_REQUEST_ENABLED=false` 전환, 신청 UI·API 제거, Slack Webhook 환경변수와 기존 접수 메시지 정리를 후순위로 수행합니다.

2026-08-31 Production에 `Golf and Me Beta Requests` 앱과 비공개 `beta-requests` 채널을 연결했습니다. 테스트 신청은 API `202` 응답과 Slack 메시지 수신을 모두 확인했으며 Webhook URL은 Vercel의 Secret 환경변수에만 보관합니다. 2026-09-02 현장 가입에서 미등록 계정도 정상 가입되는 것을 확인했으므로 이 기능은 접근 통제가 아닌 한시적 신청 알림으로만 간주하며 제거 작업은 후순위입니다.

### Beta 의견 보내기 연결

1. 로그인 회원은 계정 메뉴의 `의견 보내기`에서 500자 이내 자유 텍스트를 전송합니다.
2. `/api/feedback`은 브라우저가 전달한 Supabase 세션 토큰으로 `/auth/v1/user`를 조회해 로그인 회원인지 확인합니다. 토큰과 사용자 응답은 저장하거나 Slack으로 전달하지 않습니다.
3. 전용 채널을 사용할 경우 Vercel Production 환경변수 `SLACK_FEEDBACK_WEBHOOK_URL`에 Incoming Webhook URL을 설정합니다. 없으면 기존 `SLACK_TEST_ACCESS_WEBHOOK_URL` 채널로 임시 전달됩니다.
4. Slack 메시지는 `의견 보내기` 제목과 입력 본문만 포함합니다. 이메일, 사용자 UUID, 골프 기록, IP와 기기·브라우저 정보는 포함하지 않습니다.
5. Production 배포 뒤 실제 로그인 계정에서 테스트 의견 한 건을 보내 Slack 수신과 성공 화면을 확인합니다.

2026-08-31 비공개 `feedback` 채널용 Incoming Webhook을 별도로 생성해 Vercel Production의 `SLACK_FEEDBACK_WEBHOOK_URL`에 Secret으로 등록하고 재배포했습니다. 실제 로그인 계정에서 `연결 테스트입니다`를 전송해 앱 성공 화면과 전용 채널 수신을 모두 확인했습니다. `beta-requests`에는 테스트 계정 신청만, `feedback`에는 회원 의견만 쌓입니다.

### GA4 제품 분석과 Supabase 운영 진단 활성화

1. GA4는 GTM 없이 웹 데이터 스트림을 직접 사용합니다. 광고 기능·Google Signals·리마케팅·광고 개인화는 끄고, Development·Preview·Production의 측정 ID와 `VITE_ANALYTICS_ENV`를 분리합니다. Production 측정 ID를 Preview에 넣으면 앱이 초기화하지 않아야 합니다.
2. Vercel 환경별로 `VITE_GA_MEASUREMENT_ID`, `VITE_ANALYTICS_ENABLED`, `VITE_APP_ENV`, `VITE_ANALYTICS_ENV`를 등록합니다. 실제 ID는 Git에 넣지 않으며, Development는 기본 비활성 상태로 둡니다.
3. Supabase 진단은 먼저 테스트 프로젝트의 백업·롤백 파일을 확인한 뒤 `202608310002_app_diagnostics.sql`을 적용합니다. Vercel에는 `SUPABASE_SERVICE_ROLE_KEY`만 Secret으로 등록하며, `VITE_` 접두사나 브라우저 번들에 절대 포함하지 않습니다. 2026-08-31 Production에는 migration과 Vercel Production Secret 등록, 앱 배포를 완료했습니다.
4. Preview에서 분석 미선택 상태의 GA 요청 부재, 허용 뒤 DebugView의 allowlist 이벤트, 철회 뒤 전송 중단을 확인합니다. 이어서 인증된 `/api/diagnostics`의 실패·반복·복구·큐 재전송을 확인하고 DB에 금지 항목이 없는지 점검합니다. 2026-08-31 Production에서는 서버 전용 DB 함수의 비식별 test incident가 실패 2회에서 한 행의 count 2로 합쳐지고 복구 상태가 연결되는 것을 확인한 뒤 test 행을 삭제했습니다. 이는 브라우저→Vercel API 종단간 검증과는 별도입니다.
5. `purge_expired_app_diagnostics()`의 실제 정기 실행은 아직 설정하지 않았습니다. Supabase `pg_cron` 또는 Vercel Cron의 실행 주체·권한·비용·점검 책임을 확정하고, 인증 브라우저 전송의 실패·복구 검증 뒤 30일 원시 기록·복구 후 7일 삭제를 활성화합니다.
6. GA4는 속성 설정, 개인정보처리방침, Preview DebugView 검증이 모두 끝난 뒤에만 사용자가 Production 활성화를 명시적으로 승인합니다. Supabase 진단은 별도 체계이므로 GA4 동의·활성화와 결합하지 않습니다.

## 3. 저장과 장애 대응

- 라운드와 홀 초안은 기기에 먼저 저장하고 로그인·연결이 준비되면 Supabase에 저장합니다.
- 연결이 끊겨도 입력을 막지 않으며, 연결 복구 후 자동으로 다시 저장합니다.
- 한 번 온라인으로 연 앱은 정적 앱 셸을 기기에 저장해 이후 통신이 끊긴 상태의 재진입·새로고침에서도 입력 화면을 열 수 있게 합니다. 첫 방문 전 완전 오프라인 상태에서는 설치할 앱 셸이 없으므로 열 수 없습니다.
- 삭제 요청도 기기에 대기 상태로 보존해 서버 삭제가 끝날 때까지 해당 기록이 다시 나타나지 않게 합니다.
- 충돌 시 같은 라운드는 `updatedAt`, 같은 홀 초안은 `draftUpdatedAt`이 최근인 원본을 사용합니다.
- 저장 지연 안내에는 기기 저장 여부와 계속 기록해도 되는지를 함께 표시합니다.

### 장애 확인과 대응 순서

1. 사용자에게 새 입력을 막기 전에, 기기 저장이 가능한지와 서버 저장만 지연되는지 구분합니다.
2. `status.supabase.com`과 Vercel 배포 상태를 먼저 확인해 외부 서비스 장애인지 앱 오류인지 나눕니다.
3. DB가 읽히는 상태라면 수정·복구 쿼리보다 현재 데이터 내보내기를 먼저 수행합니다.
4. 브라우저 네트워크 오류, Vercel 로그, Supabase Auth·Database 로그 순서로 원인을 좁힙니다.
5. 연결이 복구되면 로그인, 최근 라운드 수, 마지막 수정 시각, 홀 초안, RLS 계정 분리를 확인합니다.
6. 백업 복원은 아래의 검증된 백업만 사용하며, 운영 DB에 즉흥적인 수정 SQL이나 자동 롤백을 실행하지 않습니다.

사용자 안내는 기술 용어보다 결과를 먼저 말합니다. 기기에는 저장됐지만 서버 저장이 늦을 때는 계속 입력할 수 있음을 알리고, 연결 복구 후 `저장된 기록을 최신 상태로 업데이트했어요.`로 안내합니다.

## 4. 데이터 보존과 삭제

- 사용자 데이터는 Supabase RLS로 로그인 사용자 ID별로 분리합니다.
- 라운드 삭제는 확인 후 즉시 목록과 통계에서 제외하고, 연결된 홀 초안도 함께 제거합니다.
- 클럽 비거리 세트는 화면에 과거 이력을 아직 노출하지 않더라도 원본을 덮어쓰거나 임의 삭제하지 않습니다.
- 현재 Alpha의 라운드 삭제는 복구 기능이 없는 영구 삭제입니다. 휴지통·복구 기간은 후속 범위입니다.
- 계정 메뉴의 `계정 삭제`는 본인 인증 세션으로만 실행되며, 라운드·홀·샷·클럽·비거리 이력을 포함한 서버 계정 데이터와 현재 사용자의 로컬 데이터를 영구 삭제합니다. 실제 계정으로 삭제 회귀시험을 하지 않고 전용 테스트 계정을 사용합니다.
- 계정 탈퇴는 인증 계정과 개인 식별 정보 및 사용자 소유 원본 기록을 실제로 삭제하는 작업입니다. 일반 운영 데이터의 소프트 삭제 관행을 탈퇴 데이터 보존 근거로 사용하지 않습니다.
- 삭제 작업의 성공·실패 확인이 필요하면 사용자와 다시 연결할 수 없는 임의 처리번호, 요청·완료 시각, 삭제 대상 종류·건수, 정책 버전과 처리 상태만 별도 감사 기록으로 보존합니다. 이메일, Google ID와 기존 사용자 UUID는 감사 기록에 남기지 않습니다.
- 백업에 포함된 탈퇴 데이터는 운영 DB로 다시 복원해 사용하지 않으며, 개인정보처리방침에 정한 보관기간과 절차에 따라 접근을 제한하고 최종 소멸합니다. 구체적인 기간을 확정하기 전에는 공개 MVP 출시 조건을 충족한 것으로 보지 않습니다.
- Google OAuth 연결 승인은 앱 데이터 삭제와 별개입니다. 공개 MVP 전 자동 승인 철회 또는 사용자가 Google 계정에서 직접 연결을 해제할 수 있는 안내 중 한 방식을 확정하고 실제 탈퇴 흐름에서 검증합니다.

## 5. 백업과 점검

- 앱 소스와 마이그레이션은 Git 커밋으로 버전을 관리합니다.
- 골프장 홀 정보의 운영 원본은 단일 시트 Excel이며 앱에는 검증 시점의 JSON 스냅샷을 포함합니다.
- 현재 Supabase Free 플랜에는 Pro 이상에서 제공되는 자동 일일 백업을 전제로 하지 않습니다. Free 플랜 운영 중에는 수동 논리 백업을 별도로 만들어야 합니다.
- 스키마 변경, 데이터 마이그레이션, 대량 수정·삭제 전에는 `roles.sql`, `schema.sql`, `data.sql`을 한 세트로 내보냅니다. 백업 파일에는 사용자 데이터가 있으므로 Git에 커밋하지 않고 운영자가 지정한 접근 제한 저장소에 보관합니다.
- 공개 Alpha 동안에는 위 변경 전 백업과 주 1회 백업을 기본 주기로 사용합니다. 백업마다 생성일, 대상 프로젝트, 앱 Git 커밋, 파일 크기와 복구 확인 여부를 기록합니다.
- 백업이 실제 안전장치가 되려면 새 Supabase 테스트 프로젝트에 복원해 로그인·프로필·라운드·홀·샷·클럽·비거리 행과 RLS를 확인해야 합니다. 최초 수동 내보내기와 복구 모의훈련이 끝나기 전에는 `복구 검증 완료`로 표시하지 않습니다.
- Supabase DB 백업은 Storage API의 실제 파일 객체를 포함하지 않습니다. 현재 MVP는 Storage 파일을 사용하지 않지만, 사진·첨부 기능을 도입할 때 DB와 파일 백업을 분리해 추가합니다.
- 사용자가 늘기 전 Pro 자동 일일 백업 또는 PITR 도입 여부를 다시 결정합니다. PITR을 쓰지 않는 동안에는 마지막 수동 백업 이후의 서버 데이터가 손실될 수 있음을 운영 위험으로 남깁니다.
- 실제 iPhone Safari에서는 로그인, 18홀 기록, 화면 잠금·복귀, 오프라인 입력, 완료와 재로그인을 릴리스별 핵심 점검으로 수행합니다.
- 로그인 속도는 2026-08-31 모바일 영상 점검에서 앱 복귀 후 약 0.1~0.5초로 현재 단계 통과했습니다. GA4 직접 연동을 활성화한 뒤에는 `session_restored`와 `records_ready`의 `duration_ms`를 모바일 Safari·데스크톱별로 확인하고, Google 계정 선택에 머문 시간은 앱 로딩 시간에서 분리합니다.
- 분석·진단 활성화 직후에는 `BACKLOG.md`의 `TASK-038`과 `TASK-047` Preview 점검표를 수행합니다. GA4 제품 분석과 Supabase 운영 진단의 수집 범위·동의 기준을 혼합하지 않습니다.

### 라운드 요약 스키마 배포 점검

- `202608310003_round_summary_columns.sql`은 기존 `rounds.payload`를 보존한 채 홈 목록용 요약 컬럼과 `rounds_user_status_played_idx`를 추가하는 비파괴 migration입니다.
- SQL Editor 수동 적용 뒤 요약 컬럼 11개, 인덱스 1개, 기존 라운드 수와 `payload` 보존 여부를 확인합니다. 재실행 가능하도록 migration은 idempotent하게 유지합니다.
- 앱 배포 뒤에는 작성 중 라운드 복원, 완료 목록 표시, 완료 상세 첫 열람, 새로고침 뒤 상세 재열람, 한 홀 수정 시 해당 라운드 한 건만 저장되는지를 확인합니다.
- 2026-08-31 Production 실제 계정에서 완료 라운드 상세 첫 열람·홈 복귀 후 재열람과 작성 중 레이크사이드 11/18홀 기록의 새로고침 복원을 확인했습니다.
- 과거 비거리 세트는 초기 화면에서 내려받지 않더라도 DB에서 삭제하지 않습니다. 최신 세트 표시와 새 세트 저장 후 이전 세트 행 보존을 함께 확인합니다.
- 수동 적용한 migration을 추후 Supabase CLI 이력 관리로 전환할 때는 실제 스키마를 다시 변경하지 말고 migration history를 먼저 대조합니다.

## 6. 공개 테스트 전 필수 보완

### OAuth 콜백 주소 점검

1. Vercel 운영 주소에서 현재 기기 로그아웃 후 Google로 다시 로그인합니다.
2. 앱 복귀 주소에 `access_token`, `refresh_token`, `provider_token`이 없어야 합니다. PKCE의 `code`도 세션 교환이 끝나면 자동으로 사라져야 합니다.
3. 로그인 상태를 유지한 채 새로고침하고 홈·작성 중 기록이 정상 복원되는지 확인합니다.
4. 로그인 실패나 취소 뒤에도 `error_description` 같은 OAuth 오류 파라미터가 주소에 계속 남지 않는지 확인합니다.
5. 과거 implicit 주소가 노출된 테스트 세션은 운영 반영 뒤 로그아웃하고 새 PKCE 세션으로 다시 로그인합니다.

- 서비스 운영자 정보와 문의 채널 확정
- 실제 이용약관·개인정보 처리방침 작성 및 로그인 화면에서 링크 제공
- 운영자·문의처·국외 이전·로그 보관 정보를 확정하고 최종 약관·개인정보 처리방침 게시
- Supabase 최초 수동 백업 생성과 새 테스트 프로젝트 복구 모의훈련
- 실제 iPhone Safari 전체 흐름 최종 검증
- `BACKLOG.md`의 `TASK-032 공개 MVP 출시 차단 체크리스트` 전 항목 완료

위 항목이 완료되기 전 프로덕션 주소는 기능 검증용 Alpha로 취급합니다.

검토용 초안은 `TERMS_OF_SERVICE_DRAFT.md`와 `PRIVACY_POLICY_DRAFT.md`에 보관하며, 대괄호로 표시된 운영자·연락처·국외 이전 정보를 확정하기 전에는 서비스 화면에 최종 정책으로 게시하지 않습니다.
