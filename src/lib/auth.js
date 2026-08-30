export function googleOAuthOptions(origin) {
  return {
    redirectTo: new URL('/', origin).toString(),
    queryParams: { prompt: 'select_account' },
  }
}
