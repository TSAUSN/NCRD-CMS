import { expect, it } from 'vitest'
import { renderPage, type SiteShell } from './render.ts'
const manifest = {
    page: { id: 'page', version_id: 'version', title: '[Page]', path: '/' },
    meta: { description: '[Page description]' },
    sections: [],
  },
  shell: SiteShell = {
    site: { id: 'site', name: '[Site]', slug: 'site' },
    theme: {},
    navigation: [],
    canonical_host: 'example.test',
    staging_host: null,
  }
it('supported verification tokens and escaped hints share the normal head without changing page description,canonical or noindex', () => {
  const settings = {
      schemaVersion: 1,
      name: '[Site]',
      search: {
        verification: [{ name: 'google-site-verification', content: 'test-token' }],
        hints: 'help & "neighbors"',
      },
    },
    html = renderPage({ manifest, shell: { ...shell, settings }, isStaging: true }).html
  expect(html).toContain('<meta name="google-site-verification" content="test-token">')
  expect(html).toContain('<meta name="keywords" content="help &amp; &quot;neighbors&quot;">')
  expect(html).toContain('<meta name="description" content="[Page description]">')
  expect(html).toContain('<link rel="canonical" href="https://example.test/">')
  expect(html).toContain('<meta name="robots" content="noindex,nofollow">')
  expect(
    renderPage({
      manifest,
      shell: {
        ...shell,
        settings: { ...settings, search: { verification: [{ name: 'script', content: 'bad' }], hints: '' } },
      },
      isStaging: true,
    }).html,
  ).not.toContain('name="script"')
  const before = renderPage({ manifest, shell, isStaging: true }).html
  expect(
    renderPage({
      manifest,
      shell: { ...shell, settings: { schemaVersion: 1, name: '[Site]', search: { verification: [], hints: '' } } },
      isStaging: true,
    }).html,
  ).toBe(before)
})

it('General language and site description apply only to native pages and leave page-owned descriptions first', () => {
  const settings = {
      schemaVersion: 1,
      name: '[Site]',
      general: { description: '[Site description]', country: '', language: 'es', email: '', phone: '', address: '' },
    },
    changed = { ...shell, settings }
  expect(renderPage({ manifest, shell: changed, isStaging: true }).html).toContain(
    '<meta name="description" content="[Page description]">',
  )
  const fallback = renderPage({ manifest: { ...manifest, meta: {} }, shell: changed, isStaging: true }).html
  expect(fallback).toContain('<html lang="es">')
  expect(fallback).toContain('<meta name="description" content="[Site description]">')
  const original = {
    ...changed,
    site_files: {
      versionId: '11111111-1111-4111-a111-111111111111',
      files: [],
      bundle: {
        version: 1,
        files: [],
        scripts: [],
        styles: [],
        original: {
          version: 1,
          definitions: [],
          pages: [
            {
              pageId: '22222222-2222-4222-a222-222222222222',
              html: { lang: 'en' },
              body: {},
              header: false,
              footer: false,
            },
          ],
        },
      },
    },
  }
  expect(
    renderPage({
      manifest: { ...manifest, page: { ...manifest.page, id: '22222222-2222-4222-a222-222222222222' }, meta: {} },
      shell: original,
      isStaging: true,
    }).html,
  ).toContain('<html lang="en">')
  expect(
    renderPage({
      manifest: { ...manifest, page: { ...manifest.page, id: '22222222-2222-4222-a222-222222222222' }, meta: {} },
      shell: original,
      isStaging: true,
    }).html,
  ).not.toContain('[Site description]')
})
