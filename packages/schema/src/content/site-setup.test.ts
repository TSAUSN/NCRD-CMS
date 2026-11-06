import { describe, expect, it } from 'vitest'
import { DEFAULT_FOOTER_CONFIG_V1, DEFAULT_HEADER_CONFIG_V1 } from './global-elements.ts'
import { DEFAULT_THEME_TOKENS } from './theme.ts'
import { SITE_SETUP_FOOTER_PAGES, SiteSetup } from './site-setup.ts'

const page = (slug: string, title: string, extra: Record<string, unknown> = {}) => ({
  slug,
  title,
  intro: '',
  body: '',
  layout: 'content',
  ...extra,
})
const setup = (pages: unknown[]) => ({
  schemaVersion: 1,
  name: 'Plan',
  slug: 'plan',
  kind: 'resource',
  theme: DEFAULT_THEME_TOKENS,
  header: DEFAULT_HEADER_CONFIG_V1,
  footer: DEFAULT_FOOTER_CONFIG_V1,
  pages,
})

it('accepts a chapter template without adding event or member-list requirements', () => {
  const result = SiteSetup.parse(
    setup([page('', '[National home]'), page('chapter', '[Chapter name]', { template: 'chapter' })]),
  )
  expect(result.pages[1]!.template).toBe('chapter')
  expect(result.pages[1]!.layout).toBe('content')
})

// V1 reference 23: “Nest puts a page underneath the one above it … Pages go one
// level deep, and the home page always stays at the top”, and “In the footer”.
describe('planned pages nested in the menu and listed in the footer', () => {
  it('defaults older setup files to top-level pages left out of the footer', () => {
    const parsed = SiteSetup.parse(setup([page('', 'Home'), page('about', 'About')]))
    expect(parsed.pages.map(item => [item.nested, item.footer])).toEqual([
      [false, false],
      [false, false],
    ])
  })

  it('nests a page under the closest top-level page above it, never under the home page', () => {
    expect(
      SiteSetup.safeParse(
        setup([
          page('', 'Home'),
          page('work', 'Our work'),
          page('stories', 'Stories', { nested: true }),
          page('press', 'Press', { nested: true }),
        ]),
      ).success,
    ).toBe(true)
    for (const pages of [
      [page('', 'Home', { nested: true }), page('work', 'Our work')],
      [page('', 'Home'), page('work', 'Our work', { nested: true })],
    ]) {
      const result = SiteSetup.safeParse(setup(pages))
      expect(result.success).toBe(false)
      if (!result.success)
        expect(result.error.issues[0]!.message).toMatch(
          /can be nested only under a page above it other than the home page/,
        )
    }
  })

  it(`lists at most ${SITE_SETUP_FOOTER_PAGES} pages in the footer`, () => {
    const pages = [
      page('', 'Home', { footer: true }),
      ...Array.from({ length: SITE_SETUP_FOOTER_PAGES }, (_, index) =>
        page(`page-${index}`, `Page ${index}`, { footer: true }),
      ),
    ]
    const result = SiteSetup.safeParse(setup(pages))
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.issues[0]!.message).toBe(`Choose at most ${SITE_SETUP_FOOTER_PAGES} pages for the footer.`)
    expect(SiteSetup.safeParse(setup(pages.slice(0, SITE_SETUP_FOOTER_PAGES))).success).toBe(true)
  })
})

// SPEC §6 step 4: “optional partner identity and shared links”. Links every page
// shows can be planned when they go to a web address; the site's own pages and
// media exist only after creation.
describe('links shared by every page', () => {
  const link = (label: string, url: string) => ({ label, target: { type: 'url', url } })
  const withLinks = (header: unknown[], footer: unknown[], pages = [page('', 'Home'), page('about', 'About')]) => ({
    ...setup(pages),
    header: { ...DEFAULT_HEADER_CONFIG_V1, utilityLinks: header },
    footer: { ...DEFAULT_FOOTER_CONFIG_V1, groups: footer.length ? [{ heading: 'Useful links', links: footer }] : [] },
  })

  it('plans header and footer links to web addresses and paths', () => {
    expect(
      SiteSetup.safeParse(
        withLinks(
          [link('Donate', 'https://give.example.org/'), link('Contact', '/contact')],
          [link('Annual report', 'https://example.org/report')],
        ),
      ).success,
    ).toBe(true)
  })

  it('leaves links to the site’s own pages, logos and unsafe addresses until after creation', () => {
    const pageLink = { label: 'About', target: { type: 'page', page_id: '00000000-0000-4000-8000-000000000001' } }
    const refused = SiteSetup.safeParse(withLinks([pageLink], []))
    expect(refused.success).toBe(false)
    if (!refused.success)
      expect(refused.error.issues[0]!.message).toMatch(/Link to the site’s own pages after creating it/)
    expect(SiteSetup.safeParse(withLinks([link('Unsafe', 'javascript:alert(1)')], [])).success).toBe(false)
    expect(SiteSetup.safeParse(withLinks([link('Insecure', 'http://example.org/')], [])).success).toBe(false)
    const logo = SiteSetup.safeParse({
      ...withLinks([], []),
      header: {
        ...DEFAULT_HEADER_CONFIG_V1,
        brand: { ...DEFAULT_HEADER_CONFIG_V1.brand, logoMediaId: '00000000-0000-4000-8000-000000000002' },
      },
    })
    expect(logo.success).toBe(false)
  })

  it('keeps room in the footer for the pages chosen for it', () => {
    const groups = Array.from({ length: 4 }, (_, index) => ({ heading: `Group ${index}`, links: [link('x', '/x')] }))
    const full = {
      ...setup([page('', 'Home'), page('about', 'About', { footer: true })]),
      footer: { ...DEFAULT_FOOTER_CONFIG_V1, groups },
    }
    const result = SiteSetup.safeParse(full)
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.issues[0]!.message).toMatch(/at most 4 groups of links, including the pages chosen for it/)
    expect(SiteSetup.safeParse({ ...full, footer: { ...full.footer, groups: groups.slice(0, 3) } }).success).toBe(true)
  })
})
