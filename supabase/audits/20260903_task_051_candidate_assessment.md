# TASK-051 후보 산출물 판정 및 로컬 gate

기준일: 2026-09-03

권위 기준: `origin/main` `26896d5`

작업 브랜치: `codex/db-integrity-20260903`

이 문서는 `codex/db-ga4-first-screen-20260903`을 작업 기반으로 사용하지 않고, 컨트롤타워가
지정한 개별 커밋을 권위 기준과 독립 비교한 결과입니다. Preview·Production DB에는 연결하거나
변경하지 않았습니다.

## 후보별 판정

| 후보 | 범위 | 판정 | 근거 |
|---|---|---|---|
| `46c6534` | migration 002·003 | **부분 채택** | 002의 additive index/FK, 함수 보정, child DML revoke와 rollback/check/test는 TASK-051 요구와 일치합니다. 003 파일은 TASK-052 선행 금지 원칙 때문에 분리해 유입하지 않았습니다. |
| `59f262f` | JS/SQL summary parity | **보류** | TASK-052 검증물이며 051 안정화 전 시작하지 않습니다. |
| `39296ec` | Preview 전체 catalog 감사 | **중복/미채택** | 과거 READ ONLY 감사에는 유효하지만 051의 좁은 preflight가 필요한 blocker를 직접 판정하므로 현재 브랜치에는 불필요합니다. |
| `79f9f50` | 과거 Preview 적용 매트릭스 | **폐기** | 2026-09-01 시점 기록으로 현재 Production `001·004·005` 적용 기준과 맞지 않습니다. 관리문서의 현재 상태 근거로 재사용하지 않습니다. |
| `7091ebc` | schema-only catalog drift | **보류** | 일반 drift 감사·함수 recovery 도구입니다. 현재 함수 baseline은 002 preflight가 hash와 보안 속성을 직접 검사하므로 TASK-051 필수 범위가 아닙니다. |
| `42276e7` | migration 002 preflight | **채택** | READ ONLY transaction, 행 값 비노출, 이름 충돌·함수 hash·trigger·owner/orphan·위험 권한 집계가 TASK-051 gate와 일치합니다. |
| `17a2fb0` | migration 003 preflight | **보류** | TASK-052 산출물이므로 051 완료 전 유입하지 않습니다. |
| `2826e3a` | 과거 Preview 003 BLOCKED 기록 | **폐기** | 002 미적용 당시의 예상 BLOCKED 결과로 현재 TASK-051 실행 증거가 아닙니다. |
| `c30f331` | migration 004 최소권한 | **재현 기준 채택** | 004는 이미 Preview·Production 적용 완료입니다. 누락된 migration/rollback/check와 로컬 privilege test를 복원했으며 새 적용 대상으로 취급하지 않습니다. |
| `bad7a64` | migration 001 runtime DML grant | **재현 기준 채택** | 001은 이미 Preview·Production 적용 완료입니다. 002의 rollback과 로컬 replay에 필요한 정확한 기준이므로 복원했습니다. |
| `382fe1e` | TASK-053 pagination/RPC/UI | **보류** | 051→052→053 순서를 위반하고 `src/App.jsx`가 GA4/UI 트랙과 충돌합니다. 053 착수 시 RPC/repository 경계를 먼저 재검토합니다. |

`46c6534`와 기존 DB 전담 `59ea121`, `bad7a64`와 `5ade34f`, `39296ec`와
`abf1584`, `79f9f50`와 `c4343ce`는 stable patch-id가 각각 일치했습니다. 나머지는
기준 브랜치의 파일 구성 차이 때문에 커밋 전체 patch-id만으로 채택하지 않고 대상 파일과 테스트를
독립 검토했습니다.

## TASK-051 로컬 검증 범위

`test:db-integrity-preflight`는 PostgreSQL 17.6에서 다음을 재현합니다.

- target index/FK 6개가 없는 baseline: `READY`
- 같은 이름의 잘못된 index/FK: `BLOCKED`
- 다른 이름의 동등 객체: advisory
- 정확한 기존 객체와 NOT VALID FK: 허용
- 함수 baseline hash, child sync trigger, owner/orphan 집계, 004 위험 권한: blocker gate 포함

`test:db-integrity`는 합성 데이터만 사용해 다음 두 적용 순서를 모두 실행합니다.

1. 신규 재생: `001 → 002 → 004 → 005`
2. 현재 Production 후속: `001 → 004 → 005 → 002`

두 순서에서 동일 소유자 composite FK 3개, authenticated child DML 차단, payload의
`sourceOfficialHole`·`distance`·`swingCount`와 shot snapshot 재생성, tombstone cascade
호환성을 검증합니다. 또한 002 rollback 후 재적용과 002 중복 재실행을 확인합니다.

## READ ONLY preflight 출력 기준

Preview에서 실행할 파일:

`supabase/verification/202609010002_derived_data_integrity_preflight.sql`

통과 조건:

- `gateStatus = READY`
- `blockerCounts` 7개 항목 모두 `0`
- `advisoryCounts.equivalentObjectsWithOtherNames = 0`
- 사용자 행 값, UUID, 코스명, 샷 값은 출력하지 않고 catalog metadata와 집계만 반환

로컬 Production-equivalent 순서(`001·004·005` 적용 뒤 002 미적용)에서는 위 조건이 모두
0으로 재현되었습니다. 이 로컬 결과는 실제 Preview 결과를 대신하지 않습니다.

### Preview 실행 결과

컨트롤타워 승인에 따라 2026-09-03T08:51:06+09:00에 `Golf&Me Preview`에서 이 SQL만
READ ONLY로 실행했습니다.

- 기준 commit: `5208a37df906b5d6b5773c41689fa1bedf6e06c0`
- query SHA-256: `d981a8b7498c2b616d07dad9f0bf73118e11c03754c40196442bc9b984e9215c`
- result SHA-256: `e1d7fd1deaef60f389646bc95b1b43356baa7d2ef0f0b9171c46c0f5b23f4382`
- `gateStatus`: `READY`
- blocker 7종: 모두 `0`
- advisory: `0`
- target unique index 3개와 composite FK 3개: 모두 `absent_expected`
- `sync_round_children_from_payload()`: `exact_baseline`, SECURITY DEFINER,
  `search_path=public`, definition hash `117d20b5e9c660b31d6a8fefcd8354da`
- `rounds_sync_children`: `exact_existing`, payload UPDATE 대상, enabled
- parent orphan·owner mismatch 6종: 모두 `0`

원문과 metadata는 Git 밖의 전용 비공개 임시 폴더에 각각 mode 600으로 보관했습니다. 원문에는
UUID 형식 값과 이메일이 없음을 확인했습니다. 이 실행에서 migration, DDL, DML, 권한 변경은
수행하지 않았습니다.

### Preview 002 적용 결과

사용자와 컨트롤타워의 별도 승인에 따라 2026-09-03T08:57:02+09:00부터
2026-09-03T08:59:20+09:00까지 같은 `Golf&Me Preview`에 002를 단일 transaction으로
적용하고 즉시 READ ONLY post-check를 실행했습니다.

- migration SHA-256: `65e27a53f2eade4da9e69f127b46c1f70e6a94bb9ad26e538bb01656427d80d6`
- post-check SHA-256: `f72dfd1c07e1dde9e00fd26697819a28d79b6aed20bb1c35650a9a1828bc8e74`
- 적용 전 결과 SHA-256: `4c90f6b5c156d2cb0f1cf7475cb991888fcdef99aa5f64f722b4d8eb18145da3`
- 적용 후 결과 SHA-256: `3b60f9213117f387784791087ebbe9d5875fc364142dcd573efd85b1390d3450`
- post-check: `PASS`, blocker 8종 모두 `0`
- unique index 3개: `present_valid`
- composite FK 3개: `present_validated`
- authenticated child INSERT/UPDATE/DELETE 6개: 모두 차단
- rounds CRUD와 child SELECT 필수 권한 누락: `0`
- child sync 함수: SECURITY DEFINER, PL/pgSQL,
  `search_path=pg_catalog, public`, definition hash `055b059c2c323c69234ba1ac2f526c95`
- 기존 child sync trigger: 일치·활성, definition hash
  `cd483d16a0b456f74a4c58ded518b5ad`
- tombstone table·SECURITY DEFINER 함수 2개·trigger 2개: 유지
- orphan·owner mismatch·payload/child count 및 field mismatch·tombstone overlap: 모두 `0`

적용 전후 집계는 rounds `0`, round_holes `0`, round_shots `0`, round_tombstones `3`으로
동일했습니다. 따라서 Preview 기존 행을 대상으로 한 재생성 표본은 없었습니다. 대신 같은 migration의
PostgreSQL 17.6 격리시험에서 합성 round를 사용해 official hole·distance·swing count·shot
snapshot 재생성, payload 보존, 005 cascade를 검증했습니다. migration 중복 재실행과
rollback/reapply도 로컬에서 통과했으며 Preview에는 재실행하거나 rollback하지 않았습니다.

적용 전후 원문과 metadata는 Git 밖 mode 600 파일로 보관했고 UUID 형식 값·이메일이 없음을
확인했습니다. Production, main, 배포, TASK-052는 변경하지 않았습니다.

## rollback 한계

- rollback은 002가 만든 composite FK 3개와 unique index 3개를 제거하고, child DML을
  authenticated에 다시 허용하며, 함수 정의를 사전 hash 기준의 `search_path=public` 상태로
  되돌립니다.
- target 객체가 002 전에 이미 정확한 이름으로 존재했다면 rollback도 그 객체를 제거합니다.
  따라서 실제 적용은 preflight에서 6개 객체가 모두 `absent_expected`였다는 결과를 보관한 경우로
  제한합니다.
- 003 적용 뒤에는 003을 먼저 rollback하지 않은 채 002만 되돌리지 않습니다.
- rollback은 원본 `rounds.payload`를 수정하거나 삭제하지 않지만, 파생 child 직접 쓰기 권한을
  다시 열기 때문에 긴급 복구가 아니면 실행하지 않습니다.

## 다음 승인 gate

컨트롤타워는 위 Preview 적용 결과와 post-check를 교차검토해야 합니다. Production 적용과
TASK-052 착수는 각각 별도 승인 전 진행하지 않습니다. push, main 통합, 배포도 이 문서의
범위가 아닙니다.
