const CACHE_PREFIX = 'golf-and-me-shell-'
const CACHE_NAME = `${CACHE_PREFIX}v1`

function sameOriginUrl(value) {
  try {
    const url = new URL(value, self.location.origin)
    return url.origin === self.location.origin ? url.href : null
  } catch {
    return null
  }
}

function referencedAssets(text, baseUrl) {
  const urls = new Set()
  const patterns = [/(?:src|href)=["']([^"']+)["']/g, /url\(["']?([^"')]+)["']?\)/g]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const absolute = sameOriginUrl(new URL(match[1], baseUrl).href)
      if (absolute) urls.add(absolute)
    }
  }
  return [...urls]
}

async function cacheShell() {
  const cache = await caches.open(CACHE_NAME)
  const homeResponse = await fetch('/', { cache: 'no-cache' })
  if (!homeResponse.ok) return

  await cache.put('/', homeResponse.clone())
  await cache.put('/index.html', homeResponse.clone())

  const html = await homeResponse.text()
  const firstPass = referencedAssets(html, self.location.origin)
  await Promise.all(firstPass.map(async url => {
    try {
      const response = await fetch(url, { cache: 'no-cache' })
      if (!response.ok) return
      await cache.put(url, response.clone())
      if (response.headers.get('content-type')?.includes('text/css')) {
        const css = await response.text()
        const nested = referencedAssets(css, url)
        await Promise.all(nested.map(async nestedUrl => {
          try {
            const nestedResponse = await fetch(nestedUrl, { cache: 'no-cache' })
            if (nestedResponse.ok) await cache.put(nestedUrl, nestedResponse)
          } catch {
            // A missing optional asset must not prevent the rest of the shell from caching.
          }
        }))
      }
    } catch {
      // Installation remains usable even if an optional asset cannot be prefetched.
    }
  }))
}

self.addEventListener('install', event => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      try {
        const response = await fetch(request)
        if (response.ok) {
          await cache.put('/', response.clone())
          await cache.put('/index.html', response.clone())
        }
        return response
      } catch {
        return (await cache.match(request)) || (await cache.match('/')) || (await cache.match('/index.html'))
      }
    })())
    return
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(request)
    if (cached) return cached
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  })())
})
