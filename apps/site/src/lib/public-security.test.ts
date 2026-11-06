import { it, expect } from 'vitest'
import { publicSecurityHeaders } from './public-security.ts'
it('retains the exact existing default-deny policy for sites without approved files', () => {
  expect(publicSecurityHeaders()['content-security-policy']).toBe(
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self'; frame-src 'self' https://public.tableau.com; form-action 'self'; base-uri 'none'; frame-ancestors 'self'",
  )
})
it('allows only exact approved external hashes, without inline handlers or another script origin', () => {
  const hash = 'sha256-' + Buffer.alloc(32, 1).toString('base64'),
    csp = publicSecurityHeaders({ siteScriptHashes: [hash], siteStyles: true })['content-security-policy']!
  expect(csp).toContain(`script-src '${hash}'`)
  expect(csp).not.toContain("script-src 'self'")
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
  expect(csp).toContain("script-src-attr 'none'")
  expect(csp).toContain("connect-src 'self'")
  expect(csp).toContain("style-src 'unsafe-inline' 'self'")
})
it('refuses malformed hash text and retains governed application enhancement hashes', () => {
  const plain = publicSecurityHeaders({ siteScriptHashes: ["'unsafe-inline'", 'https://other.test/a.js'] })[
    'content-security-policy'
  ]!
  expect(plain).not.toContain('script-src ')
  const governed = publicSecurityHeaders({ providerFullscreen: true, faqFilter: true, scheduleFilter: true })[
    'content-security-policy'
  ]!
  expect(governed).toMatch(/script-src 'sha256-/)
  expect(governed).not.toContain("script-src 'self'")
})

it('allows the fixed Adobe CSS and font hosts only when the site opts in', () => {
  const plain = publicSecurityHeaders()['content-security-policy']!,
    kit = publicSecurityHeaders({ adobeFonts: true })['content-security-policy']!
  expect(plain).not.toContain('typekit.net')
  expect(kit).toContain("style-src 'unsafe-inline' https://use.typekit.net https://p.typekit.net")
  expect(kit).toContain("font-src 'self' https://use.typekit.net")
  expect(kit).toContain("img-src 'self' data: https://p.typekit.net")
  expect(kit).not.toContain('script-src ')
  expect(kit).not.toContain('connect-src ')
  expect(kit).not.toContain('performance.typekit.net')
})

it('permits only the code-owned carousel hash when a repeated hero is rendered', async () => {
  const { heroSlidesScriptHash } = await import('@cms/renderer'),
    plain = publicSecurityHeaders()['content-security-policy']!,
    hero = publicSecurityHeaders({ heroSlides: true })['content-security-policy']!
  expect(plain).not.toContain(heroSlidesScriptHash())
  expect(hero).toContain("script-src '" + heroSlidesScriptHash() + "'")
  expect(hero).not.toContain("script-src 'self'")
  expect(hero).not.toContain('unsafe-eval')
})

it('permits only the fixed Story widget hash and same-origin page navigation on widget pages', async () => {
  const { storyWidgetsScriptHash } = await import('@cms/renderer'),
    plain = publicSecurityHeaders()['content-security-policy']!,
    widget = publicSecurityHeaders({ storyWidgets: true })['content-security-policy']!
  expect(plain).not.toContain(storyWidgetsScriptHash())
  expect(widget).toContain("script-src '" + storyWidgetsScriptHash() + "'")
  expect(widget).toContain("connect-src 'self'")
  expect(widget).toContain("script-src-attr 'none'")
  expect(widget).not.toContain("script-src 'self'")
  expect(widget).not.toContain('unsafe-eval')
})

it('allows only the fixed chapter directory hash on marked pages', async () => {
  const { echelonDirectoryScriptHash } = await import('@cms/renderer'),
    plain = publicSecurityHeaders()['content-security-policy']!,
    directory = publicSecurityHeaders({ chapterDirectory: true })['content-security-policy']!
  expect(plain).not.toContain(echelonDirectoryScriptHash())
  expect(directory).toContain("script-src '" + echelonDirectoryScriptHash() + "'")
  expect(directory).not.toContain("script-src 'self'")
  expect(directory).not.toContain('unsafe-eval')
})

it('permits only the fixed national menu-fit file on pages with that header', async () => {
  const { nationalNavigationScriptHash } = await import('@cms/renderer'),
    plain = publicSecurityHeaders()['content-security-policy']!,
    header = publicSecurityHeaders({ nationalNavigation: true })['content-security-policy']!
  expect(plain).not.toContain(nationalNavigationScriptHash())
  expect(header).toContain("script-src '" + nationalNavigationScriptHash() + "'")
  expect(header).not.toContain("script-src 'self'")
  expect(header).not.toContain('unsafe-eval')
})
