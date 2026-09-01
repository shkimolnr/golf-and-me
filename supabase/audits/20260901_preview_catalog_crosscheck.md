# Golf&Me Preview catalog 교차판정 절차

기준일: 2026-09-01

범위: 기존 9개 migration의 로컬 baseline과 승인된 Preview의 schema-only catalog 결과 비교

금지: Production 접근, Preview 객체 변경, 사용자 행 조회, migration `002`·`003` 적용

## 함수 baseline 판정

기존 9개 migration을 빈 PostgreSQL에 순서대로 적용했을 때
`public.sync_round_children_from_payload()`의 기대값은 다음과 같습니다.

| 속성 | 기대값 |
|---|---|
| identity | `sync_round_children_from_payload()` |
| language | `plpgsql` |
| security | `SECURITY DEFINER` |
| volatility | `VOLATILE` |
| parallel | `UNSAFE` |
| leakproof | `false` |
| function setting | `search_path=public` |
| `md5(pg_get_functiondef(oid))` | `117d20b5e9c660b31d6a8fefcd8354da` |

같은 repository와 첫 9개 migration으로 다음 로컬 이미지를 각각 새로 생성해 검증했습니다.

| PostgreSQL image | `server_version_num` | 기대 hash |
|---|---:|---|
| `postgres:15.14` | `150014` | `117d20b5e9c660b31d6a8fefcd8354da` |
| `postgres:16.10` | `160010` | `117d20b5e9c660b31d6a8fefcd8354da` |
| `postgres:17.6` | `170006` | `117d20b5e9c660b31d6a8fefcd8354da` |
| `postgres:18.3` | `180003` | `117d20b5e9c660b31d6a8fefcd8354da` |

판정 순서:

1. 결과의 함수 identity가 정확히 하나이고 인자가 없는지 확인합니다. overload가 0개 또는 2개
   이상이면 hash 비교 전에 중단합니다.
2. Preview의 `server_version_num`을 함께 기록합니다. 위 15–18 범위에서는 같은 hash가 재현됐습니다.
   다른 major version이면 그 버전의 빈 로컬 DB에서 먼저 baseline을 재현합니다.
3. Preview hash가 기대 hash와 같으면 `pg_get_functiondef()`이 반환하는 정의가 로컬 baseline과
   일치합니다.
4. owner와 ACL은 `pg_get_functiondef()` hash에 포함되지 않으므로 별도 metadata가 기대 권한과
   일치해야 최종 통과입니다. hash만 같다고 권한까지 같다고 판정하지 않습니다.
5. hash가 다르면 `002`를 적용하지 않고 아래 복구 bundle을 먼저 확보합니다.

## hash 불일치 시 기존 함수 보전

`20260901_preview_function_recovery_capture.sql`은 system catalog에서 대상 함수 한 개만 읽습니다.
결과 JSON에는 다음 schema metadata만 포함됩니다.

- 서버 버전, 함수 identity와 owner
- SECURITY DEFINER, leakproof, volatility, parallel, function settings
- `pg_get_functiondef()` 결과와 그 MD5
- effective function ACL의 grantee·privilege·grantable

사용자 테이블, 이메일, UUID, 코스명, 라운드 payload, 홀·샷 값은 읽거나 반환하지 않습니다.

권장 보관 형식:

1. SQL Editor의 JSON 결과 한 건을 UTF-8 JSON 파일로 그대로 저장합니다.
2. 파일명은 `YYYYMMDDTHHMMSSZ_preview_sync_round_children_<definitionHash>.json` 형식을 사용합니다.
3. Git repository, 공유 클라우드, 채팅 첨부에 저장하지 않습니다. 사용자와 합의한 전용 비공개
   로컬 경로를 사용하고 파일 권한은 소유자만 읽고 쓸 수 있게 제한합니다.
4. 저장 직후 파일 SHA-256을 별도 sidecar에 기록하고, JSON 안의 `definitionSql` MD5가
   `definitionHash`와 일치하는지 확인합니다.
5. 복구가 필요할 때는 bundle의 `definitionSql`, owner, ACL을 새 rollback SQL로 구성해 별도
   검토합니다. bundle을 자동 실행하거나 대상 프로젝트를 추정하지 않습니다.

이 bundle은 schema 복구 근거입니다. 실제로 실행하기 전에는 프로젝트 확인과 컨트롤타워의
명시적 승인이 다시 필요합니다.

## 기존 9개 migration catalog 교차검사

### 준비

1. 컨트롤타워가 승인된 Preview에서
   `20260901_schema_only_catalog_snapshot.sql`을 실행합니다.
2. 단일 JSON 결과만 전용 비공개 로컬 파일로 저장합니다. 이 snapshot은 catalog metadata와
   definition hash만 포함하며 사용자 행을 포함하지 않습니다.
3. 비교할 PostgreSQL major version의 공식 로컬 image가 있는지 확인합니다.

### 로컬 비교

```sh
npm run test:db-catalog -- --image postgres:15.14 \
  --preview-snapshot /approved/private/path/preview-schema-only.json
```

스크립트는 매번 빈 로컬 PostgreSQL을 생성하고 다음 9개 파일만 적용합니다.

1. `202608300001_initial_golf_schema.sql`
2. `202608300002_club_bag_sync.sql`
3. `202608300003_delete_own_account.sql`
4. `202608300004_round_shot_club_snapshot.sql`
5. `202608300005_profile_default_distance_unit.sql`
6. `202608310001_round_holes_swing_count.sql`
7. `202608310002_app_diagnostics.sql`
8. `202608310003_round_summary_columns.sql`
9. `202609010001_authenticated_table_privileges.sql`

`002`·`003`은 baseline 생성 목록에 포함하지 않습니다.

### 판정 checklist

- 테이블: 7개 대상의 존재와 RLS enabled/forced
- 컬럼: 순서, 이름, PostgreSQL type, NOT NULL, identity/generated, default 식
- 제약: 이름, 종류, validation, deferrable, 정의
- 인덱스: 이름, primary/unique/valid/ready, 정의와 컬럼 순서
- RLS policy: 역할, command, USING, WITH CHECK
- 역할·권한: anon/authenticated/service_role 속성, public schema, table, sequence, function 권한
- 함수: identity, owner, language, 보안 속성, 설정, definition hash
- trigger: 대상 schema/table, enabled 상태, 함수 identity, definition hash
- event trigger: 이름, event, enabled 상태, tag, 함수 identity와 metadata hash
- extension: 설치된 이름

종료 코드는 다음과 같습니다.

- `0`: 모든 비교 category가 일치
- `2`: schema-only drift 발견. 출력된 `missing`, `unexpected`, `different` 항목을 검토
- `1`: baseline 재현, 입력 JSON 또는 Docker 실행 오류

### 환경 차이 해석

- `serverVersionNum`은 기록하지만 동일성 비교 category에는 포함하지 않습니다.
- Preview의 추가 extension과 `rls_auto_enable` 함수·event trigger는 이미 알려진 drift이므로
  `unexpected`가 예상됩니다. 자동 통과시키지 말고 각각 유지 근거와 권한을 판정합니다.
- role 속성, owner, effective privilege는 Supabase 플랫폼 기본값의 영향을 받을 수 있습니다.
  차이를 migration drift로 즉시 단정하지 말고 명시적 migration 권한과 플랫폼 관리 권한을 나눠
  검토합니다.
- 함수 hash 일치와 owner·ACL 일치는 별도 조건입니다.
- 어떤 drift도 이 스크립트가 자동 수정하지 않습니다.

## 적용 전 결론 형식

```text
Preview server_version_num:
Preview function hash:
기대 function hash: 117d20b5e9c660b31d6a8fefcd8354da
함수 정의 판정: 일치 / 불일치 / 판정 불가
owner·ACL 판정:
catalog difference count:
알려진 플랫폼 drift:
미해결 schema drift:
복구 bundle 확보 여부와 SHA-256:
002 적용 판정: 승인 요청 가능 / 보류
003 적용 판정: 002 검증 전 보류
```
