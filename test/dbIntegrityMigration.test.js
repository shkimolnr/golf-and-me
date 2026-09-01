import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile(
  new URL('../supabase/migrations/202609010002_derived_data_integrity.sql', import.meta.url),
  'utf8',
)
const rollback = await readFile(
  new URL('../supabase/rollbacks/202609010002_derived_data_integrity_rollback.sql', import.meta.url),
  'utf8',
)
const verification = await readFile(
  new URL('../supabase/verification/202609010002_derived_data_integrity_checks.sql', import.meta.url),
  'utf8',
)

test('파생 데이터와 원본 부모는 동일 사용자 FK로 연결된다', () => {
  for (const constraint of [
    'round_holes_round_user_fkey',
    'round_shots_round_hole_user_fkey',
    'club_distance_history_club_user_fkey',
  ]) {
    assert.match(migration, new RegExp(`add constraint ${constraint}`, 'i'))
    assert.match(migration, new RegExp(`validate constraint ${constraint}`, 'i'))
    assert.match(rollback, new RegExp(`drop constraint if exists ${constraint}`, 'i'))
  }
  assert.match(migration, /foreign key \(round_id, user_id\)[\s\S]+references public\.rounds \(id, user_id\)/i)
  assert.match(migration, /foreign key \(round_id, hole_number, user_id\)[\s\S]+references public\.round_holes \(round_id, hole_number, user_id\)/i)
  assert.match(migration, /foreign key \(club_id, user_id\)[\s\S]+references public\.user_clubs \(id, user_id\)/i)
})

test('라운드 payload 재생성은 기존 홀 정보와 스윙 수를 모두 보존한다', () => {
  assert.match(migration, /security definer\s+set search_path = pg_catalog, public/i)
  for (const column of ['official_hole_number', 'distance', 'swing_count']) {
    assert.match(migration, new RegExp(column, 'i'))
  }
  assert.match(migration, /hole\.value->>'sourceOfficialHole'/)
  assert.match(migration, /hole\.value->>'distance'/)
  assert.match(migration, /hole\.value->>'swingCount'/)
  assert.match(migration, /shot\.value->>'clubId'/)
  assert.match(migration, /shot\.value->'clubSnapshot'/)
})

test('인증 사용자는 트리거가 관리하는 파생 테이블을 직접 변경할 수 없다', () => {
  assert.match(
    migration.replace(/\s+/g, ' '),
    /revoke insert, update, delete on table public\.round_holes, public\.round_shots from authenticated/i,
  )
  assert.match(
    rollback.replace(/\s+/g, ' '),
    /grant insert, update, delete on table public\.round_holes, public\.round_shots to authenticated/i,
  )
})

test('적용 전후 검증 쿼리는 소유권 위반·constraint·최종 권한을 확인한다', () => {
  for (const check of [
    'round_holes_owner_mismatch',
    'round_shots_owner_mismatch',
    'club_distance_owner_mismatch',
  ]) assert.match(verification, new RegExp(check))
  assert.match(verification, /pg_catalog\.pg_constraint/)
  assert.match(verification, /information_schema\.role_table_grants/)
})

test('무결성 migration은 원본 사용자 데이터를 삭제하거나 컬럼을 제거하지 않는다', () => {
  assert.doesNotMatch(migration, /delete from public\.(rounds|profiles|user_clubs|club_distance_history)/i)
  assert.doesNotMatch(migration, /drop (table|column)/i)
})
