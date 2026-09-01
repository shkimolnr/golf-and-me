import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

function run(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit' })
}

function output(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim()
}

const allowedUntrackedPrefixes = [
  '.tmp-ppt-review/',
  '.tmp-yardage-review/',
  'outputs/',
]

run('npm', ['test'])
run('npm', ['run', 'build'])
run('git', ['diff', '--check'])

if (!existsSync('dist/index.html')) {
  throw new Error('빌드 결과 dist/index.html이 없습니다.')
}

const trackedFiles = output('git', ['ls-files']).split('\n').filter(Boolean)
const forbiddenTrackedFiles = trackedFiles.filter((file) =>
  /(^|\/)(\.env$|\.env\.(?!example$)|\.vercel\/|service-account.*\.json$)/i.test(file),
)

if (forbiddenTrackedFiles.length > 0) {
  throw new Error(`비밀 설정 후보 파일이 Git에 추적되고 있습니다: ${forbiddenTrackedFiles.join(', ')}`)
}

const statusLines = output('git', ['status', '--porcelain=v1'])
  .split('\n')
  .filter(Boolean)

const unexpectedChanges = statusLines.filter((line) => {
  if (!line.startsWith('?? ')) return true
  const path = line.slice(3)
  return !allowedUntrackedPrefixes.some((prefix) => path.startsWith(prefix))
})

if (unexpectedChanges.length > 0) {
  throw new Error(`릴리스 후보에 확인되지 않은 변경이 있습니다:\n${unexpectedChanges.join('\n')}`)
}

const builtIndex = readFileSync('dist/index.html', 'utf8')
if (!builtIndex.includes('<div id="root"></div>')) {
  throw new Error('빌드 결과에서 React 루트 요소를 찾지 못했습니다.')
}

console.log(`\n릴리스 점검 통과: ${output('git', ['rev-parse', '--short', 'HEAD'])}`)
console.log('알려진 사용자 미추적 산출물은 보존했고 Production에는 아무 변경도 하지 않았습니다.')
