# TASK-053 Production rollout

기준일: 2026-09-03

대상 환경: `Golf&Me Project` Production (`wllolepozqsrrhxpocwt`)

대상 migration: `202609030003_home_round_state.sql`

실행 당시 SHA-256: `f70264d8358fe4a5fca1a487354414ed79b4a7e4128acd980dec50ff03c3a832`

최종 canonical SHA-256: `1c19dd77d0f1a966f37832e00ef7402f014fcca96311063814d009d6b0a17425`

## 적용 결과

- 사용자 승인 후 전체 migration 원문 5,417자를 로컬 파일과 byte-for-byte 대조
- 단일 transaction 실행 성공: `Success. No rows returned`
- 기존 데이터 수: 전체 4, 작성 중 3, 완료 1, summary 누락 0
- 기존 라운드 행 rewrite·backfill 없음
- 대상 함수 1개, index 존재
- 함수 MD5: `e43f9ab00acc164c18ca3c38cc8f059d`
- 함수 속성: `SECURITY INVOKER`, `STABLE`

## 권한 교차검증과 보강

첫 사후검증에서 Production Supabase의 함수 ACL에 `service_role EXECUTE`가 명시적으로 추가된
것을 확인했습니다. Preview와 확정 정책은 authenticated-only이므로 같은 승인 범위에서 별도
transaction으로 이 권한을 회수했고 canonical migration에도 `service_role` 회수를 명시했습니다.

최종 권한:

- `authenticated=true`
- `public=false`
- `anon=false`
- `service_role=false`

## 판정

TASK-053 Production DB migration은 최종 보안 조건까지 `PASS`입니다. 기존 4개 라운드는 그대로
유지됐습니다. 앱 코드는 아직 Production에 배포하지 않았으며, 다음 단계는 검증된 TASK-053
client와 migration 기록을 main에 통합해 Production 앱을 배포하는 것입니다.
