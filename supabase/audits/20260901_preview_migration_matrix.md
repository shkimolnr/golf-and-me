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

## 기존 9개 migration 상태 매트릭스

| 순서 | 로컬 migration | Preview 관측 근거 | 판정 | 추가 확인 필요 |
|---:|---|---|---|---|
| 1 | `202608300001_initial_golf_schema.sql` | 사용자 데이터 6개 테이블, `handle_new_user`, `keep_newest_round_version`, `sync_round_children_from_payload`, `rounds_keep_newest`, `rounds_sync_children`, `pgcrypto` 존재 | **부분 적용 확인** | 전체 컬럼·FK·인덱스·RLS 정책과 함수 본문이 로컬 SQL과 같은지 미확인 |
| 2 | `202608300002_club_bag_sync.sql` | `user_clubs`, `club_distance_history` 테이블 존재만 확인 | **판정 보류** | `client_id`, `payload`, `set_id`, 거리 기준·정규화·snapshot 컬럼과 unique index 확인 필요 |
| 3 | `202608300003_delete_own_account.sql` | `delete_own_account` 함수 존재 | **부분 적용 확인** | `SECURITY DEFINER`, 빈 search path, authenticated EXECUTE와 public revoke 확인 필요 |
| 4 | `202608300004_round_shot_club_snapshot.sql` | `sync_round_children_from_payload` 함수와 rounds 자식 동기화 trigger 존재 | **판정 보류** | `round_shots.club_client_id`, `club_snapshot` 및 함수의 실제 추출 정의 확인 필요 |
| 5 | `202608300005_profile_default_distance_unit.sql` | 이번 감사에서 profiles 컬럼 상세 미조회 | **판정 보류** | `default_distance_unit` 컬럼·CHECK 확인 필요 |
| 6 | `202608310001_round_holes_swing_count.sql` | 이번 감사에서 round_holes 컬럼 상세 미조회 | **판정 보류** | `swing_count` 컬럼 확인 필요 |
| 7 | `202608310002_app_diagnostics.sql` | `app_diagnostics`, `record_app_diagnostic`, `purge_expired_app_diagnostics` 존재 | **부분 적용 확인** | 컬럼·CHECK·인덱스·RLS·table revoke·service_role 전용 EXECUTE 확인 필요 |
| 8 | `202608310003_round_summary_columns.sql` | `rounds`에 요약 컬럼과 `stats_summary` 존재 | **구조 적용 확인** | `rounds_user_status_played_idx`, 기존 payload 기반 backfill 결과의 정합성 확인 필요 |
| 9 | `202609010001_authenticated_table_privileges.sql` | 이번 감사에서 role별 effective privilege 미조회 | **판정 보류** | anon revoke, authenticated CRUD 범위, identity sequence 권한 확인 필요 |

## 신규 migration 상태

| 로컬 migration | Preview 상태 | Production 상태 |
|---|---|---|
| `202609010002_derived_data_integrity.sql` | **미적용** | 미적용 유지 |
| `202609010003_round_summary_sync.sql` | **미적용** | 미적용 유지 |

신규 migration은 로컬 PostgreSQL에서 전체 적용·rollback·재적용과 검증 쿼리를 통과했지만,
Preview의 기존 orphan·소유자 불일치와 요약 cache 불일치를 먼저 읽기 전용으로 확인하기 전에는
적용하지 않습니다.

## 확인된 schema drift와 운영 상태

- Preview에는 로컬 migration에 없는 `public.rls_auto_enable` 함수가 있습니다. 생성 주체와 용도,
  실행 권한을 확인하기 전에는 삭제하거나 로컬 schema에 편입하지 않습니다.
- `pg_cron`은 프로젝트에서 사용 가능하지만 설치되지 않았습니다. `TASK-047`의 우선 후보로만
  유지하며 scheduler를 생성하거나 활성화하지 않았습니다.
- 설치 extension은 `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`입니다.
  로컬 migration이 명시적으로 요구하는 것은 `pgcrypto`입니다.

## 다음 읽기 전용 대조 항목

1. 7개 public 테이블의 전체 컬럼, default, NOT NULL, CHECK, FK, index
2. 7개 테이블의 RLS 활성 여부와 policy 식
3. anon/authenticated/service_role의 effective table·sequence·function 권한
4. `sync_round_children_from_payload`, `delete_own_account`, diagnostics 함수의 보안 속성과 정의
5. Preview 데이터 내용을 출력하지 않는 소유자 불일치·orphan·요약 cache mismatch 건수
6. `rls_auto_enable`의 함수 정의, owner, EXECUTE 권한과 생성 목적

실제 migration history가 없으므로 위 대조가 끝나도 과거 실행 순서를 복원할 수는 없습니다.
현재 schema를 기준으로 baseline을 확정한 뒤, 실제 객체를 재생성하지 않는 방식으로 migration
history를 도입할지는 컨트롤타워가 별도로 결정해야 합니다.
