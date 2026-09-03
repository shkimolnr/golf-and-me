# TASK-051 backfill 조건부 rollout 결과

기준일: 2026-09-03

상태: Preview 적용·검증 PASS, Production 적용 전 source profile 불일치로 fail-closed 중단.

## 실행 기준

- branch: `codex/db-integrity-20260903`
- 적용 전 HEAD: `7d1cc32`
- migration SHA-256:
  `edbdb1b5bfa4ac15cff6afad869062267d68332df4d8952bc71b4fde9a55f2ed`
- backfill preflight SHA-256:
  `38d98c7ca8de87eebb5b016dcf41cb7dff313a0cc8afa427962298007044b9ee`
- aggregate state query SHA-256:
  `a6b9fa32c1a3711b87920d49186652ec0f44d00bf5dc1040c7b9634a14f82361`

## Preview

최종 migration을 단일 transaction으로 실행했고 `Success. No rows returned`를 확인했다.

- 적용 전/후 aggregate state result SHA-256:
  `4dc47f65627e5f63b9dc247170d9ac22a660cf1db472a306bd1050c445ab59ec`
- 적용 전/후 count: rounds `0`, holes `0`, shots `0`, tombstones `3`
- rounds source, holes, shots fingerprint: 전후 동일
- sync/tombstone function·trigger fingerprint: 전후 동일
- runtime 004 risky privilege count: 전후 `0`
- 002 전체 post-check: `PASS`, blocker와 data integrity 모두 `0`
- post-check result SHA-256:
  `3b60f9213117f387784791087ebbe9d5875fc364142dcd573efd85b1390d3450`
- 적용 후 backfill preflight: `READY`, blocker `0`, target round/hole `0/0`
- preflight result SHA-256:
  `7c080cf76e15c0f0075e71e4d45fb1b4cf8c86325445909335f5ee21fcda7b32`

Preview는 승인된 모든 조건을 통과했다. 활성 target이 없어 data change는 0이었다.

## Production 적용 전 중단

002 적용 후 승인된 backfill preflight 결과는 계속 `READY`, blocker `0`, target round/hole `3/54`,
official hole `3/54`, distance `3/54`였다. 그러나 Production migration 실행 직전 비식별 source
profile에서 승인된 사후 기대와 다른 사실을 확인했다.

- entity count: rounds `4`, holes `72`, shots `68`, tombstones `0`
- runtime 004 risky privilege count: `0`
- 002/005 function·trigger fingerprint: exact
- 18홀 중 valid distance `16`, missing `2`인 round: `0`
- 18홀 모두 valid distance인 round: `3`
- 해당 payload valid distance 합계: `54`
- 현재 child valid distance: `0`
- 현재 distance mismatch: `54`
- state result SHA-256:
  `3524683ce7e73692e5f6751c648f87f65a7de0e333b48be6cf71af49ba0ad21f`

따라서 기존 현장 증거의 `16`은 유효 거리 개수가 아니라 사용자 편집 개수였을 가능성이 높다.
실제 aggregate source에는 결측 2개가 없으며, 승인 조건의 `유효 16 복구·결측 2 NULL`과
`distance target 54`는 동시에 성립하지 않는다.

이 차이는 commit 뒤 검증 실패가 아니라 적용 전 발견했으므로 Production backfill을 실행하지 않고
중단했다. Production 002는 이전 단계에서 적용 완료 상태이며, backfill·rollback·즉흥 수정은
실행하지 않았다.

## 증거와 다음 gate

결과 원문과 metadata는 Git 밖 전용 비공개 폴더에 mode 600으로 보관했다. UUID·이메일 패턴은
0건이며 사용자 행·payload 원문·코스명·샷 값은 출력하거나 보관하지 않았다.

Production의 기대를 `target 3 rounds의 valid distance 54개 복구, 결측 0`으로 정정할지
컨트롤타워와 사용자가 재승인해야 한다. 별도 승인 전 Production backfill, TASK-052/003,
push/main 통합, 앱 배포를 진행하지 않는다.
