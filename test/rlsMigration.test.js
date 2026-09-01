import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migrationPath = new URL('../supabase/migrations/202608300001_initial_golf_schema.sql', import.meta.url)
const sql = (await readFile(migrationPath, 'utf8')).replace(/\s+/g, ' ')
const privilegeMigrationPath = new URL('../supabase/migrations/202609010001_authenticated_table_privileges.sql', import.meta.url)
const privilegeSql = (await readFile(privilegeMigrationPath, 'utf8')).replace(/\s+/g, ' ')

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

test('RLS 정책을 적용할 수 있도록 로그인 사용자에게 필요한 테이블 권한을 부여한다', () => {
  assert.match(privilegeSql, /grant select, insert, update on table public\.profiles to authenticated/i)
  for (const table of ['rounds', 'round_holes', 'round_shots', 'user_clubs', 'club_distance_history']) {
    assert.match(privilegeSql, new RegExp(`public\\.${table}`, 'i'))
  }
  assert.match(privilegeSql, /grant select, insert, update, delete on table .* to authenticated/i)
  assert.match(privilegeSql, /grant usage, select on sequence public\.club_distance_history_id_seq to authenticated/i)
})

test('익명 사용자에게 사용자 데이터 CRUD 권한을 열지 않는다', () => {
  assert.match(privilegeSql, /revoke select, insert, update, delete on table .* from anon/i)
  assert.doesNotMatch(privilegeSql, /grant [^;]+ to anon/i)
})
