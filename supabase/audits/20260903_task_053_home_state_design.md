# TASK-053 첫 화면 조회·누적 통계 설계

기준일: 2026-09-03

기준선: GitHub `main` `8832656`, TASK-051·TASK-052 Preview/Production 적용 완료

## 목표

로그인 직후 모든 완료 라운드의 `payload`를 받지 않습니다. 작성 중 라운드 원본은 복원과
오프라인 입력을 위해 모두 유지하고, 완료 기록은 최근 25건 요약만 먼저 받습니다. 홈 누적 통계는
서버가 요약 컬럼을 집계해 한 번에 반환하며 이전 기록은 사용자가 요청할 때만 25건씩 추가합니다.

## 확정한 구조

- 신규 additive migration: `202609030003_home_round_state.sql`
- 인증 사용자 전용 `get_home_round_state(integer, jsonb)` SECURITY INVOKER RPC
- 첫 응답: 최근 완료 요약 25건, 완료 전체 건수, 전체 누적 통계, compact version vector
- 추가 응답: `played_at_local DESC NULLS LAST, updated_at DESC, id ASC`의 안정적인 keyset cursor
- 상세 원본: 기존처럼 완료 라운드를 열 때 해당 `payload` 한 건만 조회
- 작성 중 원본·tombstone: 기존 별도 조회와 deletion-first 병합 유지
- 서버 함수가 없는 환경: 기존 전체 요약 조회로 안전하게 fallback
- 완료 저장·삭제 후: 서버 누적 통계만 다시 읽어 현재 값을 갱신
- 모든 완료 기록이 이미 기기에 있으면 오프라인 변경은 로컬 누적 통계에 즉시 반영

## 기존 후보를 그대로 사용하지 않은 이유

이전 후보 `382fe1e`의 migration 번호 `202609030001`은 TASK-051 backfill과 충돌합니다. 새 번호
`202609030003`으로 재발행했습니다. 또한 offset pagination은 페이지 조회 사이에 라운드가
추가·삭제되면 중복이나 누락이 생길 수 있어 keyset cursor로 교체했습니다. 함수 실행 권한은
`authenticated`에만 부여하고 `public`·`anon`·불필요한 `service_role` 실행은 열지 않습니다.

## 로컬 검증

- PostgreSQL 17.6·18.3에서 전체 migration 순차 적용 성공
- 함수 정의 hash: `e43f9ab00acc164c18ca3c38cc8f059d`
- 0·25·100·250개 계정별 첫 응답, 전체 건수와 누적 통계 일치
- 250개를 25건씩 10페이지 조회: 중복 0, 누락 0
- 다른 사용자 데이터 노출 0, anon 실행 거부
- 250개 첫 응답 약 45.5KB, 동일 fixture 전체 payload 약 129.8KB
- target 함수·index 부재는 READY, 같은 이름의 오정의 객체는 BLOCKED, 정확한 적용 후 READY
- 기존 자동 테스트와 Production build 통과

## 적용 순서

1. Preview에서 기존 TASK-052 gate 재확인
2. TASK-053 READ ONLY preflight가 `READY`, blocker 0인지 확인
3. 별도 사용자 승인 후 Preview DB migration 적용
4. 적용 후 exact hash·권한·RLS·페이지 결과 확인
5. DB 적용 뒤에만 client를 Preview 배포
6. 0·다건 계정, 더 보기, 상세 열기, 오프라인 복원, 다중 기기 삭제 회귀 검증
7. Production은 Preview 검증 뒤 별도 승인

현재 단계에서는 Preview·Production DB와 외부 설정을 변경하지 않았습니다.
