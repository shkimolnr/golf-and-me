# Migration 003 Preview 적용 전 gate

대상: `202609010003_round_summary_sync.sql`

상태: Preview 변경·003 적용 전용 준비 문서. Production 적용 근거로 사용하지 않습니다.

로컬 자동검증 기본 image: Preview와 같은 `postgres:17.6`

## 기대 baseline

### 002 선행조건

- migration `002`의 unique index 3개가 exact·valid·ready B-tree 상태
- migration `002`의 동일 소유자 composite FK 3개가 exact·validated 상태
- `sync_round_children_from_payload()`가 SECURITY DEFINER, PL/pgSQL,
  `search_path=pg_catalog, public`이며 PostgreSQL 17.6 definition hash가
  `055b059c2c323c69234ba1ac2f526c95`
- `rounds_sync_children`가 AFTER INSERT 또는 payload UPDATE, ROW 단위로 위 함수를 호출
- authenticated의 `round_holes`, `round_shots` INSERT·UPDATE·DELETE가 모두 차단

하나라도 다르면 `003`보다 먼저 `002` 적용 상태와 rollback 여부를 확인해야 합니다.

### 기존 summary column

`rounds.payload`와 summary column 11개가 migration `202608310003`의 type, nullability,
default와 일치해야 합니다. 범위 check constraint 7개도 이름·검증 상태·조건을 확인합니다.

### 003 target object

| 객체 | 적용 전 기대 | PostgreSQL 17.6 exact hash/구조 |
|---|---|---|
| `calculate_round_stats_from_payload(jsonb)` | absent | `f605526003886eb6d5c6961e783ba48a`, SQL, IMMUTABLE, SECURITY INVOKER |
| `sync_round_summary_from_payload()` | absent | `f3ada2a5cc35ff1b1e55a2c4f8bea295`, PL/pgSQL, SECURITY INVOKER |
| `rounds_sync_summary` | absent | BEFORE INSERT 또는 payload UPDATE, ROW 단위, 위 sync 함수 호출 |

같은 signature의 함수나 같은 이름의 trigger가 이미 있으면 exact 목표 상태만 허용합니다.
다른 overload, 잘못된 return type·owner 교체 권한·language·volatility·search_path·정의 hash,
잘못된 trigger timing/event/function은 blocker입니다. 다른 이름으로 같은 sync 함수를 호출하는
trigger는 중복 실행 위험 advisory입니다.

## 읽기 전용 판정 SQL

`202609010003_round_summary_sync_preflight.sql`은 `BEGIN TRANSACTION READ ONLY` 안에서 한 개의
JSON만 반환합니다. catalog metadata와 집계 건수만 포함하며 UUID, 사용자·코스·홀·샷 값,
payload 원문, summary 원문을 반환하지 않습니다.

`gateStatus=READY` 조건:

- summary column과 check constraint가 exact
- 002 선행 index·FK·함수·trigger·자식 쓰기 차단이 exact
- 003 target 함수와 trigger가 absent 또는 exact
- payload의 `holes`가 배열이 아니거나 통계 숫자를 smallint로 안전하게 변환할 수 없는 행이 0

## cache mismatch 해석

- `summary_column_mismatch_count`: 10개 summary scalar column이 payload 계산값과 다른 행 수
- `stats_summary_mismatch_count`: `stats_summary`가 전체 계산 결과와 다른 행 수
- `rows_requiring_backfill_count`: 003 적용 시 summary cache 갱신 대상이 되는 합집합 행 수

이 값들은 사용자 행을 식별하지 않는 적용 영향 집계입니다. migration 003이 원본 payload를
보존하면서 고칠 예정이므로 gate blocker로 자동 변환하지 않습니다. 단, 0보다 크면 컨트롤타워가
예상 데이터 갱신 범위를 검토하고 Preview 적용 승인 여부를 별도로 결정해야 합니다.

## 판정 규칙

- `absent_expected`: additive 생성 가능
- `exact_existing`, `exact_002`: 목표 정의 또는 선행조건과 정확히 일치
- `*_blocker`: 누락, 같은 이름/identity 충돌 또는 정의 불일치로 적용 금지
- advisory가 1개 이상이면 자동 적용하지 않고 중복 trigger 또는 backfill 영향을 검토

## 실행 순서 제안

1. 승인된 Preview 프로젝트인지 재확인합니다.
2. preflight SQL을 `READ ONLY`로 실행해 JSON과 SHA-256을 Git 밖 비공개 로컬 경로에 보관합니다.
3. `gateStatus=READY`, 모든 blocker 0을 확인합니다.
4. target 객체가 현재 기대대로 모두 `absent_expected`인지 확인합니다.
5. advisory와 cache mismatch 집계를 컨트롤타워가 검토합니다.
6. 별도 명시적 승인 전에는 `003`을 실행하지 않습니다.

## 중단 기준

- 002 target index/FK가 없거나 exact·validated 상태가 아님
- 002 함수 hash, trigger 또는 authenticated 자식 쓰기 차단 불일치
- summary column/default/check constraint 불일치
- 003 target 함수 overload·signature·return type·보안 속성·hash·owner 충돌
- target trigger 이름 또는 동작 충돌, 다른 이름의 동등 trigger 존재
- invalid holes container 또는 unsafe smallint cast 집계가 1 이상

이 gate는 003 적용 자체나 Preview·Production 적용 승인이 아닙니다.

## 2026-09-01 Preview 실제 판정

컨트롤타워가 `Golf&Me Preview`에서 이 SQL을 READ ONLY로 실행한 결과는 `BLOCKED`였습니다.
이는 현재 002가 미적용이라 unique index 3개·composite FK 3개·변경된 sync 함수·authenticated
자식 테이블 DML 차단이 아직 없기 때문이며 예상된 결과입니다.

동시에 summary 컬럼·CHECK, payload 안전성, 기존 cache 정합성은 모두 통과했고 003 대상 함수·trigger
충돌도 없었습니다. 002 적용과 사후 검증이 별도 승인으로 완료되기 전에는 003 검토를 재개하지
않습니다.
