import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { clearLocalUserData, deleteRemoteAccount } from '../src/lib/accountDeletion.js'

function storageMock(initial) {
  const values = new Map(Object.entries(initial))
  return {
    get length() { return values.size },
    key(index) { return [...values.keys()][index] ?? null },
    removeItem(key) { values.delete(key) },
    keys() { return [...values.keys()] },
  }
}

test('계정 삭제 뒤 현재 사용자의 Golf & Me 로컬 데이터만 제거한다', () => {
  const storage = storageMock({
    'golf-and-me:rounds:user-a': '[]',
    'golf-and-me:hole-draft:user-a:round-1:1': '{}',
    'golf-and-me:rounds:user-b': '[]',
    'unrelated:key': 'keep',
  })
  const removed = clearLocalUserData(storage, 'user-a')
  assert.deepEqual(removed.sort(), [
    'golf-and-me:hole-draft:user-a:round-1:1',
    'golf-and-me:rounds:user-a',
  ])
  assert.deepEqual(storage.keys().sort(), ['golf-and-me:rounds:user-b', 'unrelated:key'])
})

test('원격 계정 삭제는 제한된 RPC 한 개만 호출한다', async () => {
  const calls = []
  const client = { rpc: async name => { calls.push(name); return { error: null } } }
  assert.deepEqual(await deleteRemoteAccount(client), { error: null })
  assert.deepEqual(calls, ['delete_own_account'])
})

test('계정 삭제 함수는 인증 사용자 본인만 삭제하고 공개 실행을 차단한다', async () => {
  const migration = await readFile(new URL('../supabase/migrations/202608300003_delete_own_account.sql', import.meta.url), 'utf8')
  assert.match(migration, /security definer\s+set search_path = ''/)
  assert.match(migration, /requesting_user_id uuid := auth\.uid\(\)/)
  assert.match(migration, /delete from auth\.users where id = requesting_user_id/)
  assert.match(migration, /revoke all on function public\.delete_own_account\(\) from public/)
  assert.match(migration, /grant execute on function public\.delete_own_account\(\) to authenticated/)
})
