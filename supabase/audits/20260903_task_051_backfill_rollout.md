# TASK-051 backfill 조건부 rollout 결과

기준일: 2026-09-03

상태: Preview·Production 적용 및 사후검증 PASS. TASK-051 완료 판정 gate 대기.

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

## Production 적용 전 중단과 기대값 정정

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

Production 기대는 컨트롤타워와 사용자가 `target 3 rounds의 valid distance 54개 복구,
결측 0`으로 정정 승인했다.

## Production 적용·검증

승인 후 적용 직전 READ ONLY preflight를 다시 실행했다.

- gate: `READY`
- blocker: prerequisite `0`, invalid payload `0`, integrity `0`
- target: rounds/holes `3/54`
- official hole target: rounds/holes `3/54`
- distance target: rounds/holes `3/54`
- migration SHA-256:
  `edbdb1b5bfa4ac15cff6afad869062267d68332df4d8952bc71b4fde9a55f2ed`

최종 migration을 Production SQL Editor의 새 탭에서 단일 transaction으로 실행했고
`Success. No rows returned`를 확인했다. transaction 내부 full child postcondition이 실패하지
않았으므로 commit이 완료됐다.

사후 READ ONLY 검증 결과:

- entity count: rounds `4`, holes `72`, shots `68`, tombstones `0` — 적용 전과 동일
- rounds source fingerprint: `45e7ee645bba8ae3684104650a5ce003` — 적용 전과 동일
- round shots fingerprint: `4422266bfe127df3336793bc8e710fb9` — 적용 전과 동일
- round holes fingerprint: `2b04746e009cf08befb103e69a74607a` →
  `8fa5bd80f62421a383b019d8504348de` — 승인된 target child 재생성으로 변경
- full-distance payload/child: `54/54`, distance mismatch `0`
- 002 전체 post-check: `PASS`, blocker와 data integrity 모두 `0`
- backfill preflight 재실행: `READY`, blocker `0`, target round/hole `0/0`
- runtime 004 risky privilege count: `0`
- 002/005 function·trigger fingerprint: 적용 전후 동일

비식별 결과 SHA-256:

- 적용 전 state:
  `3524683ce7e73692e5f6751c648f87f65a7de0e333b48be6cf71af49ba0ad21f`
- 적용 후 state:
  `2280621a256875a369e5ad8336172e80332adedce634949817d00e8db9a9db5a`
- 002 post-check:
  `761a1e5dd62ab6c422b50e3ff21433d92bb5732572dd7fcc0419c4286c9723e8`
- backfill preflight after:
  `7c080cf76e15c0f0075e71e4d45fb1b4cf8c86325445909335f5ee21fcda7b32`

### 증거 범위 메모

기존 aggregate state 쿼리의 `rounds_source`는 `id + payload + updated_at`을 하나의 지문으로
묶으므로 payload와 updated_at이 함께 불변임을 확인한다. migration의 DELETE/INSERT 조건은
transaction에서 캡처한 target round 3개로 한정되며 shots 전체 지문도 동일하다.

다만 기존 state 쿼리는 target 밖 `round_holes`만의 별도 사전 지문을 반환하지 않았다. 따라서
이번 실행에서 대상 밖 hole 불변은 migration의 한정 조건·target count·전체 postcondition으로
검증했으며 별도 사전/사후 지문 직접 비교는 할 수 없다. 향후 데이터 변경 migration에서는
대상과 비대상 지문을 적용 전 query에 별도 필드로 포함한다.

사후 결과 요약 metadata와 result hash는 Git 밖 전용 비공개 폴더에 mode 600으로 보관했다.
검증 결과의 UUID·이메일 패턴은 0건이며 사용자 행·payload 원문·코스명·샷 값은 출력하거나
보관하지 않았다.

TASK-052/003, push/main 통합, 앱 배포는 시작하지 않고 컨트롤타워의 TASK-051 완료 판정에서
중단한다.
