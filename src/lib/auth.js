export function googleOAuthOptions(origin) {
  return {
    redirectTo: new URL('/', origin).toString(),
    queryParams: { prompt: 'select_account' },
  }
}

const AUTH_QUERY_KEYS = [
  'code',
  'sb_flow_id',
  'error',
  'error_code',
  'error_description',
]

const AUTH_FRAGMENT_KEYS = [
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'expires_at',
  'expires_in',
  'token_type',
  'error',
  'error_code',
  'error_description',
]

function fragmentParams(url) {
  return new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
}

export function authCallbackError(href) {
  const url = new URL(href)
  const fragment = fragmentParams(url)
  return url.searchParams.get('error_description') || fragment.get('error_description') || ''
}

export function sanitizedAuthCallbackPath(href) {
  const url = new URL(href)
  const fragment = fragmentParams(url)
  const hasAuthQuery = AUTH_QUERY_KEYS.some(key => url.searchParams.has(key))
  const hasAuthFragment = AUTH_FRAGMENT_KEYS.some(key => fragment.has(key))

  if (!hasAuthQuery && !hasAuthFragment) return null

  AUTH_QUERY_KEYS.forEach(key => url.searchParams.delete(key))
  if (hasAuthFragment) url.hash = ''
  return `${url.pathname}${url.search}${url.hash}`
}

export function clearAuthCallbackFromAddress(browserWindow) {
  const nextPath = sanitizedAuthCallbackPath(browserWindow.location.href)
  if (!nextPath) return false
  browserWindow.history.replaceState(browserWindow.history.state, '', nextPath)
  return true
}
