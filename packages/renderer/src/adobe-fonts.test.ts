import { expect, it } from 'vitest'
import { adobeFontsEnabled, adobeKitLink, ADOBE_KIT_URL } from './adobe-fonts.ts'
import { renderPage, type SiteShell } from './render.ts'
const theme = {
  fonts: {
    heading: "'trajan-pro-3', 'Source Serif 4', Georgia, serif",
    body: "'proxima-nova', 'Open Sans', Arial, sans-serif",
    adobeKit: { id: 'euh2hvn' as const, enabled: true, domains: ['sawso.staging.localhost'] },
  },
}
it('loads only the fixed approved stylesheet on the site-owned allowed hostname', () => {
  expect(adobeFontsEnabled(theme, 'sawso.staging.localhost:3001')).toBe(true)
  expect(adobeKitLink(theme, 'sawso.staging.localhost')).toContain(ADOBE_KIT_URL)
  for (const host of [
    'other.staging.localhost',
    'sawso.staging.localhost.evil.test',
    'sawso.staging.localhost/evil',
    'sawso.staging.localhost:3001/evil',
    null,
  ])
    expect(adobeKitLink(theme, host)).toBe('')
  expect(
    adobeKitLink(
      { fonts: { adobeKit: { id: 'unapproved', enabled: true, domains: ['sawso.staging.localhost'] } } },
      'sawso.staging.localhost',
    ),
  ).toBe('')
})
it('keeps stand-ins available while a disallowed address emits no remote stylesheet', () => {
  const shell: SiteShell = {
    site: { id: 'site', name: '[Site]', slug: 'sample' },
    theme,
    navigation: [],
    canonical_host: null,
    staging_host: 'sawso.staging.localhost',
  }
  const manifest = { page: { id: 'page', version_id: 'version', title: '[Page]', path: '/' }, sections: [], meta: {} }
  const yes = renderPage({ shell, manifest, isStaging: true, options: { servingHost: 'sawso.staging.localhost' } }).html
  expect(yes).toContain('data-cms-adobe-kit="euh2hvn"')
  expect(yes).toContain("'Source Serif 4', Georgia, serif")
  expect(yes).toContain("'Open Sans', Arial, sans-serif")
  expect(
    renderPage({ shell, manifest, isStaging: true, options: { servingHost: 'unlisted.localhost' } }).html,
  ).not.toContain(ADOBE_KIT_URL)
})
