# Golf&Me Preview migration 적용 상태 감사

감사 기준일: 2026-09-01

대상: Production과 분리된 `Golf&Me Preview`

방법: Supabase Dashboard와 읽기 전용 카탈로그 조회
Production: 미접속·미변경

## 판정 기준

- **공식 이력**: Supabase Migrations 화면에는 `Run your first migration`이 표시되며
  `supabase_migrations.schema_migrations` 테이블도 없습니다. 공식 migration history는 **0건**입니다.
- 아래 상태는 migration 이력이 아니라 현재 객체와 컬럼의 존재를 로컬 SQL의 결과와 대조한
  **구조적 추정**입니다. SQL Editor에서 수동 적용된 객체는 원래 migration 파일과 완전히 같은
  정의인지 별도의 카탈로그 대조 없이는 확정할 수 없습니다.
- 신규 `202609010002`, `202609010003`은 Preview에 적용하지 않았습니다.
- `202609010004_runtime_table_least_privilege.sql`은 Preview에 단독 적용하고 권한·앱 스모크
  검증을 완료했습니다. Production에는 적용하지 않았습니다.
- `20260901_preview_readonly_catalog_audit.sql`은 컨트롤타워가 Preview에서 검토한 뒤 실행했으며,
  전체가 오류 없이 `READ ONLY` transaction으로 완료됐습니다. Production에는 실행하지 않았습니다.

## 기존 9개 migration 상태 매트릭스

| 순서 | 로컬 migration | Preview 관측 근거 | 판정 | 추가 확인 필요 |
|---:|---|---|---|---|
| 1 | `202608300001_initial_golf_schema.sql` | 사용자 데이터 6개 테이블, 핵심 함수·trigger, `pgcrypto` 존재. 컬럼·제약·인덱스·RLS·함수 hash 조회 완료 | **부분 적용 확인** | 조회 결과가 로컬 SQL의 정확한 정의와 같은지 교차판정 필요 |
| 2 | `202608300002_club_bag_sync.sql` | `user_clubs`, `club_distance_history`의 컬럼·제약·인덱스 조회 완료 | **판정 보류** | `client_id`, `payload`, `set_id`, 거리 기준·정규화·snapshot과 unique index의 정의 일치 판정 필요 |
| 3 | `202608300003_delete_own_account.sql` | `delete_own_account`의 owner·보안 속성·설정·definition hash·effective EXECUTE 조회 완료 | **부분 적용 확인** | 로컬 보안 기준과 hash 일치 판정 필요 |
| 4 | `202608300004_round_shot_club_snapshot.sql` | 관련 컬럼과 `sync_round_children_from_payload` 보안 속성·definition hash 조회 완료 | **판정 보류** | 컬럼 및 함수 추출 정의의 로컬 기준 일치 판정 필요 |
| 5 | `202608300005_profile_default_distance_unit.sql` | profiles 컬럼·CHECK 조회 완료 | **판정 보류** | `default_distance_unit` 정의 일치 판정 필요 |
| 6 | `202608310001_round_holes_swing_count.sql` | round_holes 컬럼 조회 완료 | **판정 보류** | `swing_count` 정의 일치 판정 필요 |
| 7 | `202608310002_app_diagnostics.sql` | 테이블 metadata·RLS·권한과 진단 함수 보안 속성·definition hash 조회 완료 | **부분 적용 확인** | CHECK·인덱스·revoke·service_role 전용 EXECUTE의 로컬 기준 일치 판정 필요 |
| 8 | `202608310003_round_summary_columns.sql` | `rounds`에 요약 컬럼과 `stats_summary`가 존재하고, 읽기 전용 재계산 결과 두 mismatch 집계가 모두 0 | **구조·현재 cache 정합성 확인** | `rounds_user_status_played_idx` 정의의 로컬 SQL 일치 여부는 카탈로그 결과 교차검토 필요 |
| 9 | `202609010001_authenticated_table_privileges.sql` | 필수 CRUD·sequence 권한은 유지됐으나 Supabase 기본 grant로 runtime 역할에 `TRUNCATE`·`REFERENCES`·`TRIGGER` 63개가 남아 있었음 | **부분 적용 확인 — 004로 보완** | 004 적용 뒤 위험 권한 0개 확인 |

## 신규 migration 상태

| 로컬 migration | Preview 상태 | Production 상태 |
|---|---|---|
| `202609010002_derived_data_integrity.sql` | **미적용 — 데이터 사전조건 통과, schema/rollback gate 확인 필요** | 미적용 유지 |
| `202609010003_round_summary_sync.sql` | **미적용 — 데이터 사전조건 통과, 002 검증 후 적용 후보** | 미적용 유지 |
| `202609010004_runtime_table_least_privilege.sql` | **적용 완료 — 위험 권한 63→0, 필수 CRUD/RPC 보존, 앱 스모크 정상** | 미적용 유지 |

002·003은 로컬 PostgreSQL에서 전체 적용·rollback·재적용과 검증 쿼리를 통과했지만,
Preview 적용은 이 문서의 사전확인과 명시적 승인을 모두 충족한 뒤 별도 작업으로 진행합니다.
004 적용 완료는 002·003의 적용 승인을 의미하지 않습니다.

## Preview 읽기 전용 데이터 감사 결과

컨트롤타워가 전체 감사 SQL을 실행한 뒤 결과 캡처를 위해 11·12번 집계 SELECT도 따로
재실행했습니다. 어떤 조회도 UUID, 이메일, 코스명, 샷 값 또는 payload 원문을 반환하지 않았습니다.

| 범주 | 확인 항목 | 결과 |
|---|---|---:|
| auth orphan | profiles, rounds, round_holes, round_shots, user_clubs, club_distance_history | 모두 0 |
| parent orphan | round_holes→rounds, round_shots→round_holes, club_distance_history→user_clubs | 모두 0 |
| owner mismatch | round_holes, round_shots, club_distance_history | 모두 0 |
| payload container | invalid holes container | 0 |
| child cache 개수 | round hole count, round shot count mismatch | 모두 0 |
| child cache 필드 | round hole field, round shot field mismatch | 모두 0 |
| round summary cache | `summary_column_mismatch_count` | 0 |
| round summary cache | `stats_summary_mismatch_count` | 0 |

판정:

- `002`의 동일 소유자 FK validation을 막는 현재 데이터 위반은 발견되지 않았습니다.
- `002`가 교체할 홀·샷 파생 cache는 현재 payload와 일치합니다.
- `003` 적용 전 payload 형식과 요약 cache 정합성 조건은 충족합니다. 현재 mismatch가 0이므로
  동일 계산식을 적용할 경우 backfill 대상은 0건이어야 합니다.
- 이 결과는 감사 실행 시점의 snapshot입니다. 실제 적용 직전 같은 집계를 다시 실행해야 합니다.

## 확인된 schema drift와 운영 상태

- Preview에는 로컬 migration에 없는 `public.rls_auto_enable` 함수가 있습니다. 생성 주체와 용도,
  실행 권한을 확인하기 전에는 삭제하거나 로컬 schema에 편입하지 않습니다.
- `pg_cron`은 프로젝트에서 사용 가능하지만 설치되지 않았습니다. `TASK-047`의 우선 후보로만
  유지하며 scheduler를 생성하거나 활성화하지 않았습니다.
- 설치 extension은 `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`입니다.
  로컬 migration이 명시적으로 요구하는 것은 `pgcrypto`입니다.

## 읽기 전용 대조 진행 상태

| 대조 항목 | 실행 상태 | 판정 상태 |
|---|---|---|
| 7개 public 테이블의 컬럼·default·NOT NULL·CHECK·FK·index | 조회 완료 | 카탈로그 결과와 로컬 SQL의 상세 교차검토 필요 |
| 7개 테이블의 RLS와 policy 식 | 조회 완료 | 로컬 SQL의 상세 교차검토 필요 |
| anon/authenticated/service_role의 table·sequence·function effective 권한 | 조회·로컬 교차검토 완료 | 위험 권한 63개는 004로 0개 처리, 필수 CRUD·RPC 보존 확인 |
| 대상 함수의 owner·보안 속성·설정·정의 hash | 조회·로컬 교차검토 완료 | `sync_round_children_from_payload()` baseline hash 일치 |
| orphan·owner·cache mismatch 집계 | 조회·재확인 완료 | **모두 0, 데이터 사전조건 통과** |
| `rls_auto_enable` owner·보안 속성·EXECUTE·정의 hash | 조회 완료 | 생성 목적과 유지 여부는 컨트롤타워 결정 필요 |

추가 판정:

- Preview와 같은 PostgreSQL 17.6 기준으로 전체 schema-only catalog를 비교했습니다.
- `sync_round_children_from_payload()` 정의 hash는 기대값
  `117d20b5e9c660b31d6a8fefcd8354da`와 일치했습니다.
- 004 적용 뒤 통합 집계는 `risky_violation_count=0`,
  `required_privilege_missing_count=0`, `anon_crud_violation_count=0`이며 진단 RPC 두 개의
  service-role EXECUTE가 모두 `true`였습니다.
- 플랫폼 고유 drift인 `rls_auto_enable`·`ensure_rls`와 추가 extension은 변경하지 않았습니다.

## 신규 002·003 Preview 적용 제안

### 적용 전 gate

아래 조건 중 하나라도 충족하지 않으면 적용하지 않습니다.

1. 대상이 Production과 분리된 `Golf&Me Preview`인지 프로젝트명과 ref를 다시 확인합니다.
2. 적용 직전에 감사 SQL의 11·12·13 집계를 다시 실행해 모든 값이 0인지 확인합니다.
3. `002`가 추가할 3개 unique index와 3개 FK가 없거나, 이미 있다면 이름뿐 아니라 컬럼 순서,
   참조 대상, `ON DELETE`, unique·validated 속성이 목표 정의와 같은지 확인합니다.
4. 현재 `sync_round_children_from_payload`의 definition hash가 예상 baseline과 같은지 확인합니다.
   다르면 기존 함수의 신뢰 가능한 복구 정의를 먼저 준비하고 컨트롤타워가 drift를 판정해야 합니다.
   현재 rollback 파일은 로컬 baseline을 복원하므로 Preview의 미확인 drift까지 복원하지는 못합니다.
5. `calculate_round_stats_from_payload`, `sync_round_summary_from_payload`,
   `rounds_sync_summary`가 아직 없는지 확인합니다. 예상과 다르면 `003`을 중단합니다.
6. 공식 migration history가 0건이라는 상태는 이 적용으로 자동 복구되지 않습니다. SQL Editor 수동
   적용 여부와 증적 기록 방식을 컨트롤타워가 먼저 확정합니다.
7. 적용 시간, 실행자, 적용 전후 hash·집계 결과, rollback 판단자를 기록하고 명시적 승인을 받습니다.

### 적용·검증 순서

두 migration을 한 번에 실행하지 않고 각각 독립된 transaction과 검증 단계로 나눕니다.

1. 적용 전 gate 결과를 저장합니다. 사용자 행 값은 저장하지 않고 객체 metadata·hash·집계만 남깁니다.
2. `202609010002_derived_data_integrity.sql`만 실행합니다.
3. `202609010002_derived_data_integrity_checks.sql`을 실행해 다음을 확인합니다.
   - 3개 동일 소유자 FK가 존재하고 `validated=true`
   - authenticated가 `round_holes`, `round_shots`에 SELECT만 보유
   - orphan·owner mismatch·child cache mismatch가 계속 모두 0
4. 컨트롤타워가 002 결과를 승인한 뒤에만 `202609010003_round_summary_sync.sql`을 실행합니다.
5. `202609010003_round_summary_sync_checks.sql`을 실행해 다음을 확인합니다.
   - summary mismatch가 0
   - `rounds_sync_summary`가 BEFORE INSERT와 BEFORE UPDATE에 활성화
   - 비식별 synthetic fixture의 PostgreSQL 함수 결과가 공유 기대값 및 JS 결과와 일치
6. 승인된 Preview 테스트 계정으로 라운드 한 건의 payload 저장 왕복을 검증할 필요가 있으면 별도
   승인된 테스트 데이터만 사용합니다. 실제 사용자 행을 결과나 증적에 복사하지 않습니다.
7. 모든 검증이 끝나기 전에는 Production 적용 요청을 만들지 않습니다.

### 중단·rollback 기준

- migration transaction 자체가 실패하면 먼저 transaction rollback 여부와 객체 상태를 읽기 전용으로
  확인합니다. 자동으로 rollback SQL을 연속 실행하지 않습니다.
- `002` 후 FK validation, 권한, 소유권·orphan·cache 검사 중 하나라도 기대와 다르면 `003`으로
  진행하지 않습니다. 원인을 확인한 뒤 승인된 경우에만
  `202609010002_derived_data_integrity_rollback.sql`을 사용합니다.
- `003` 후 trigger 또는 통계 fixture가 기대와 다르면 쓰기를 중지하고
  `202609010003_round_summary_sync_rollback.sql`을 먼저 검토합니다. 이 rollback은 trigger와 함수를
  제거하지만 이미 재계산된 요약 cache를 이전 값으로 되돌리지는 않습니다. payload는 보존되므로
  cache 복구안은 별도로 검증해야 합니다.
- 두 migration을 모두 되돌릴 때는 의존성의 역순인 `003 → 002` 순서를 사용합니다.
- rollback 후에도 전체 읽기 전용 감사를 다시 실행하고 모든 데이터 집계가 0인지 확인합니다.
- payload 원본 손실, 다른 사용자 데이터 접근 가능, 예상하지 않은 대량 backfill이 관측되면 즉시
  중단하고 자동 수정·삭제를 하지 않은 채 컨트롤타워에 보고합니다.

실제 migration history가 없으므로 위 대조가 끝나도 과거 실행 순서를 복원할 수는 없습니다.
현재 schema를 기준으로 baseline을 확정한 뒤, 실제 객체를 재생성하지 않는 방식으로 migration
history를 도입할지는 컨트롤타워가 별도로 결정해야 합니다.
