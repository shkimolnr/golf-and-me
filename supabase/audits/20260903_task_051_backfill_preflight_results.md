# TASK-051 backfill READ ONLY preflight 결과

기준일: 2026-09-03

상태: 적용 계획 승인 전 gate. 이 점검에서는 DDL·DML·권한 변경·rollback을 실행하지 않았다.

## 실행 기준

- branch: `codex/db-integrity-20260903`
- HEAD: `b170f87b092a2c60ed154e9f4f0d4618a0a50f50`
- query: `202609030001_round_child_integrity_backfill_preflight.sql`
- query SHA-256: `38d98c7ca8de87eebb5b016dcf41cb7dff313a0cc8afa427962298007044b9ee`
- Preview 실행: `2026-09-03T00:54:04.855Z`
- Production 실행: `2026-09-03T00:54:48.898Z`

결과 원문과 metadata는 Git 밖 전용 비공개 폴더에 mode 600으로 보관했다. 원문에서 UUID와
이메일 패턴은 각 환경 모두 0건이며, 사용자 행·payload 원문·코스명·샷 값은 출력하지 않았다.

## Preview

- result SHA-256: `7c080cf76e15c0f0075e71e4d45fb1b4cf8c86325445909335f5ee21fcda7b32`
- `gateStatus`: `READY`
- blocker: prerequisite `0`, invalid payload `0`, integrity `0`
- exact FK `3/3`, exact index `3/3`, exact 002 sync 함수 `1/1`
- authenticated child DML violation `0`
- 005 tombstone table exact, 함수 `2/2`, trigger `2/2`
- summary precedence object `0`
- target: round `0`, hole `0`, official hole `0`, distance `0`

Preview는 기대 조건을 모두 충족했다. 이 결과는 backfill 적용 승인이 아니며 migration은 실행하지
않았다.

## Production compatibility probe

- result SHA-256: `085f9c2b23560c77655372608e5992ee9756da6cbdc026debd77cacf38ab3fed`
- `gateStatus`: `BLOCKED` — 예상 상태이며 READY로 해석하거나 우회하지 않는다.
- blocker: prerequisite `1`, invalid payload `0`, integrity `0`
- summary precedence object `0`
- 005 tombstone table exact, 함수 `2/2`, trigger `2/2`
- target: round `3`, hole `54`
  - `official_hole_number`: round `3`, hole `54`
  - `distance`: round `3`, hole `54`

prerequisite 차단 상세는 002 미적용 상태와 정확히 일치한다.

- composite FK: exact `0/3`, 동일 이름 객체도 `0/3`
- unique index: exact `0/3`, 동일 이름 객체도 `0/3`
- sync 함수: 동일 identity `1`, 기존 baseline hash
  `117d20b5e9c660b31d6a8fefcd8354da`; 002 기대 hash
  `055b059c2c323c69234ba1ac2f526c95`와 불일치
- authenticated child INSERT/UPDATE/DELETE: `6`개 열림 — 002가 아직 revoke하지 않은 예상 상태

004의 runtime 위험 권한 0 상태는 앞선 Production READ ONLY 002 preflight에서 확인됐고 이후 외부
DDL/권한 변경을 수행하지 않았다. 이번 승인 SQL은 004 전체 ACL을 다시 출력하지 않으며, backfill에
직접 필요한 005 객체 fingerprint는 위와 같이 모두 exact다.

## 다음 gate

Production은 먼저 002 적용 및 post-check를 별도 승인받아야 한다. 그 뒤 이 backfill preflight를
다시 실행해 READY와 target `3/54`를 재확인한 후에만 backfill 적용 계획을 승인할 수 있다.
Production 002, backfill, rollback, TASK-052는 이번 단계에서 모두 미실행 상태다.
