# TASK-049 다중 기기 라운드 삭제 동기화 감사·설계안

상태: **감사 및 설계만 완료**. migration·rollback·앱 변경은 작성하거나 적용하지 않았습니다.

적용 금지 범위: Golf&Me Preview, Production, 외부 설정, `main`.

## 1. 결론

현재 삭제는 서버의 `rounds` 행을 물리 삭제하고 삭제 의도는 해당 기기의 localStorage에만
일시 보관합니다. 다른 기기는 서버 응답에 ID가 없다는 사실을 삭제로 구분할 수 없으므로 로컬
사본을 유지하고, 그 ID가 원격 version map에 없다는 이유로 다시 upsert할 수 있습니다.

P0 권장안은 별도 `round_tombstones` 테이블입니다.

- 라운드 원본과 파생 홀·샷은 현재처럼 즉시 물리 삭제합니다.
- 삭제 ID, 소유자, 서버 삭제 시각만 tombstone으로 남깁니다.
- 모든 `rounds` DELETE는 DB trigger가 tombstone 생성과 같은 transaction에서 처리합니다.
- 모든 `rounds` INSERT/UPDATE는 tombstone ID를 DB trigger가 거부합니다.
- 같은 ID의 delete/upsert 경합은 transaction advisory lock으로 직렬화합니다.
- 클라이언트는 tombstone을 merge·화면·상세 조회·재업로드보다 항상 우선 적용합니다.
- tombstone은 계정이 존재하는 동안 유지하고 계정 삭제 시 함께 물리 삭제합니다.

`rounds.deleted_at` 한 컬럼만 추가하는 안은 권장하지 않습니다. 기존 non-null 원본·코스·요약
필드를 함께 보관하게 되어 “기록 삭제” 뒤에도 내용이 남고, 나중에 원본 행을 purge하면 삭제
억제 정보도 사라집니다. 별도 최소 tombstone은 내용 삭제와 재생성 차단을 분리합니다.

## 2. 현 구조 감사

### 현재 동작

| 단계 | 현재 구현 | 확인된 결과 |
|---|---|---|
| 기기 내 삭제 | `App.jsx::deleteRound()`가 rounds와 홀 draft를 localStorage/UI에서 제거 | 즉시 화면에서는 사라짐 |
| 오프라인 대기 | `pendingRoundDeletions.js`가 사용자별 삭제 ID 배열을 localStorage에 저장 | 같은 기기에서만 재시도 가능 |
| 서버 삭제 | `deleteRemoteRound()`가 `rounds`를 `user_id + id`로 직접 DELETE | FK cascade로 홀·샷도 삭제 |
| 삭제 완료 | DELETE가 성공하면 pending ID를 즉시 제거 | 서버에는 삭제 사실이 남지 않음 |
| 원격 조회 | `loadRemoteRounds()`가 존재하는 draft payload와 completed summary만 조회 | 삭제 ID 목록을 받지 못함 |
| 병합 | `mergeRoundCollections()`가 local을 먼저 넣고 더 최신 remote만 덮어씀 | 서버에 없는 local ID는 보존 |
| 저장 대상 | `selectRoundsNeedingRemoteSave()`가 remote version과 timestamp가 다른 local을 선택 | 삭제된 ID는 remote map에 없어 저장 대상으로 복귀 |
| 계정 삭제 | `delete_own_account()`가 auth user를 삭제하고 cascade, 로컬 사용자 key 전체 제거 | 개별 라운드 삭제와 다른 수명주기 |

현재 pending 목록은 “이 기기가 아직 서버에 보내지 못한 삭제 요청”만 보호합니다. 서버 삭제 성공
뒤 제거되며 다른 기기로 전파되지 않습니다. 또한 저장과 삭제는 같은 sync effect에서 병렬 실행돼
이미 시작된 stale upsert와 delete의 완료 순서도 DB에서 통제하지 않습니다.

### 결함 재현 순서

1. PC와 모바일이 라운드 `R`을 각각 localStorage에 보유합니다.
2. PC가 `R`을 서버에서 DELETE하고 PC pending ID를 비웁니다.
3. 모바일이 원격 조회를 수행하면 응답에는 `R`도 tombstone도 없습니다.
4. local-first merge는 모바일의 `R`을 유지합니다.
5. remote version map에는 `R`이 없으므로 저장 선택기가 `R`을 신규 저장 대상으로 고릅니다.
6. upsert가 `rounds`를 다시 만들며 서버 기록이 재생성됩니다.

이는 timestamp 비교만으로 해결할 수 없습니다. 삭제 자체의 서버 권위 version이 필요합니다.

## 3. 불변조건

구현과 자동 검증은 다음 조건을 동시에 만족해야 합니다.

1. 한 번 서버가 승인한 라운드 삭제 ID는 stale 기기의 INSERT/UPDATE로 복원되지 않습니다.
2. tombstone은 local round, remote round, active screen, draft, navigation보다 우선합니다.
3. 삭제 요청은 멱등이며 오프라인·새로고침·중복 요청 뒤에도 안전하게 재시도됩니다.
4. 다른 사용자의 round/tombstone 존재와 값은 조회·삭제·추측할 수 없습니다.
5. tombstone에는 payload, 코스명, 점수, 홀·샷, 자유 입력을 저장하지 않습니다.
6. 개별 라운드 삭제는 계정 삭제를 지연하거나 대체하지 않습니다.
7. `rounds.payload`는 활성 라운드의 원본이라는 기존 원칙을 유지합니다.

## 4. DB 설계안

### 4.1 예정 table

예정 migration 이름: `202609010005_round_deletion_tombstones.sql`

`public.round_tombstones`:

| column | 제안 정의 | 이유 |
|---|---|---|
| `round_id` | `text primary key` | `rounds.id`가 전역 PK이므로 삭제 ID도 전역 단일 표식 |
| `user_id` | `uuid not null references auth.users(id) on delete cascade` | 소유권 RLS와 계정 삭제 cascade |
| `deleted_at` | `timestamptz not null default clock_timestamp()` | 클라이언트 시계가 아닌 서버 권위 삭제 시각 |

추가 index는 `(user_id, deleted_at desc, round_id)` 하나만 제안합니다. 행에는 원본 내용이나
복원용 payload를 넣지 않습니다. `round_id`는 클라이언트가 정확히 제거할 ID이므로 hash로
대체하지 않습니다.

### 4.2 DELETE tombstone trigger

`rounds`의 모든 DELETE 경로가 우회되지 않도록 앱 RPC에만 의존하지 않고 BEFORE DELETE
trigger를 사용합니다.

예정 함수 `record_round_tombstone_before_delete()`:

1. `OLD.id`로 transaction advisory lock을 **try-lock**합니다.
   이미 stale INSERT가 같은 lock을 잡고 기존 row lock을 기다리는 경우에는 기다리지 않고 안정된
   retryable SQLSTATE로 DELETE transaction을 실패시킵니다.
2. `(OLD.id, OLD.user_id, clock_timestamp())`를 tombstone에 INSERT합니다.
3. 같은 ID·같은 소유자의 재시도는 기존 `deleted_at`을 유지하거나 더 늦은 서버 시각으로
   단조 증가시킵니다.
4. 같은 ID에 다른 소유자가 발견되면 migration 불변조건 위반으로 transaction을 실패시킵니다.
5. `OLD`를 반환해 원본 DELETE와 자식 FK cascade를 계속합니다.

함수는 `SECURITY DEFINER`, 고정 `search_path=pg_catalog, public`을 사용하고 owner 외 ACL을
revoke합니다. trigger가 호출하는 경우에만 실행되며 브라우저에 직접 EXECUTE를 열지 않습니다.

직접 DELETE를 유지하는 이유는 현재 앱과 이전 Preview client도 DB migration 직후부터 자동으로
tombstone을 만들게 하기 위함입니다.

### 4.3 stale write 차단 trigger

예정 함수 `reject_tombstoned_round_write()`를 `rounds`의 BEFORE INSERT OR UPDATE trigger로
설치합니다.

1. `NEW.id`와 같은 advisory lock을 얻습니다.
2. tombstone 존재 여부를 다시 읽습니다.
3. 존재하면 안정된 SQLSTATE와 비식별 오류 코드로 INSERT/UPDATE 전체를 거부합니다.

advisory lock이 필요한 이유는 DELETE transaction과 stale INSERT가 동시에 실행될 때 단순
`exists` 검사만으로는 아직 commit되지 않은 tombstone을 놓칠 수 있기 때문입니다. INSERT의
BEFORE trigger는 row uniqueness 확인보다 먼저 blocking lock을 얻을 수 있는 반면 DELETE의
BEFORE trigger는 이미 기존 row lock을 보유할 수 있습니다. 따라서 DELETE 쪽은 try-lock을 써야
서로 상대 lock을 기다리는 교착을 피할 수 있습니다. 최종 순서는 다음 중 하나로 고정됩니다.

- stale 저장이 lock을 먼저 획득: DELETE는 즉시 retryable 실패하고, 저장 완료 뒤 durable queue가
  DELETE를 재시도해 원본을 제거하고 tombstone을 남김
- DELETE 완료 후 stale 저장: 저장이 tombstone을 확인하고 실패

따라서 durable DELETE 재시도를 포함한 최종 서버 상태는 삭제입니다. lock hash 충돌은 DELETE의
일시적 retry 또는 서로 다른 라운드의 짧은 직렬화만 만들며 데이터 오염을 만들지 않습니다.

### 4.4 RLS·권한

- `round_tombstones` RLS enable + force 여부는 기존 public table 정책과 동일 기준으로 결정
- authenticated SELECT: `auth.uid() = user_id`
- authenticated INSERT/UPDATE/DELETE: 모두 부여하지 않음
- anon: 모든 CRUD 금지
- service_role: 현재 앱 사용 경로 없음. 직접 table 권한 불필요
- PUBLIC 및 runtime 역할의 TRUNCATE·REFERENCES·TRIGGER 명시적 revoke
- schema owner/migration executor만 함수·trigger 관리

기존 004 검증은 `rounds DELETE`를 필수 browser 권한으로 봅니다. 권장안은 DELETE 권한을
유지하면서 server trigger가 tombstone을 강제하므로 004의 기존 기대와 충돌하지 않습니다.
구현 시 004 계열 verification에는 새 table의 위험 권한 0을 추가해야 합니다.

## 5. 클라이언트 동기화 설계안

### 5.1 상태 분리

두 종류를 같은 배열로 취급하지 않습니다.

- `pending deletion`: 이 기기에서 발생했지만 서버 DELETE 성공을 확인하지 못한 요청
- `observed tombstone`: 서버에서 확인해 모든 local 상태보다 우선할 삭제 표식

pending 항목은 최소 `{ id, requestedAt }`, observed 항목은 `{ id, deletedAt }`로 사용자별
localStorage에 저장합니다. 기존 문자열 배열은 additive parser로 읽어 `{id}` 형태로 승격합니다.

### 5.2 원격 조회와 merge

`loadRemoteRounds()`는 활성 라운드와 함께 사용자의 `round_tombstones(round_id, deleted_at)`를
조회하는 sync snapshot 결과를 반환하도록 변경합니다. 결과 적용 순서는 고정합니다.

1. server tombstone과 local pending ID를 합칩니다.
2. 해당 ID를 local rounds와 remote rounds 양쪽에서 제거합니다.
3. 남은 active round만 timestamp로 병합합니다.
4. 삭제 ID의 activeRound, hole draft, navigation checkpoint를 제거하고 필요하면 홈으로 이동합니다.
5. 삭제 ID를 remote version map에서 “없음”으로 지우는 대신 deleted set에 기록합니다.

두 HTTP 조회 사이의 극단적 경합은 DB stale-write trigger가 최종 안전망이 됩니다. tombstone 거부
오류를 받으면 일반 저장 재시도만 반복하지 말고 tombstone을 다시 hydrate해야 합니다.

### 5.3 재업로드 차단

`selectRoundsNeedingRemoteSave()`에 server deleted ID와 pending deleted ID를 전달하고 가장 먼저
제외합니다. `saveRemoteRounds()` 직전에도 같은 ID 집합으로 한 번 더 filter해 오래된 React closure나
이미 예약된 timer가 삭제 ID를 전송하지 못하게 합니다. DB trigger는 이 두 client guard를 통과한
경합·구버전 client를 차단합니다.

상세 지연 조회 `loadRemoteRoundDetail()`이 null을 반환하면 tombstone을 재확인합니다. 삭제로
확인되면 일반 네트워크 오류가 아니라 local 제거 흐름으로 처리합니다.

### 5.4 오프라인 삭제 재시도

- 삭제 버튼은 즉시 UI/local round/draft/navigation을 제거하고 pending 요청을 durable 저장
- 온라인일 때 한 queue worker만 DELETE를 순차 또는 제한 병렬 처리
- 서버 DELETE 성공 뒤 tombstone 조회 또는 응답 확인 후에만 pending 제거
- 일반 실패와 DB lock 경합의 retryable SQLSTATE 모두 요청을 유지하고 현재 5초 재시도, online
  event, 앱 재시작, visibility/focus에서 재개
- 같은 ID 중복 요청은 하나로 합치며 성공한 ID를 다시 보내도 성공으로 취급
- save와 delete를 무제한 `Promise.all`로 경쟁시키지 않고 deleted set을 먼저 확정

재시도 횟수·backoff UI는 기존 “자동 재시도 제한” 원칙과 맞춰 앱 구현 단계에서 정합니다. DB
DELETE와 tombstone trigger 자체는 멱등이어야 합니다.

## 6. 보관·물리 삭제 정책

권장 기본 정책:

- `rounds` 원본: 삭제 transaction에서 즉시 물리 삭제
- `round_holes`, `round_shots`: FK cascade로 즉시 물리 삭제
- local 원본·draft·navigation: tombstone 관측 즉시 제거
- tombstone: 계정이 존재하는 동안 유지
- 계정 삭제: auth user cascade로 tombstone까지 즉시 물리 삭제
- 백업 사본: 별도 TASK-034의 접근 제한·보관기간·최종 소멸 정책 적용

고정 TTL로 tombstone을 purge하면 그 기간보다 오래 오프라인이던 기기가 다시 라운드를 올릴 수
있습니다. 계정 수명 보관은 이 결함을 다시 열지 않으면서 행당 ID·UUID·시각만 보관하는 안전안입니다.
법률·제품 정책상 TTL이 반드시 필요하면 최대 지원 오프라인 기간과 재인증 시 local reset 정책을
먼저 확정해야 합니다. pg_cron purge는 현재 설계에 포함하지 않으며 활성화하지 않습니다.

## 7. 계정 삭제와의 구분

개별 라운드 삭제는 인증 계정이 계속 동기화하므로 tombstone이 필요합니다. 계정 삭제는
`delete_own_account()`가 auth user를 제거해 이후 어떤 기기도 해당 사용자로 저장할 수 없으므로
라운드별 tombstone을 장기 보존할 이유가 없습니다.

통합시험으로 계정 삭제 시 다음을 확인해야 합니다.

- rounds·children·tombstones가 모두 0
- tombstone trigger가 auth cascade를 막지 않음
- 사용자 local pending/observed marker도 `clearLocalUserData()`로 제거
- 다른 사용자의 tombstone은 영향 없음

필요할 때만 account-delete transaction flag로 tombstone INSERT를 생략하는 후속안을 사용합니다.
우선은 실제 PostgreSQL cascade 순서를 격리시험으로 확인하고 선제적으로 함수를 복잡하게 만들지
않습니다.

## 8. 기존 migration과 선후관계

### 8.1 Preview 004 적용 상태와 근거

2026-09-01 현재 Golf&Me Preview에는 `004`가 적용되어 있습니다. 상태의 권위 있는 로컬 증적은
컨트롤타워 커밋 `2076120`(`Record Preview privilege hardening`)의 다음 두 문서입니다.

- `20260901_preview_migration_matrix.md`: 004 단독 적용 완료, 위험 권한 63→0,
  필수 CRUD/RPC 보존, 앱 스모크 정상
- `20260901_runtime_table_privilege_risk.md`: migration transaction 성공, 통합 권한 검증 성공,
  rollback 미실행, Production 미적용

이 기록은 안전 통합 브랜치의 최신 기준 `d49e783`에도 유지되어 있습니다. 이후 002 preflight가
Preview에서 `riskyRuntimePrivileges=0`을 반환한 것도 같은 상태를 뒷받침합니다.

DB 전담 커밋 `36d8668`의 “Preview/Production 실행·적용 없음”은 004 SQL과 테스트를 컨트롤타워에
처음 전달한 **그 시점의 상태**입니다. 이후 컨트롤타워가 `6137b65`로 통합 검증하고 Preview에
단독 적용한 다음 `2076120`으로 결과를 기록했습니다. 따라서 두 보고는 서로 다른 시점을 설명하며,
이 문서의 “현재 Preview 적용 완료”는 오기가 아닙니다.

공식 Supabase migration history는 여전히 0건이므로 “적용 완료”는 Dashboard SQL transaction과
적용 후 catalog/권한 검증 증적에 근거한 운영 상태입니다. migration history row가 있다는 뜻은
아닙니다.

### 8.2 충돌·의존성

| migration | 충돌·의존성 | 계획 |
|---|---|---|
| 002 derived integrity | AFTER INSERT/UPDATE에서 child cache 재생성 | tombstoned write가 BEFORE에서 실패하므로 child trigger 미실행. 함수 hash 자체는 영향 없음 |
| 003 summary sync | BEFORE INSERT/payload UPDATE에서 summary 재계산 | tombstone guard trigger 이름을 `rounds_00_*`로 두어 summary 계산보다 먼저 거부. 003 함수/trigger hash 영향 없음 |
| 004 least privilege | 현재 Preview 적용 완료, rounds DELETE 유지 | 새 table에 같은 위험 권한 revoke를 005에서 명시. 기존 004 재작성 금지 |

005의 hard dependency는 기본 `rounds`, auth user, RLS 구조이며 002/003/004의 객체 자체는
아닙니다. 004는 ACL hardening이므로 005 함수가 참조할 table/function을 만들지 않습니다. 따라서
P0 승인이 먼저라면 현재 Preview의 검증된 004 상태 위에 005만 적용할 수 있도록 설계합니다.

### 8.3 004 미적용 환경의 독립 구현·검증 순서

004가 적용되지 않은 새 로컬/일회성 환경에서도 005 자체의 기능과 권한을 독립 검증할 수 있어야
합니다. 이 경로는 현재 Preview 상태를 뜻하지 않으며, 004를 생략해도 안전하다는 운영 승인도
아닙니다.

1. 기존 9개 baseline만 적용하고 002/003/004는 적용하지 않습니다.
2. 005 preflight에서 target table·index·function·trigger가 absent/exact인지 확인합니다.
3. 005를 적용합니다. 005는 새 `round_tombstones`에 대해 PUBLIC·anon·authenticated·service_role의
   위험 권한과 직접 write를 자체적으로 revoke하고 authenticated owner SELECT만 명시적으로
   부여해야 합니다.
4. 새 table·함수·trigger의 RLS/ACL과 delete→tombstone→stale upsert 차단을 검증합니다.
5. 이 시나리오에서는 기존 7개 app table에 004 이전 위험 권한이 남아 있는 것이 예상됩니다.
   따라서 “전체 runtime 위험 권한 0”을 005 성공으로 오판하지 않고, `existing004Status=MISSING`과
   기존 위험 권한 집계를 별도 blocker로 보고합니다.
6. 같은 DB에 004를 뒤이어 적용하고 기존 7개 table 위험 권한이 0이 되는지 확인합니다. 004는
   `round_tombstones`를 열거하지 않으므로 새 table은 005가 닫은 ACL을 그대로 유지해야 합니다.
7. rollback/reapply 뒤에도 005 tombstone ACL과 004 기존 table ACL을 각각 분리 검증합니다.

외부 환경에서 004가 실제로 미적용이라면 권장 적용 순서는 **004 → 004 검증 → 005 preflight →
005 → 005 검증**입니다. P0 사유로 005를 먼저 적용해야 한다면 005가 새 객체를 자체 hardening한
상태에서도 기존 7개 table의 004 위험이 남는다는 점을 별도 승인받고, 004 후속 적용을 생략하지
않아야 합니다.

최종 로컬 시험 matrix는 다음 세 경로입니다.

1. 004 미적용 독립성: 기존 9개 baseline + 005, 이어서 004 적용
2. 현재 Preview 순서: 기존 9개 baseline + 004 + 005
3. 전체 재생 순서: 기존 baseline + 002 + 003 + 004 + 005

운영상 가장 단순한 최종 순서는 002 → 003 → 005지만, TASK-049를 위해 002/003 승인을 묶어서
요구하지 않습니다. 어떤 순서를 택하든 각 migration preflight와 별도 승인이 필요합니다.

## 9. migration 계획

구현 승인 뒤 한 개의 additive transaction으로 준비합니다.

1. 같은 이름 table/function/trigger의 부재 또는 exact 정의를 READ ONLY preflight로 확인
2. 기존 orphan·owner mismatch와 위험 runtime 권한이 0인지 재확인
3. `round_tombstones` table, index, FK, RLS 생성
4. RLS policy와 최소 SELECT 권한만 부여하고 모든 직접 write/DDL 권한 revoke
5. SECURITY DEFINER tombstone 기록 함수와 stale-write 거부 함수 생성, PUBLIC EXECUTE revoke
6. DELETE 기록 trigger와 INSERT/UPDATE guard trigger 생성
7. 기존 활성 rounds를 backfill하지 않음
8. transaction 내부에서 catalog·ACL 불변조건을 확인하고 하나라도 다르면 전체 실패

기존 원본 데이터 변환·삭제·backfill은 없습니다. 최초 데이터 변경은 사용자가 migration 적용 후
라운드를 실제 삭제할 때만 발생합니다.

## 10. rollback 계획

tombstone이 한 건이라도 만들어진 뒤 guard를 제거하면 stale 기기 재생성이 다시 가능하므로
Production에서 단순 down migration은 안전한 rollback이 아닙니다.

우선 rollback 원칙:

- 앱 문제: DB table·DELETE trigger·write guard는 유지하고 앱만 이전 버전으로 되돌림
- DB 함수 문제: tombstone 데이터를 유지한 forward-fix migration으로 함수/trigger 교체
- 깨끗한 일회성 Preview: tombstone 0건과 실행 중 write 0을 확인한 경우에만 trigger → function →
  policy → table 역순 제거 가능
- tombstone이 존재하는 Preview: 비공개 schema/data 보존 위치와 재생성 차단 대안을 승인받기 전
  drop 금지

rollback SQL에는 적용 전 tombstone count, active/tombstone ID overlap count, 다른 사용자 접근 차단,
현재 client version 확인을 중단 조건으로 넣습니다. 실제 사용자 tombstone ID는 보고서나 Git에
복사하지 않습니다.

## 11. 자동 검증 계획

### PostgreSQL 격리 통합시험

- migration 전 target 객체 absent/exact/collision preflight
- migration apply와 깨끗한 Preview rollback/reapply
- 본인 DELETE 한 번으로 round·children 0, tombstone 1
- 중복 DELETE는 성공하며 tombstone 1 유지
- 다른 사용자의 round DELETE 및 tombstone SELECT 차단
- anon 모든 접근 차단, authenticated tombstone 직접 write 차단
- stale INSERT와 UPDATE가 안정된 오류 코드로 차단
- 두 DB session의 DELETE↔upsert 양쪽 lock 순서에서 교착이 없고, 필요 시 DELETE가 retryable
  실패한 뒤 재시도해 최종 round 0/tombstone 1
- 250개 round 회귀시험에서 삭제하지 않은 저장 쿼리 수·조회 성능 변화 측정
- 계정 삭제 후 해당 사용자의 round·children·tombstone 모두 0
- current Preview 순서와 full 002/003/004 순서 모두 통과

### JavaScript 단위·통합시험

- tombstone ID가 local/remote 어느 쪽에 있어도 merge 결과에서 제외
- tombstone ID가 화면 목록, 누적 통계, 상세 조회 대상, save batch에 포함되지 않음
- pending과 observed marker의 구버전 localStorage 승격·중복 제거
- remote version보다 local timestamp가 최신이어도 tombstone 우선
- 삭제 직전 예약된 save closure에서도 최종 filter가 ID 차단
- 오프라인 삭제 → 재시작 → 온라인 복귀 → DELETE 성공 → pending 제거
- tombstone 거부 오류 시 일반 upsert 반복 대신 remote deletion rehydrate
- activeRound·hole draft·navigation checkpoint 정리

### PC ↔ 모바일 Preview 회귀시험

별도 적용 승인 후 Golf&Me Preview와 전용 테스트 계정에서만 수행합니다.

1. PC에서 라운드 생성 후 모바일에 동기화
2. 모바일을 오프라인으로 두고 PC에서 삭제
3. 모바일 재접속·focus 뒤 목록/통계/상세에서 삭제 반영
4. 모바일 local 사본이 서버에 재업로드되지 않음을 aggregate/catalog 검증으로 확인
5. 모바일 오프라인 삭제 후 PC에서 먼저 수정하는 반대 경합도 최종 삭제 확인
6. 두 기기에서 동시에 save/delete를 반복해 최종 round 0/tombstone 1 확인
7. 계정 삭제 흐름은 별도 계정으로 tombstone까지 제거되는지 확인

실제 사용자 기록 값, UUID, 코스명, 샷 값은 캡처·로그·보고서에 남기지 않습니다.

## 12. 승인 전에 필요한 결정

컨트롤타워와 사용자가 구현 전에 확정할 항목:

1. tombstone을 계정 수명 동안 보관하는 기본 정책 승인
2. P0 005를 002/003보다 먼저 Preview에 독립 적용할지, 002 → 003 뒤 적용할지
3. Preview PC↔모바일 시험에 사용할 전용 테스트 계정과 실행 시점
4. 계정 삭제 cascade 격리시험 결과에 따라 transaction flag가 필요한지 여부

이 문서는 migration 작성·Preview 실행·Production 적용 승인이 아닙니다.
