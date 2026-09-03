# Migration 002 Preview 적용 전 gate

대상: `202609010002_derived_data_integrity.sql`

상태: Preview 변경·002 적용 전용 준비 문서. Production 적용 근거로 사용하지 않음.

로컬 자동검증 기본 image: Preview와 같은 `postgres:17.6`

## 기대 baseline

- `202609010004_runtime_table_least_privilege.sql` 검증 완료
- `sync_round_children_from_payload()` definition hash:
  `117d20b5e9c660b31d6a8fefcd8354da`
- `rounds_sync_children` trigger: AFTER INSERT 또는 payload UPDATE, ROW 단위,
  `sync_round_children_from_payload()` 호출
- 아래 target index와 FK는 **없는 것이 현재 기대 상태**입니다. 이미 있다면 이름만 같아서는 안 되며
  전체 구조가 목표와 정확히 같아야 합니다.

### Target unique index

| 이름 | 테이블 | key 순서 |
|---|---|---|
| `rounds_id_user_uidx` | rounds | id, user_id |
| `round_holes_round_hole_user_uidx` | round_holes | round_id, hole_number, user_id |
| `user_clubs_id_user_uidx` | user_clubs | id, user_id |

모두 unique·valid·ready B-tree이며 expression, predicate, INCLUDE column이 없어야 합니다.

### Target FK

| 이름 | child key | parent key |
|---|---|---|
| `round_holes_round_user_fkey` | round_holes(round_id, user_id) | rounds(id, user_id) |
| `round_shots_round_hole_user_fkey` | round_shots(round_id, hole_number, user_id) | round_holes(round_id, hole_number, user_id) |
| `club_distance_history_club_user_fkey` | club_distance_history(club_id, user_id) | user_clubs(id, user_id) |

모두 `MATCH SIMPLE`, `ON DELETE CASCADE`, non-deferrable입니다. 같은 구조의 NOT VALID constraint가
이미 있으면 `002`의 validation 대상으로 허용합니다.

## 읽기 전용 판정 SQL

`202609010002_derived_data_integrity_preflight.sql`은 한 개의 JSON 결과만 반환합니다.
사용자 행 값은 반환하지 않고 catalog metadata 및 orphan·owner mismatch 집계만 포함합니다.

`gateStatus=READY` 조건:

- 필수 column의 type·nullability가 일치하거나, `swing_count`만 additive missing 상태
- target object 이름이 없거나 정확한 목표 구조
- 기존 함수 hash·SECURITY DEFINER·language·search_path와 실행자 소유 조건 일치
- rounds child sync trigger 구조 일치
- parent orphan과 owner mismatch 6개 집계가 모두 0
- 004가 차단한 runtime 위험 권한이 계속 0

다른 이름의 동등 index/FK는 blocker가 아니라 advisory입니다. 그대로 적용하면 중복 객체가 생길 수
있으므로 컨트롤타워가 기존 객체 유지·이름 정리·migration 수정 중 하나를 결정하기 전에는 적용하지
않습니다.

## 판정 규칙

- `absent_expected`: additive 생성 가능
- `exact_existing`: 이미 목표 상태
- `exact_pending_validation`: 002에서 validation 가능
- `absent_additive`: 002가 column을 추가할 수 있음
- `mismatch_blocker`, `*_blocker`: 같은 이름의 다른 객체 또는 필수 조건 불일치, 적용 금지
- advisory가 1개 이상이면 자동 READY로 해석하지 않고 중복 객체 결정을 요청

## 실행 순서 제안

1. 승인된 Preview 프로젝트인지 재확인합니다.
2. preflight SQL을 `READ ONLY`로 실행해 JSON과 SHA-256을 비공개 로컬 경로에 보관합니다.
3. `gateStatus=READY`, 모든 blocker 0, advisory 0을 확인합니다.
4. 기존 통합 감사의 orphan·owner·child cache mismatch 집계도 같은 시점에 다시 0인지 확인합니다.
5. 컨트롤타워가 catalog 결과와 migration DDL을 교차검토합니다.
6. 별도 명시적 승인 전에는 `002`를 실행하지 않습니다.

## 중단 기준

- target index relation 이름이 다른 table/index/object에 이미 사용됨
- 같은 이름 FK의 child/parent key, delete action, match, deferrable 속성 불일치
- 함수 hash 또는 owner/실행자 조건 불일치
- trigger 구조 불일치
- data violation 또는 004 위험 권한 재발
- 다른 이름의 동등 객체가 있어 중복 생성 판단이 필요함

이 gate는 002 적용 자체나 Production 적용 승인이 아닙니다.
