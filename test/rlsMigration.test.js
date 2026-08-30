import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migrationPath = new URL('../supabase/migrations/202608300001_initial_golf_schema.sql', import.meta.url)
const sql = (await readFile(migrationPath, 'utf8')).replace(/\s+/g, ' ')

const ownerColumns = {
  profiles: 'id',
  rounds: 'user_id',
  round_holes: 'user_id',
  round_shots: 'user_id',
  user_clubs: 'user_id',
  club_distance_history: 'user_id',
}

test('모든 사용자 데이터 테이블에 RLS가 활성화된다', () => {
  for (const table of Object.keys(ownerColumns)) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
  }
})

test('모든 사용자 데이터 조회는 인증 사용자 소유 행으로 제한된다', () => {
  for (const [table, ownerColumn] of Object.entries(ownerColumns)) {
    assert.match(
      sql,
      new RegExp(`create policy "[^"]+_select_own" on public\\.${table} for select using \\(auth\\.uid\\(\\) = ${ownerColumn}\\)`, 'i'),
    )
  }
})

test('사용자가 쓰는 테이블은 삽입과 수정에도 소유자 검사를 적용한다', () => {
  for (const [table, ownerColumn] of Object.entries(ownerColumns)) {
    assert.match(
      sql,
      new RegExp(`create policy "[^"]+_insert_own" on public\\.${table} for insert with check \\(auth\\.uid\\(\\) = ${ownerColumn}\\)`, 'i'),
    )
    assert.match(
      sql,
      new RegExp(`create policy "[^"]+_update_own" on public\\.${table} for update using \\(auth\\.uid\\(\\) = ${ownerColumn}\\) with check \\(auth\\.uid\\(\\) = ${ownerColumn}\\)`, 'i'),
    )
  }
})

test('삭제 가능한 라운드·샷·클럽 데이터는 소유 행만 삭제한다', () => {
  for (const table of ['rounds', 'round_holes', 'round_shots', 'user_clubs', 'club_distance_history']) {
    assert.match(
      sql,
      new RegExp(`create policy "[^"]+_delete_own" on public\\.${table} for delete using \\(auth\\.uid\\(\\) = user_id\\)`, 'i'),
    )
  }
})
