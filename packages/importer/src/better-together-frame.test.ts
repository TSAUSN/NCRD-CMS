import { it, expect } from 'vitest'
import { compileSection } from '@cms/renderer'
import {
  convertBetterTogetherLinks,
  convertBetterTogetherMenu,
  BETTER_TOGETHER_FOOTER_LABELS,
} from './better-together-frame.ts'
const id = '11111111-1111-4111-a111-111111111111',
  text = (n: number) => ({ id: 'text-' + n, kind: 'text' as const, label: 'Label ' + n, constraints: {} })
const header = {
  sourceHtml:
    '<nav class="navbar"><a class="navbar-brand logo-image" href="index.php"><img src="{{picture-0}}" alt="{{picture-0}}"></a><div class="collapse" id="navbarsExampleDefault"><ul class="navbar-nav ms-auto">' +
    ['location', 'guests', 'sponsors-showcase', 'tracks', 'sponsors']
      .map(
        (hash, i) =>
          '<li class="nav-item"><a class="nav-link page-scroll" href="#' + hash + '">{{text-' + (i + 1) + '}}</a></li>',
      )
      .join('') +
    '<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" aria-expanded="false">{{text-6}}</a><ul class="dropdown-menu dropdown-menu-end">' +
    ['hotel-information.php', 'kansas-city.php', 'registration-FAQs.php']
      .map((path, i) => '<li><a class="dropdown-item" href="' + path + '">{{text-' + (i + 7) + '}}</a></li>')
      .join('') +
    '</ul></li></ul></div></nav>',
  slots: [
    { id: 'picture-0', kind: 'image' as const, label: 'Logo', constraints: {} },
    ...Array.from({ length: 9 }, (_, i) => text(i + 1)),
  ],
  values: {
    'picture-0': { src: '/images/logo.png', alt: 'Logo' },
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['text-' + (i + 1), 'Menu ' + (i + 1)])),
  },
}
const paths = {
  'index.php': '/',
  'hotel-information.php': '/hotel-information',
  'kansas-city.php': '/kansas-city',
  'registration-FAQs.php': '/registration-faqs',
}
it('converts only the original menu range and logo href, with exact governed destinations', () => {
  const originalValues: Record<string, unknown> = header.values
  const converted = convertBetterTogetherMenu(header, paths, [{ id, path: '/hotel-information' }])
  expect(converted.menu).toHaveLength(6)
  expect(converted.menu[0]!.target).toEqual({ type: 'url', url: '/#location' })
  expect(converted.menu[5]!.children![0]!.target).toEqual({ type: 'page', page_id: id })
  expect(converted.sourceHtml).toBe(
    '<nav class="navbar"><a class="navbar-brand logo-image" href="{{link-0}}"><img src="{{picture-0}}" alt="{{picture-0}}"></a><div class="collapse" id="navbarsExampleDefault">{{menu}}</div></nav>',
  )
  expect(converted.slots.map(slot => slot.id)).toEqual(['picture-0', 'link-0', 'menu'])
  expect(converted.values).toEqual({ 'picture-0': header.values['picture-0'], 'link-0': { url: '/', label: 'Logo' } })
  const compiled = compileSection({ sourceHtml: converted.sourceHtml, slots: converted.slots })
  expect(compiled.blocking).toEqual([])
  expect(compiled.problems).toEqual([])
  expect(compiled.carriesTrustedCode).toBe(false)
  expect(originalValues['text-1']).toBe('Menu 1')
})
it('adds typed footer destinations beside their labels and labels original social icons', () => {
  const source = {
    sourceHtml:
      '<div class="footer"><h6>{{text-0}}</h6><a class="btn-solid-reg" href="/manifesto">{{text-2}}</a><a href="mailto:hello@example.test">{{text-10}}</a><a class="footer-social-icon" target="_blank" rel="noopener" href="https://example.test/f"><i class="fab fa-facebook-square"></i></a><a class="footer-social-icon" href="https://example.test/l"><i class="fab fa-linkedin"></i></a><p>Copyright <a href="https://example.test">{{text-11}}</a></p></div>',
    slots: [text(0), text(2), text(10), text(11)],
    values: { 'text-0': 'Conference', 'text-2': 'Manifesto', 'text-10': 'Email us', 'text-11': 'Organisation' },
  }
  const converted = convertBetterTogetherLinks(source, {}, BETTER_TOGETHER_FOOTER_LABELS)
  expect(converted.slots.map(slot => slot.id)).toEqual([
    'text-0',
    'text-2',
    'link-0',
    'text-10',
    'link-1',
    'link-2',
    'link-3',
    'text-11',
    'link-4',
  ])
  expect(converted.sourceHtml).toContain(
    '<a aria-label="Facebook" class="footer-social-icon" target="_blank" rel="noopener" href="{{link-2}}"><i class="fab fa-facebook-square"></i></a>',
  )
  expect(converted.values['link-1']).toEqual({ url: 'mailto:hello@example.test', label: 'Email us' })
  expect(converted.slots.find(slot => slot.id === 'text-11')!.label).toBe('Copyright label')
  expect(compileSection({ sourceHtml: converted.sourceHtml, slots: converted.slots }).blocking).toEqual([])
})
it('preserves compact and legacy menu classes and external application destinations', () => {
  const source = {
    sourceHtml:
      '<nav class="navbar"><a class="navbar-brand" href="index.html"><img src="{{picture}}"></a><a class="nav-link page-scroll" data-toggle="offcanvas" href="https://example.test/app">{{title}}</a></nav>',
    slots: [
      { id: 'picture', kind: 'image' as const, label: 'Logo', constraints: {} },
      { id: 'title', kind: 'text' as const, label: 'Back to homepage', constraints: {} },
    ],
    values: { picture: { src: '/logo.png', alt: 'Logo' }, title: 'Back to homepage' },
  }
  const converted = convertBetterTogetherLinks(source, { 'index.html': '/' })
  expect(
    converted.sourceHtml
      .replace(/href="\{\{link-0\}\}"/, 'href="index.html"')
      .replace(/href="\{\{link-1\}\}"/, 'href="https://example.test/app"'),
  ).toBe(source.sourceHtml)
  expect(converted.values['link-1']).toEqual({ url: 'https://example.test/app', label: 'Back to homepage' })
})
it('refuses unreviewed menu shapes, missing mappings and hostile link destinations without mutating input', () => {
  expect(() =>
    convertBetterTogetherMenu(
      { ...header, sourceHtml: header.sourceHtml.replace('class="nav-link page-scroll"', 'class="changed"') },
      paths,
      [],
    ),
  ).toThrow(/changed/)
  expect(() => convertBetterTogetherMenu(header, {}, [])).toThrow(/destination/)
  for (const href of [
    'javascript:alert(1)',
    '//foreign.test',
    'https://user:password@example.test/',
    '/\\foreign.test',
  ])
    expect(() =>
      convertBetterTogetherLinks(
        {
          sourceHtml: '<div><a href="' + href + '">{{text-1}}</a></div>',
          slots: [text(1)],
          values: { 'text-1': 'Link' },
        },
        {},
      ),
    ).toThrow(/destination/)
  expect(header.sourceHtml).toContain('href="index.php"')
})
