import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(new URL('../supabase/migrations/202608300002_club_bag_sync.sql', import.meta.url), 'utf8')

test('클럽 동기화 마이그레이션은 로컬 ID와 비거리 세트 원본을 보존한다', () => {
  for (const field of ['client_id', 'payload', 'set_id', 'distance_basis', 'normalized_distance_m', 'club_snapshot', 'is_changed']) {
    assert.match(migration, new RegExp(`add column if not exists ${field}`, 'i'))
  }
  assert.match(migration, /unique index if not exists club_distance_user_set_club_uidx/i)
})

