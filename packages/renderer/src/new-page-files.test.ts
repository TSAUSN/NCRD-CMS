import { it, expect } from 'vitest'
import { renderSiteFiles, siteFileIntegrity } from './site-files.ts'
const home = '11111111-1111-4111-a111-111111111111',
  old = '22222222-2222-4222-a222-222222222222',
  added = '33333333-3333-4333-a333-333333333333'
const menu = { id: home, kind: 'script', name: 'menu.js', sha256: 'a'.repeat(64), bytes: 10, source: 'local:menu' },
  carousel = { ...menu, id: old, name: 'carousel.js', sha256: 'b'.repeat(64) },
  style = { ...menu, id: added, kind: 'stylesheet', name: 'original.css', sha256: 'c'.repeat(64) }
const projection = {
  versionId: home,
  files: [menu, carousel, style],
  bundle: {
    version: 1,
    files: [home, old, added],
    scripts: [
      { fileId: home, pages: [home], newPages: true, position: 'body-end', loading: 'normal' },
      { fileId: old, pages: [home], position: 'body-end', loading: 'normal' },
    ],
    styles: [{ fileId: added, pages: [home], newPages: true }],
    original: {
      version: 1,
      definitions: [],
      pages: [
        { pageId: home, html: {}, body: {}, header: true, footer: true },
        { pageId: old, html: {}, body: {}, header: false, footer: false },
      ],
      newPages: { html: { lang: 'en' }, body: {}, header: true, footer: true },
    },
  },
}
it('loads only the explicitly approved common files for new pages and exact corresponding CSP hashes', () => {
  const fresh = renderSiteFiles(projection, added)
  expect(fresh.bodyEnd).toContain('menu.js')
  expect(fresh.bodyEnd).not.toContain('carousel.js')
  expect(fresh.head).toContain('original.css')
  expect(fresh.scriptHashes).toEqual([siteFileIntegrity(menu.sha256)])
  expect(renderSiteFiles(projection, home).scriptHashes).toEqual([
    siteFileIntegrity(menu.sha256),
    siteFileIntegrity(carousel.sha256),
  ])
  const legacy = renderSiteFiles(projection, old)
  expect(legacy.scriptHashes).toEqual([])
  expect(legacy.hasStyles).toBe(false)
  const uppercase = {
    ...projection,
    bundle: {
      ...projection.bundle,
      original: {
        ...projection.bundle.original,
        pages: projection.bundle.original.pages.map(page => ({ ...page, pageId: page.pageId.toUpperCase() })),
      },
    },
  }
  expect(renderSiteFiles(uppercase, old).scriptHashes).toEqual([])
  const noScripts = renderSiteFiles(projection, added, false)
  expect(noScripts.bodyEnd).toBe('')
  expect(noScripts.scriptHashes).toEqual([])
  expect(noScripts.head).toContain('original.css')
})
it('fails closed without approved defaults, with a changed projection or with a non-boolean choice', () => {
  const { newPages, ...original } = projection.bundle.original
  for (const value of [
    { ...projection, bundle: { ...projection.bundle, original } },
    { ...projection, files: [menu, carousel] },
    {
      ...projection,
      bundle: { ...projection.bundle, scripts: [{ ...projection.bundle.scripts[0], newPages: 'true' }] },
    },
  ])
    expect(renderSiteFiles(value, added)).toEqual({
      head: '',
      bodyStart: '',
      bodyEnd: '',
      scriptHashes: [],
      hasStyles: false,
    })
  expect(newPages.header).toBe(true)
})
