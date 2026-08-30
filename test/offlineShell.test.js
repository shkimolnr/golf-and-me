import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('프로덕션 앱은 오프라인 재진입용 서비스 워커를 등록한다', async () => {
  const entry = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8')
  assert.match(entry, /import\.meta\.env\.PROD/)
  assert.match(entry, /navigator\.serviceWorker\.register\('\/sw\.js'\)/)
})

test('서비스 워커는 앱 셸을 캐시하고 오프라인 탐색 시 루트 화면으로 복구한다', async () => {
  const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
  assert.match(worker, /cacheShell\(\)/)
  assert.match(worker, /request\.mode === 'navigate'/)
  assert.match(worker, /cache\.match\('\/'\)/)
  assert.match(worker, /url\.origin !== self\.location\.origin/)
})
