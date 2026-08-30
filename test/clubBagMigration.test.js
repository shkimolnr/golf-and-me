import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(new URL('../supabase/migrations/202608300002_club_bag_sync.sql', import.meta.url), 'utf8')
const shotClubMigration = readFileSync(new URL('../supabase/migrations/202608300004_round_shot_club_snapshot.sql', import.meta.url), 'utf8')
const profileUnitMigration = readFileSync(new URL('../supabase/migrations/202608300005_profile_default_distance_unit.sql', import.meta.url), 'utf8')

test('클럽 동기화 마이그레이션은 로컬 ID와 비거리 세트 원본을 보존한다', () => {
  for (const field of ['client_id', 'payload', 'set_id', 'distance_basis', 'normalized_distance_m', 'club_snapshot', 'is_changed']) {
    assert.match(migration, new RegExp(`add column if not exists ${field}`, 'i'))
  }
  assert.match(migration, /unique index if not exists club_distance_user_set_club_uidx/i)
})

test('라운드 샷 정규화는 클럽 ID와 당시 표시명 스냅샷을 보존한다', () => {
  assert.match(shotClubMigration, /club_client_id text/i)
  assert.match(shotClubMigration, /club_snapshot jsonb/i)
  assert.match(shotClubMigration, /shot\.value->>'clubId'/)
  assert.match(shotClubMigration, /shot\.value->'clubSnapshot'/)
})

test('온보딩 기본 거리 단위는 계정 프로필에 M 또는 YD로 저장한다', () => {
  assert.match(profileUnitMigration, /default_distance_unit text not null default 'M'/i)
  assert.match(profileUnitMigration, /default_distance_unit in \('M', 'YD'\)/i)
})
