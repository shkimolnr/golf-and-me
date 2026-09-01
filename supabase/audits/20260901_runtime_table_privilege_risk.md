# Runtime table privilege 위험 분석

기준일: 2026-09-01

대상: `anon`, `authenticated`, `service_role`이 7개 앱 테이블에 보유한
`TRUNCATE`, `TRIGGER`, `REFERENCES` effective privilege

상태: Preview/Production 미변경, migration 적용 보류

## 결론

세 권한은 브라우저 사용자와 현재 서버 runtime 모두에 불필요합니다. 새 additive migration은
7개 앱 테이블에서 세 권한만 `PUBLIC`, `anon`, `authenticated`, `service_role`로부터 회수합니다.
기존 SELECT·INSERT·UPDATE·DELETE, sequence, function EXECUTE는 변경하지 않습니다.

`service_role`도 세 권한을 유지할 필요가 없습니다. 현재 repository에서 service role key를 쓰는
유일한 경로는 `/api/diagnostics`가 `record_app_diagnostic` RPC를 호출하는 부분입니다. 이 RPC와
보관 삭제 함수는 `SECURITY DEFINER`이며 service role에는 함수 EXECUTE만 필요합니다. migration과
DDL은 service role JWT가 아니라 migration owner가 실행해야 합니다.

## 권한별 위험과 실제 접근 범위

| 권한 | 영향 | RLS 관계 | 현재 노출 가능성 | 판정 |
|---|---|---|---|---|
| `TRUNCATE` | 대상 테이블 전체 행을 즉시 제거 | RLS policy를 적용하지 않음 | 일반 PostgREST CRUD만으로 SQL 명령을 직접 보낼 수는 없지만, 잘못 노출된 invoker RPC·SQL 실행 경로와 결합하면 전체 데이터 손실 | **고위험, 즉시 회수 후보** |
| `TRIGGER` | 테이블에 trigger를 연결해 쓰기 동작과 부수효과를 바꿀 수 있음 | 행별 RLS의 보호 범위를 넘어 schema 동작을 변경 | TRIGGER 권한 외에도 실행 가능한 trigger function과 DDL 명령 경로가 필요함 | **불필요한 지속성·무결성 위험** |
| `REFERENCES` | FK가 이 테이블을 참조하도록 허용 | 행 접근 policy와 별개인 schema 권한 | referencing 객체를 만들거나 변경할 별도 DDL 권한이 필요함 | **단독 악용성은 낮지만 runtime에 불필요** |

현재 앱 코드에는 세 SQL 명령을 실행하는 RPC가 없습니다. 따라서 anon key나 로그인 토큰만으로
즉시 `TRUNCATE`를 호출할 수 있다고 단정하지 않습니다. 그러나 RLS가 방어하지 않는 고영향 권한을
runtime 역할에 남겨 둘 근거도 없으며, 향후 RPC·확장·설정 오류와 결합되는 잠재 경로를 제거해야
합니다.

## 역할별 목표

### anon

- 7개 앱 테이블의 CRUD와 세 위험 권한 모두 거부
- 공개 로그인 전 흐름은 Auth API를 사용하며 앱 테이블 권한이 필요하지 않음

### authenticated

- RLS 아래에서 앱 기능에 필요한 CRUD만 유지
- migration `002` 적용 뒤 `round_holes`, `round_shots`는 SELECT만 유지
- `TRUNCATE`, `TRIGGER`, `REFERENCES`는 모두 거부

### service_role

- 현재 기능에 필요한 진단 RPC EXECUTE 유지
- 기존 table CRUD는 이번 migration 범위에서 변경하지 않음. service role의 전체 CRUD 축소는
  별도의 서버 운영 영향 감사 후 결정
- `TRUNCATE`, `TRIGGER`, `REFERENCES`는 모두 거부

### migration owner

- FK·index·trigger 생성과 validation은 migration owner가 담당
- runtime role 권한 회수로 migration `002`·`003`의 DDL 실행 능력은 영향을 받지 않음

## Migration 특성

- 파일: `202609010004_runtime_table_least_privilege.sql`
- additive ACL hardening이며 table, column, row, payload를 변경하지 않음
- `PUBLIC` grant를 통한 간접 권한까지 닫음
- revoke 직후 3 roles × 7 tables × 3 privileges의 effective 권한을 검사
- 하나라도 남으면 같은 transaction을 실패시켜 부분 적용을 막음
- `002`·`003`의 객체에 의존하지 않아 독립적으로 검토할 수 있으나 실제 적용 순서는
  컨트롤타워가 migration history 전략과 함께 승인해야 함

## Rollback 제한

rollback은 감사에서 관측된 effective matrix를 복원하기 위해 세 역할에 세 위험 권한을 다시
grant합니다. 원래 권한이 direct grant, PUBLIC, role membership 중 어디에서 왔는지는 복원하지
않으며 PUBLIC은 계속 revoke 상태로 둡니다.

이 rollback은 RLS를 우회하는 `TRUNCATE`를 다시 열기 때문에 자동 실행하면 안 됩니다. migration
transaction이 실패하면 원래 ACL이 자동 보존되므로 rollback 파일을 이어서 실행하지 않습니다.
적용 후 기능 문제가 생겨도 먼저 CRUD·RPC 보존 검사를 확인하고, 세 권한 복원이 정말 필요한지
별도 승인해야 합니다.

## 적용 전후 확인

1. Preview 대상과 실행자를 재확인
2. 적용 전 direct ACL source와 63개 effective privilege matrix를 schema-only로 기록
3. migration 단독 transaction 실행
4. 위험 privilege `violation_count=0` 확인
5. authenticated 필수 CRUD와 service-role 진단 RPC EXECUTE 유지 확인
6. 승인된 Preview 테스트 흐름에서 로그인 사용자 CRUD와 진단 API 왕복 확인
7. orphan·owner·cache mismatch 집계가 계속 0인지 확인
8. Production 적용은 별도 승인 전 금지
