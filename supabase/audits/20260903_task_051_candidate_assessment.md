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

컨트롤타워가 승인된 `Golf&Me Preview`에서 위 SQL을 READ ONLY로 실행해 결과와 SHA-256을
비공개로 보관한 뒤, blocker/advisory 0과 target 6개 `absent_expected`를 확인해야 합니다.
그 결과에 대한 별도 사용자·컨트롤타워 승인 전에는 migration 002를 Preview에 적용하지 않습니다.
Production 적용, push, main 통합, 배포도 이 문서의 범위가 아닙니다.
