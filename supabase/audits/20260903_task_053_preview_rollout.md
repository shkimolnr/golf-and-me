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
