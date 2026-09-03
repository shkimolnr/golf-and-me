# TASK-051 Production migration 002 조건부 실행 결과

기준일: 2026-09-03

상태: migration 002 구조·권한 적용 성공, known remediation target 54건 격리,
backfill READ ONLY preflight `READY`, 실제 backfill 미적용.

## 실행 기준

- branch: `codex/db-integrity-20260903`
- HEAD: `2725f6d36997d83223691249c11a197085395270`
- Production migration 002 SHA-256:
  `65e27a53f2eade4da9e69f127b46c1f70e6a94bb9ad26e538bb01656427d80d6`
- post-check SHA-256:
  `b2a776cd725f829d1c84027ae8682b6c446e87d8446937ada322a83fb28a0dd1`
- 증거 기록 시각: `2026-09-03T01:00:05.546Z`

## migration 002

확정된 Golf&Me Production에서 승인된 002를 `begin`/`commit` 단일 transaction으로 실행했다.
SQL Editor 결과는 `Success. No rows returned`였다. migration 실패나 자동 rollback은 없었고,
승인되지 않은 SQL·즉흥 수정도 실행하지 않았다.

## 전체 post-check

- result SHA-256:
  `a1cea6a9e81b8d13fb83e73e14800117e191cb7644a6e656d1ee2b1549928b86`
- `gateStatus`: `BLOCKED`
- entity count: rounds `4`, round_holes `72`, round_shots `68`, tombstones `0`

객체와 권한 blocker는 모두 0이었다.

- index `0`, constraint `0`, sync function `0`, sync trigger `0`
- tombstone `0`
- forbidden child DML `0`, required privilege missing `0`
- index 3개 `present_valid`, FK 3개 `present_validated`
- sync 함수 hash `055b059c2c323c69234ba1ac2f526c95`, 보안·언어·search path 일치

data blocker만 `54`였다.

- `round_hole_field_mismatch`: `54`
- invalid holes container, tombstone overlap, hole/shot count mismatch,
  shot field mismatch, parent orphan, owner mismatch: 모두 `0`

이는 002가 향후 sync 정의와 무결성 객체는 고치지만 기존 child cache를 backfill하지 않는다는
사전 진단과 일치한다. 현재 post-check는 이 54건을 blocker로 포함하므로 `PASS`와 후속 backfill
preflight target `3/54` 기대 조건은 동시에 성립할 수 없다.

## 최초 중단과 gate 정정

승인 조건이 post-check `PASS`일 때만 backfill preflight를 재실행하도록 했으므로 여기서
fail-closed로 중단했다.

- backfill 적용 안 함
- 자동 rollback·즉흥 수정 안 함
- TASK-052/003, push/main 통합, 앱 배포 안 함

컨트롤타워는 이 조건이 논리적으로 양립하지 않는다고 정정했다. 객체·권한 blocker가 0이고 다른
integrity count 11종이 0이므로 002 구조·권한 적용은 PASS로 인정하고, 54건을 backfill이 해결할
known remediation target으로 분리했다. 이 정정 뒤 승인된 backfill preflight만 재실행했다.

## Production backfill READ ONLY preflight

- query SHA-256:
  `38d98c7ca8de87eebb5b016dcf41cb7dff313a0cc8afa427962298007044b9ee`
- result SHA-256:
  `a2d4b0d01b980e0417042cc73c0eaf5aa92c8967c7db3e52d62f50a09422bd6b`
- 기록 시각: `2026-09-03T01:02:30.977Z`
- `gateStatus`: `READY`
- blocker: prerequisite `0`, invalid payload `0`, integrity `0`
- exact index `3/3`, exact FK `3/3`, exact sync 함수 `1/1`
- authenticated child DML violation `0`
- 005 tombstone table exact, 함수 `2/2`, trigger `2/2`
- summary precedence object `0`
- target round/hole: `3/54`
- `official_hole_number` target round/hole: `3/54`
- `distance` target round/hole: `3/54`

SQL Editor가 첫 시도에서 직전 post-check 뒤에 preflight 내용을 이어 붙여 `42601` 구문 오류로
거부했다. 이 시도는 결과나 DB 변경을 만들지 않았다. 새 빈 query 탭에서 같은 승인 hash의
READ ONLY 파일만 입력해 재실행했고 위 결과를 얻었다.

004의 runtime 위험 권한 0은 앞선 승인된 READ ONLY 점검에서 확인됐으며 이후 이를 변경하는 SQL은
실행하지 않았다. 이번 preflight에서 005와 002의 backfill 관련 fingerprint는 모두 exact다.

각 결과 원문과 metadata는 Git 밖 전용 비공개 폴더에 mode 600으로 보관했다. UUID와 이메일 패턴은
0건이며 사용자 행·payload 원문·코스명·샷 값은 출력하거나 보관하지 않았다.

다음 단계는 target `3/54`에 대한 backfill 실제 적용 승인 gate다. 별도 승인 전 backfill, rollback,
TASK-052 또는 다른 외부 변경을 실행하지 않는다.
