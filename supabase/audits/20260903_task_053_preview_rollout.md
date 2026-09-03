# TASK-053 Preview rollout

기준일: 2026-09-03

대상 환경: `Golf&Me Preview` (`bfwcxhdosuzitgcwcywe`)

대상 migration: `202609030003_home_round_state.sql`

SHA-256: `f70264d8358fe4a5fca1a487354414ed79b4a7e4128acd980dec50ff03c3a832`

## 사전 조건

- TASK-052 기준선: `READY`, blocker 0, summary mismatch 0
- TASK-053 preflight: `READY`, blocker 0
- 대상 함수와 index: 적용 전 `absent_expected`
- 기존 Preview 데이터: rounds 0, completed 0, missing summary 0

## 적용 결과

- Supabase SQL Editor에서 전체 migration 원문 5,417자를 로컬 파일과 byte-for-byte 대조
- 단일 transaction 실행 성공: `Success. No rows returned`
- `public.get_home_round_state(integer, jsonb)`: 1개
- 함수 MD5: `e43f9ab00acc164c18ca3c38cc8f059d`
- 함수 속성: `SECURITY INVOKER`, `STABLE`
- `rounds_user_status_played_updated_id_idx`: 존재
- 실행 권한: `authenticated=true`
- 실행 차단: `public=false`, `anon=false`, `service_role=false`
- 적용 후 Preview 데이터: rounds 0, completed 0, missing summary 0

## 판정

TASK-053 DB migration의 Preview 적용은 `PASS`입니다. 기존 데이터 변경은 없으며 Production은
접속·변경하지 않았습니다. 다음 단계는 TASK-053 client를 Preview 브랜치에 배포한 뒤 홈 초기
응답, 더 보기, 상세 지연 로딩, 오프라인 merge 및 삭제 우선 규칙을 실제 Preview에서 검증하는
것입니다.

## Client Preview 배포

- 최신 `origin/main`과 Preview 전용 GA4·진단 변경을 merge해 둘 다 보존
- TASK-053 코드·migration·감사 기록을 `codex/preview-diagnostics`에 fast-forward push
- Preview 브랜치 배포 HEAD: `684dce8`
- Vercel 고정 Preview 주소에서 새 asset으로 교체 확인
  - 이전 JS: `index-cqAXcg6T.js`
  - 새 JS: `index-9TQznD6h.js`
- 로그인된 Preview 홈: 정상 표시
- Preview 실행 console error/warn: 0
- 빈 계정 결과: 완료 기록 0, 중복 통계 카드 없이 기존 empty state 정상

## 통합 회귀검증

- `npm test`: 224/224 통과
- `npm run verify:ledger`: 18 issues, 18 routes, 0 unmapped
- `npm run build`: 통과
- PostgreSQL 17.6 `npm run test:db-home-state`: 통과
  - 0·25·100·250개 초기 응답/RLS/누적 통계
  - 250개를 10페이지 조회할 때 중복·누락 0
  - 익명 실행 차단
  - 적용 전 부재·충돌 차단·적용 후 exact 상태
  - 함수 MD5 `e43f9ab00acc164c18ca3c38cc8f059d`

Preview DB에는 실제 완료 라운드가 없어 실서비스 UI의 `더 보기` 클릭은 아직 표시되지 않습니다.
대량 페이지네이션은 동일 migration을 적용한 PostgreSQL 격리시험으로 검증했고, 실제 Preview
smoke는 빈 계정의 초기 RPC·홈 렌더링·무오류 상태까지 확인했습니다. Production 적용 전에는
이 증거 한계를 그대로 유지합니다.
