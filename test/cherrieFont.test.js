import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const url = path => new URL(`../${path}`, import.meta.url)
const read = path => readFileSync(url(path), 'utf8')

test('채리체 서체는 쓰는 글자만 남긴 가벼운 woff2다', () => {
  const size = statSync(url('src/assets/fonts/Griun_Cherrie-Rg.woff2')).size
  assert.ok(size < 150_000, `채리체 woff2가 너무 큽니다: ${size} bytes (scripts/subsetCherrieFont.py 재실행)`)
  assert.match(read('src/index.css'), /url\("\.\/assets\/fonts\/Griun_Cherrie-Rg\.woff2"\) format\("woff2"\)/)
})

test('앱 소스의 한글은 모두 채리체 글자 목록에 들어 있다', () => {
  const charset = new Set(read('src/assets/fonts/cherrie-charset.txt'))
  const files = ['src/App.jsx', 'src/data/news.js', ...readdirSync(url('src/lib')).filter(name => name.endsWith('.js')).map(name => `src/lib/${name}`)]
  const missing = new Set()
  for (const file of files) {
    for (const char of read(file).match(/[가-힣ㄱ-ㅎㅏ-ㅣ]/g) || []) {
      if (!charset.has(char)) missing.add(char)
    }
  }
  assert.deepEqual([...missing], [], `새 한글이 생겼어요. python3 scripts/subsetCherrieFont.py 를 다시 실행하세요: ${[...missing].join('')}`)
})

test('채리체 서체는 화면 그리기 전에 미리 내려받도록 힌트를 둔다', () => {
  assert.match(read('index.html'), /<link rel="preload" href="\/src\/assets\/fonts\/Griun_Cherrie-Rg\.woff2" as="font" type="font\/woff2" crossorigin \/>/)
})
