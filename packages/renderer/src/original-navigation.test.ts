import { it, expect } from 'vitest'
import { renderOriginalNavigation } from './original-navigation.ts'
import { compileSection } from './compile.ts'
import { renderPage, type SiteShell } from './render.ts'
const page = '11111111-1111-4111-a111-111111111111',
  defId = '22222222-2222-4222-a222-222222222222'
const tree = [
  { label: 'Speakers', visible: true, target: { type: 'url', url: '/#guests' } },
  {
    label: 'More',
    visible: true,
    target: { type: 'url', url: '/' },
    children: [{ label: 'Hotel & travel', visible: true, target: { type: 'page', page_id: page } }],
  },
]
it('preserves original Bootstrap classes, dropdown attributes and home scroll anchors', () => {
  const html = renderOriginalNavigation(tree, () => '/hotel-information', '/')
  expect(html).toBe(
    '<ul class="navbar-nav ms-auto"><li class="nav-item"><a class="nav-link page-scroll" href="#guests">Speakers</a></li><li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" aria-expanded="false">More</a><ul class="dropdown-menu dropdown-menu-end"><li><a class="dropdown-item" href="/hotel-information">Hotel &amp; travel</a></li></ul></li></ul>',
  )
  expect(renderOriginalNavigation(tree, () => '/hotel-information', '/visit')).toContain('href="/#guests"')
  expect(renderOriginalNavigation(tree, () => '/hotel-information', '/', true)).toContain('data-cms-menu-path="1.0"')
  expect(html).not.toContain('data-cms-')
})
it('hides missing pages, invisible items and groups with no visible destinations', () => {
  expect(renderOriginalNavigation(tree, () => null, '/')).not.toContain('dropdown')
  expect(renderOriginalNavigation([{ ...tree[0], visible: false }], () => null, '/')).toBe(
    '<ul class="navbar-nav ms-auto"></ul>',
  )
  expect(renderOriginalNavigation([], () => null, '/')).toBe('<ul class="navbar-nav ms-auto"></ul>')
})
it('escapes labels and refuses unsafe URLs, deeper trees and unsafe projected page paths', () => {
  expect(renderOriginalNavigation([{ ...tree[0], label: '<img onerror="x">' }], () => null, '/')).toContain(
    '&lt;img onerror="x"&gt;',
  )
  expect(
    renderOriginalNavigation([{ ...tree[0], target: { type: 'url', url: 'javascript:alert(1)' } }], () => null, '/'),
  ).toBe('')
  expect(
    renderOriginalNavigation([{ ...tree[1], children: [{ ...tree[0], children: [tree[0]] }] }], () => null, '/'),
  ).toBe('')
  expect(
    renderOriginalNavigation(
      [{ label: 'Page', visible: true, target: { type: 'page', page_id: page } }],
      () => 'javascript:alert(1)',
      '/',
    ),
  ).toBe('<ul class="navbar-nav ms-auto"></ul>')
})
it('uses the closed formatter only on a matching reviewed original frame pin', () => {
  const slots = [
      { id: 'menu', kind: 'navigation' as const, label: 'Menu', constraints: { menuStyle: 'bt2027-bootstrap5' } },
    ],
    compiled = compileSection({ sourceHtml: '<nav>{{menu}}</nav>', slots })
  expect(compiled.blocking).toEqual([])
  const def = { section_def_id: defId, version: 1, slug: 'original-menu', slots, compiled_ast: compiled.ast },
    original = {
      version: 1,
      definitions: [{ section_def_id: defId, section_def_version: 1 }],
      pages: [{ pageId: page, html: {}, body: {}, header: true, footer: false }],
    }
  const shell: SiteShell = {
    site: { id: 'site', name: 'Original', slug: 'original' },
    theme: {},
    navigation: tree as SiteShell['navigation'],
    canonical_host: null,
    staging_host: null,
    header: {
      schemaVersion: 2,
      enabled: true,
      sticky: false,
      component: { section_def_id: defId, section_def_version: 1, values: { menu: '<script>wrong</script>' } },
    },
    header_component: def,
    site_files: { versionId: page, files: [], bundle: { version: 1, files: [], scripts: [], styles: [], original } },
  }
  const render = (view: SiteShell) =>
    renderPage({
      manifest: { page: { id: page, version_id: 'v', title: 'Home', path: '/' }, meta: {}, sections: [] },
      shell: view,
      isStaging: true,
      navigationPaths: { [page]: '/hotel-information' },
    }).html
  expect(render(shell)).toContain('class="navbar-nav ms-auto"')
  expect(render({ ...shell, site_files: undefined })).not.toContain('class="navbar-nav ms-auto"')
  expect(render({ ...shell, header_component: { ...def, version: 2 } })).not.toContain('class="navbar-nav ms-auto"')
  expect(
    render({ ...shell, header_component: { ...def, slots: slots.map(slot => ({ ...slot, constraints: {} })) } }),
  ).not.toContain('class="navbar-nav ms-auto"')
  expect(render(shell)).not.toContain('<script>wrong')
})
