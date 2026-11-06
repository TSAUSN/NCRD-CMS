import { expect, it } from 'vitest'
import { sitemapXml } from './sitemap.ts'
it('sitemaps escape their published addresses and share the same dates in private and public views', () => {
  const routes = [{ path: '/help?a=1&b=2', updatedAt: '2026-11-01T12:00:00Z' }]
  expect(sitemapXml('https://example.test', routes)).toContain(
    '<loc>https://example.test/help?a=1&amp;b=2</loc><lastmod>2026-11-01T12:00:00.000Z</lastmod>',
  )
  expect(sitemapXml('http://demo.staging.localhost:3001', [])).toBe(
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
  )
  for (const origin of ['javascript:alert(1)', 'https://name:password@example.test', 'https://example.test/path'])
    expect(() => sitemapXml(origin, routes)).toThrow()
  for (const path of ['//other.test/page', '/bad\\path', '/bad\u0001path'])
    expect(() => sitemapXml('https://example.test', [{ path, updatedAt: new Date() }])).toThrow()
})
