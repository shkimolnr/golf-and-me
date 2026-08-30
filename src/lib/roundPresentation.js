export function compactCoursePair(frontCourseName, backCourseName) {
  const front = frontCourseName || ''
  const back = backCourseName || ''
  const outMatch = front.match(/^(.+?)\s+OUT$/i)
  if (outMatch && back.toLocaleLowerCase() === `${outMatch[1]} in`.toLocaleLowerCase()) {
    return `${outMatch[1]} OUT / IN`
  }
  return [front, back].filter(Boolean).join(' / ')
}
