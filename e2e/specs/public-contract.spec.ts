import { E2E_PORTS } from '../test-ports.ts'
// What the internet receives (SPEC §6.8, §9). Raw HTTP with no browser, plus
// one browser check with JavaScript switched off entirely — because "works
// without JavaScript" is a claim that deserves to be tested the literal way.
import { expect, test } from '@playwright/test'
import { SITE_PORT, STAGING_HOST, STAGING_ORIGIN, fetchPublic } from './helpers.ts'
import { rawRequest } from './http.ts'

test.describe('raw HTTP', () => {
  test('serves a complete document with real content and metadata', async () => {
    const { status, body, headers } = await fetchPublic()
    expect(status).toBe(200)
    expect(headers['content-type']).toContain('text/html')

    expect(body).toMatch(/<h1>[^<]+<\/h1>/)
    expect(body).toContain('<title>')
    expect(body).toContain('<meta name="description"')
    expect(body).toContain('<link rel="canonical"')
    expect(body).toContain('<meta property="og:title"')
    expect(body).toContain('<main id="cms-main">')
  })

  test('names itself once, absolutely, and on its own host', async () => {
    // The canonical link is the one element that says which address *is* this
    // document, so what ships has to be checked as a value and not just as a
    // tag that exists: two of them, a relative one, or one naming another host
    // are each a different page from the one that was published (SPEC §6.8).
    const { body } = await fetchPublic()

    const canonical = [...body.matchAll(/<link rel="canonical" href="([^"]*)">/g)].map(m => m[1]!)
    expect(canonical).toEqual([`https://${STAGING_HOST}/`])

    const ogUrl = [...body.matchAll(/<meta property="og:url" content="([^"]*)">/g)].map(m => m[1]!)
    expect(ogUrl, 'og:url and the canonical link must name one address, not two').toEqual(canonical)
  })

  test('names no host in its head that this site has not verified', async () => {
    // Broader than the canonical link on purpose: the head is where a page's
    // identity is declared, and an off-site absolute or protocol-relative URL
    // in any of it — canonical, og:url, og:image — is the same failure. The
    // count is asserted first so this cannot pass by matching nothing.
    const { body } = await fetchPublic()
    const head = body.slice(0, body.indexOf('</head>'))
    const urls = [...head.matchAll(/(?:href|content)="(https?:\/\/[^"]*|\/\/[^"]*)"/g)].map(m => m[1]!)

    expect(urls.length, 'the head should contain absolute URLs for this to be checking anything').toBeGreaterThan(0)
    for (const url of urls) {
      expect(url, `head URL ${url} names a host this site has not verified`).toMatch(
        new RegExp(`^https://${STAGING_HOST}(/|$)`),
      )
    }
  })

  test('needs no JavaScript for its content', async () => {
    const { body } = await fetchPublic()
    expect(body).not.toMatch(/<script/i)
  })

  test('loads no third-party font or script CDN', async () => {
    const { body } = await fetchPublic()
    expect(body).not.toMatch(/https?:\/\/fonts\./)
    expect(body).not.toMatch(/<link[^>]+rel="stylesheet"/)
  })

  test('carries the browser-boundary headers', async () => {
    const { headers } = await fetchPublic()
    expect(headers['content-security-policy']).toContain("default-src 'none'")
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })

  test('keeps a staging host out of the index', async () => {
    const { body, headers } = await fetchPublic()
    expect(body).toContain('content="noindex,nofollow"')
    expect(headers['x-robots-tag']).toContain('noindex')
  })

  test('an ETag that includes the published revision enables a 304', async () => {
    const first = await fetchPublic()
    const etag = first.headers['etag']!
    expect(etag).toBeTruthy()

    const second = await fetchPublic('/', { 'If-None-Match': etag })
    expect(second.status).toBe(304)
  })

  test('moves a V1 file-style address to its page for good, and nothing else', async () => {
    // Bookmarks and search results keep V1's `/index.html`-style addresses after cutover.
    const home = await fetchPublic('/index.html?from=bookmark&tag=a&tag=b')
    expect(home.status).toBe(308)
    expect(home.headers['location']).toBe('/?from=bookmark&tag=a&tag=b')
    expect((await fetchPublic('/no-such-page.html')).status).toBe(404)
  })

  test('robots.txt disallows a staging host', async () => {
    const response = await fetchPublic('/robots.txt')
    expect(response.body).toContain('Disallow: /')
  })
})

test.describe('host isolation', () => {
  for (const [name, host] of [
    ['an unknown host', 'nobody.example.test'],
    ['a host with userinfo', 'user@demo.staging.localhost'],
    ['a host carrying a path', 'demo.staging.localhost/../other'],
    ['an empty host', ''],
  ] as const) {
    test(`${name} gets a neutral 404`, async () => {
      const response = await rawRequest({ host, path: '/', port: SITE_PORT })
      expect(response.status).toBe(404)
      // Neutral: it names no tenant and hints at nothing that does exist.
      expect(response.body).toContain('Page not found')
      expect(response.body).not.toContain('demo')
    })
  }

  test('an unpublished path on a real host is a 404', async () => {
    const { status } = await fetchPublic('/definitely-not-a-page')
    expect(status).toBe(404)
  })

  test('host matching ignores case and port', async () => {
    const response = await rawRequest({ host: `DEMO.Staging.LocalHost:${E2E_PORTS.site}`, path: '/', port: SITE_PORT })
    expect(response.status).toBe(200)
  })
})

test.describe('with JavaScript disabled in the browser', () => {
  test.use({ javaScriptEnabled: false })

  test('the page still shows its heading and content', async ({ page }) => {
    // Chromium maps *.localhost to loopback, so this is the real Host header
    // going through the real tenant-routing path with scripting switched off.
    const response = await page.goto(`${STAGING_ORIGIN}/`)
    expect(response!.status()).toBe(200)
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.locator('#cms-main')).not.toBeEmpty()
  })

  test('an unknown host is a neutral 404 in the browser too', async ({ page }) => {
    const response = await page.goto(`http://nobody.localhost:${E2E_PORTS.site}/`)
    expect(response!.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  })
})
