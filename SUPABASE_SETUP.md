# Supabase 데이터 연결

현재 앱은 **로컬 우선 저장 + Supabase 동기화** 구조입니다. 화면 입력은 브라우저 저장소에 먼저 반영되므로 네트워크나 DB 설정에 문제가 있어도 기록 흐름을 막지 않습니다.

> 2026-08-30: 운영 개발 프로젝트에 초기 마이그레이션을 적용했습니다. 6개 테이블 생성과 각 테이블의 RLS 활성화, PC·모바일 Google 로그인, 별도 신규 계정의 온보딩 동기화와 사용자 간 기록 격리를 확인했습니다.

> 2026-08-30 실제 기기 검증: 동일 Google 계정으로 PC와 iOS Safari에서 작성 중 3건·완료 6건이 동일하게 복원되는 것을 확인했습니다. 모바일의 로컬 범위 로그아웃은 PC 세션을 종료하지 않았고, 모바일 재로그인 후 서버 기록 9건이 다시 표시됐습니다. PC 화면은 다른 기기에서 생긴 변경을 확인하려면 현재 구현상 새로고침이 필요합니다.

> 2026-08-30 클럽 동기화 검증: 두 번째 마이그레이션을 운영 개발 프로젝트에 적용하고 추가 컬럼 7개를 확인했습니다. PC의 활성 클럽 13개와 비거리 2세트·26개 행이 서버에 보존됐으며, 새 탭 재접속에서 최신 `캐리 · M` 세트와 클럽별 값이 복원되는 것을 확인했습니다.

## 1. 환경 변수

`.env`에 다음 값을 설정합니다. 서비스 역할 키는 프런트엔드에 넣지 않습니다.

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-anon-key>
```

## 2. 마이그레이션 목록과 적용 원칙

로컬 저장소의 현재 마이그레이션은 아래 12개입니다. 새 환경에서는 번호 순서대로 검토·적용하되,
기존 Preview·Production에는 파일 존재만으로 재실행하지 않습니다. 두 환경은 과거 SQL Editor 수동
적용 이력이 있으므로, 카탈로그 감사와 명시적 승인을 거쳐 대상별로 적용합니다.

```text
supabase/migrations/202608300001_initial_golf_schema.sql
supabase/migrations/202608300002_club_bag_sync.sql
supabase/migrations/202608300003_delete_own_account.sql
supabase/migrations/202608300004_round_shot_club_snapshot.sql
supabase/migrations/202608300005_profile_default_distance_unit.sql
supabase/migrations/202608310001_round_holes_swing_count.sql
supabase/migrations/202608310002_app_diagnostics.sql
supabase/migrations/202608310003_round_summary_columns.sql
supabase/migrations/202609010001_authenticated_table_privileges.sql
supabase/migrations/202609010002_derived_data_integrity.sql
supabase/migrations/202609010003_round_summary_sync.sql
supabase/migrations/202609010004_runtime_table_least_privilege.sql
```

생성되는 주요 객체:

- `profiles`: 기본 티와 온보딩 완료 여부
- `rounds`: 현재 앱 라운드 원본 JSON과 검색용 핵심 필드
- `round_holes`, `round_shots`: 라운드 원본 저장 시 트리거로 자동 갱신되는 분석용 데이터
- `user_clubs`, `club_distance_history`: 후속 클럽·거리 관리 기반
- 후속 마이그레이션은 계정 삭제, 클럽 스냅샷, 기본 거리 단위, 스윙 수, 최소 오류 진단,
  홈 요약 컬럼과 runtime 권한을 단계적으로 보강합니다.
- `202609010002`와 `202609010003`은 파생 데이터 무결성과 서버 요약 재계산을 보강하는 적용 후보이며,
  Preview·Production 모두 아직 미적용입니다.
- `202609010004`는 Preview에만 적용해 runtime 역할의 `TRUNCATE`·`REFERENCES`·`TRIGGER`
  권한을 63개에서 0개로 줄였고, 필수 CRUD·진단 RPC와 앱 동작이 유지되는 것을 확인했습니다.
- 모든 테이블의 사용자별 RLS 정책

환경별 상세 판정과 적용 게이트는
`supabase/audits/20260901_preview_migration_matrix.md`를 기준으로 합니다. Preview는 공식 migration
history가 0건이므로 현재 객체 관측과 로컬 파일을 구분해 기록합니다.

## 3. 적용 확인

1. Google 로그인 후 온보딩을 완료합니다.
2. 라운드를 하나 만들고 홀을 저장합니다.
3. Supabase Table Editor의 `rounds`, `round_holes`, `round_shots`에 같은 사용자 기록이 생성되는지 확인합니다.
4. 같은 계정으로 다른 브라우저 또는 휴대폰에서 로그인해 같은 라운드가 보이는지 확인합니다.
5. 한 기기에서 홀을 수정한 뒤 다른 기기를 새로 열어 최신 수정본이 보이는지 확인합니다.
6. 한 기기에서 클럽 구성을 완료하고 비거리 세트를 저장한 뒤 다른 기기를 새로 열어 같은 구성과 최신 세트가 보이는지 확인합니다.
7. 두 번째 기기에서 일부 클럽의 비거리만 수정한 뒤 첫 번째 기기를 새로고침해 새 세트가 추가되고 이전 세트도 DB에 남아 있는지 확인합니다.

## 현재 범위

- 저장 완료된 라운드와 홀 기록은 서버에 동기화합니다.
- 클럽 구성과 시점별 전체 비거리 세트도 서버에 동기화합니다. 같은 세트 ID는 최신 저장본으로 합치고, 서로 다른 세트 ID는 양쪽 기록을 모두 보존합니다.
- 저장 중인 홀의 초안은 브라우저에 먼저 보관하고 `rounds.payload.draftHoles`에도 동기화합니다.
  복원할 때는 같은 홀의 기기·서버 초안 중 더 최근 값을 사용합니다.
- 서버 연결 실패 시 로컬 저장은 유지하며 화면에 동기화 지연 안내를 표시합니다.

## 롤백

롤백은 자동 실행하지 않습니다. 먼저 실패한 transaction의 실제 상태와 대상 환경을 읽기 전용으로
확인하고, 원본 payload·백업·복구 한계를 검토한 뒤 별도 승인을 받습니다. 롤백 파일은
`supabase/rollbacks/`에 있으며, 여러 migration을 되돌릴 때는 의존성의 역순을 따릅니다.

```text
supabase/rollbacks/202608310001_round_holes_swing_count_rollback.sql
supabase/rollbacks/202608310002_app_diagnostics_rollback.sql
supabase/rollbacks/202609010002_derived_data_integrity_rollback.sql
supabase/rollbacks/202609010003_round_summary_sync_rollback.sql
supabase/rollbacks/202609010004_runtime_table_least_privilege_rollback.sql
```

`202609010003` 롤백은 트리거·함수를 제거하지만 이미 재계산된 요약 캐시를 과거 값으로 복원하지
않습니다. `202609010002`·`003`을 모두 되돌릴 때는 `003 → 002` 순서로 검토합니다.
