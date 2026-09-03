# TASK-051 파생 child cache backfill 설계

기준일: 2026-09-03

상태: 로컬 설계·구현·검증 전용. Preview·Production 적용 승인 아님.

## 발견 근거

Production의 002 적용 전 READ ONLY 검사에서 rounds 4건, round_holes 72건,
round_shots 68건의 부모·소유권·개수 정합성은 모두 0건 위반이었습니다. JSON number/string
정규화 뒤 shot field mismatch도 0건이 됐지만 다음 실제 불일치가 남았습니다.

- `official_hole_number`: 54건
- `distance`: 54건
- `score`, `putts`, `swing_count`: 0건
- 비숫자 payload: 0건

기존 함수 hash `117d20b5e9c660b31d6a8fefcd8354da`의 child insert가
`official_hole_number`와 `distance`를 누락한 것이 원인입니다. 002는 새 저장부터 이를 보정하지만
기존 child를 다시 만들지 않으므로 별도 backfill이 필요합니다.

현장 증거도 같은 원인을 확인합니다. 한 라운드의 payload에는 18홀 거리 원본과 사용자가 직접
변경한 거리 16건이 보존됐지만 round_holes.distance는 18건 모두 NULL이었습니다. 별도 비식별
집계에서도 payload 거리 36건에 대해 round_holes.distance 유효값은 0건이었습니다. payload
손실은 없으므로 단위 변환이나 추정 없이 저장된 숫자 의미를 그대로 파생 cache에 복구합니다.

## migration 번호 선택

검토한 대안:

1. 이미 Preview에 적용된 002 본문 수정: history checksum과 적용 증거가 달라져 **배제**
2. 002와 003 사이처럼 보이는 임의 suffix/비표준 번호: Supabase 정렬·도구 호환 위험으로 **배제**
3. 현재 마지막 005 뒤의 새 timestamp migration: 적용 이력이 불변이고 신규 설치도 정렬 가능해
   **채택**

선택 파일은 `202609030001_round_child_integrity_backfill.sql`입니다. 아직 어느 환경에도 적용되지
않은 TASK-052의 003 후보는 기존 파일명을 그대로 재사용하지 않고, TASK-052 착수 시
`202609030002_round_summary_sync.sql` 이후의 새 version으로 발행해야 합니다.

적용 순서:

- Preview: 기존 `001 → 004 → 005 → 002` → `202609030001 backfill`
- Production: 기존 `001 → 004 → 005` → `002` → `202609030001 backfill`
- 신규 환경: 파일 정렬대로 `001 → 002 → 004 → 005 → 202609030001 backfill`
  → 향후 `202609030002 summary sync`

## 동작과 gate

backfill은 `rounds`를 UPDATE하지 않습니다. 따라서 `rounds.payload`와 `rounds.updated_at`은
그대로 유지됩니다. 다음 조건을 transaction 안에서 먼저 확인합니다.

- 002 composite FK 3개와 unique index 3개가 적용됨
- 002 child sync 함수가 SECURITY DEFINER, PL/pgSQL,
  `search_path=pg_catalog, public`
- 005 tombstone table 존재
- holes/shots container와 숫자·smallint 입력이 명확하고 table CHECK 범위 안임
- hole/shot key가 중복되지 않음
- parent orphan·owner mismatch·child count mismatch·tombstone overlap이 모두 0
- payload와 child의 hole/shot key 집합이 정확히 일치

하나라도 위반되면 target child를 삭제하기 전에 transaction을 실패시킵니다. 통과하면
`rounds.payload`의 `official_hole_number` 또는 `distance` 기대값과 실제 child가 다른 round ID만 임시 target으로
고정하고, 그 round의 holes/shots만 002 함수와 같은 변환 규칙으로 다시 생성합니다.
child의 자체 payload 복사본은 target 판정의 권위 원본으로 사용하지 않습니다. key 집합이 다르면
자동 추정·보정하지 않고 blocker로 중단합니다.
target을 고정한 직후 해당 `rounds` 행을 ID 순서로 잠가 동시 저장과 child 재생성이 교차하지 않게
하고, commit 뒤에는 일반 저장 경로가 다시 그대로 동작합니다.

## 재실행과 rollback

첫 실행 후 target count는 0이어야 합니다. 두 번째 실행은 임시 target이 비어 child 변경도
0건입니다.

rollback은 data no-op입니다. payload와 일치하게 고친 파생 cache를 과거의 누락 상태로 되돌리는
것은 데이터 오염이므로 역변환하지 않습니다. 실패 시에는 migration transaction 자체가 원자적으로
rollback됩니다. commit 뒤 문제가 발견되면 자동 rollback하지 않고 payload에서 다시 재생성하는
별도 복구안을 승인받습니다.

## 예상 영향

- Preview: 현재 활성 rounds/holes/shots가 0건이므로 target 0건 예상
- Production: READ ONLY 진단 기준 54개 hole, 최대 3개 18홀 round가 target일 것으로 예상
- 원본 rounds: 변경 0건
- target 밖 round와 child: 변경 0건
- tombstone: 변경 0건

PG17.6 fixture는 현장형 18홀에서 거리값 16건만 복구하고 원본 결측 2건은 NULL로 유지합니다.
별도 36홀 비식별 집계 fixture는 유효 거리 36건을 모두 복구하며, 파생 테이블만 읽는 분석의
`count(distance)`가 합계 52건으로 회복되는지 확인합니다. 소수 거리도 문자열 값의 숫자 의미를
그대로 보존하고 단위나 값을 환산하지 않습니다.
또한 실행 전후 fingerprint로 002 sync 함수 정의, 004 runtime ACL, 005 rounds tombstone trigger
정의가 바뀌지 않는지 확인합니다.

실제 영향량은 각 환경에서 backfill preflight를 READ ONLY로 실행해 확정한 뒤 별도 적용 승인을
받아야 합니다.
