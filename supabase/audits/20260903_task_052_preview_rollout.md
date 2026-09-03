# TASK-052 Preview migration 003 적용 결과

기준일: 2026-09-03

대상 환경: `Golf&Me Preview` (`bfwcxhdosuzitgcwcywe`)

적용 파일: `202609030002_round_summary_sync.sql`

SHA-256: `f2ec50283c62513869a38491c3eb2e17bdd1253305e1c908df67c143d98ce35e`

## 적용 전 READ ONLY gate

- `gateStatus`: `READY`
- blocker 10개 범주: 모두 0
- 기존 summary column 12개와 check constraint 7개: 정확한 정의
- migration 002 index·FK·함수·trigger·파생 테이블 권한: 정확한 정의
- 003 대상 함수·trigger: 부재 상태
- 잘못된 payload·위험한 smallint 변환: 0
- backfill 대상·summary cache mismatch: 0
- 활성 라운드: 0

## 적용

2026-09-03 11:19 KST에 사용자 승인 후 Supabase SQL Editor에서 migration 전체를 단일
transaction으로 실행했습니다. SQL Editor는 `Success. No rows returned`를 반환했습니다.

추가된 객체:

- `public.calculate_round_stats_from_payload(jsonb)`
- `public.sync_round_summary_from_payload()`
- `public.rounds_sync_summary` BEFORE INSERT/UPDATE OF payload trigger

기존 데이터 backfill 대상은 0건이므로 사용자 라운드 행 변경은 없었습니다.

## 적용 후 READ ONLY gate

- `gateStatus`: `READY`
- blocker 10개 범주: 모두 0
- `calculate_round_stats_from_payload(jsonb)` hash:
  `f605526003886eb6d5c6961e783ba48a`
- `sync_round_summary_from_payload()` hash:
  `f3ada2a5cc35ff1b1e55a2c4f8bea295`
- `rounds_sync_summary` trigger hash: `f3ad12dc7f57ec0506fd992887426b83`
- 두 함수와 trigger: `exact_existing`
- summary column·constraint·002 선행 객체: 모두 정확한 정의
- payload 검증 위반·summary cache mismatch·backfill 대상: 모두 0

## 판정

Preview 적용은 완료됐습니다. Production에는 migration 003을 적용하지 않았습니다. Production
적용 전에는 같은 파일의 READ ONLY preflight로 실제 4개 라운드의 영향량과 blocker를 다시
확인하고 별도 사용자 승인을 받아야 합니다.
