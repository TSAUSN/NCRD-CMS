// A hostile structured document, put through the renderer and then through a
// real browser (SPEC §9).
//
// The reproduction: about 5,000 nested element nodes around one text field.
// `structuredSectionProblems` threw `RangeError: Maximum call stack size
// exceeded`, which in a request handler is a 500 rather than a missing section
// — a document a stranger could store taking the page down instead of being
// refused by the gate that exists to refuse it.
//
// The fixtures below vary one thing each. A depth fixture that is also missing
// a field declaration is refused at every depth, so it would pass a depth test
// without ever telling anyone where the boundary is.
import { expect, test } from '@playwright/test'
import {
  CSS_POLICY_VERSION,
  renderPage,
  renderSection,
  type ManifestSection,
  type RenderManifest,
  type SiteShell,
} from '@cms/renderer'
import { STRUCTURED_SCHEMA_VERSION } from '@cms/schema'

const SHELL: SiteShell = {
  site: { id: 'site', name: 'Site', slug: 'site' },
  theme: {},
  navigation: [],
  canonical_host: null,
  staging_host: null,
}

/**
 * A valid document whose deepest path holds exactly `levels` nodes.
 *
 * `levels - 1` elements around one text field, because a field node is a node
 * and occupies a level of its own. Sixteen levels is the most a section may
 * have — fifteen nested tags and the field inside them.
 */
function atDepth(levels: number): unknown {
  let node: unknown = { type: 'text', field: 'a' }
  for (let i = 1; i < levels; i += 1) node = { type: 'element', tag: 'div', children: [node] }
  return { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [{ name: 'a', type: 'text', label: 'A' }], nodes: [node] }
}

const section = (doc: unknown, values: Record<string, unknown> = { a: 'visible' }): ManifestSection =>
  ({
    def: {
      section_def_id: 'd',
      version: 1,
      slug: 'd',
      definition_kind: 'structured',
      structured_doc: doc,
      structured_schema_version: STRUCTURED_SCHEMA_VERSION,
      compiled_ast: { nodes: [], policyVersion: 4, cssPolicyVersion: CSS_POLICY_VERSION },
      css: '',
      slots: [],
      render_hash: 'h',
      sanitizer_policy_version: 4,
      css_policy_version: CSS_POLICY_VERSION,
    },
    instance: { label: 'S', hidden: false, hidden_at: [], values },
  }) as unknown as ManifestSection

/** A node that is its own child, and a cycle two hops around. */
function selfCycle(): unknown {
  const node: Record<string, unknown> = { type: 'element', tag: 'div', children: [] }
  ;(node['children'] as unknown[]).push(node)
  return { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [], nodes: [node] }
}
function longCycle(): unknown {
  const outer: Record<string, unknown> = { type: 'element', tag: 'div', children: [] }
  ;(outer['children'] as unknown[]).push({ type: 'element', tag: 'span', children: [outer] })
  return { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [], nodes: [outer] }
}

/**
 * The same child object used twice as a sibling: a graph, not a loop.
 *
 * It terminates, so nothing crashes on it — which is exactly why it belongs
 * here. It is refused for being a thing no stored document can be, not for
 * being dangerous to read.
 */
function sharedChild(): unknown {
  const child = { type: 'text', field: 'a' }
  return {
    schemaVersion: STRUCTURED_SCHEMA_VERSION,
    fields: [{ name: 'a', type: 'text', label: 'A' }],
    nodes: [{ type: 'element', tag: 'div', children: [child, child] }],
  }
}

const leaf = () => ({ type: 'element', tag: 'span' })
const siblings = (count: number) => ({
  schemaVersion: STRUCTURED_SCHEMA_VERSION,
  fields: [],
  nodes: Array.from({ length: count }, leaf),
})
const children = (count: number) => ({
  schemaVersion: STRUCTURED_SCHEMA_VERSION,
  fields: [],
  nodes: [{ type: 'element', tag: 'div', children: Array.from({ length: count }, leaf) }],
})

/** Every document the renderer must refuse, by the name a failure should print. */
const REFUSED: [string, unknown][] = [
  ['seventeen levels, one past the limit', atDepth(17)],
  ['one hundred levels', atDepth(100)],
  ['one thousand levels', atDepth(1_000)],
  ['five thousand levels', atDepth(5_000)],
  ['fifty thousand levels', atDepth(50_000)],
  ['a node that is its own child', selfCycle()],
  ['a cycle two hops around', longCycle()],
  ['one node object used in two places', sharedChild()],
  ['two thousand and one sibling nodes', siblings(2_001)],
  ['five hundred and thirteen children on one element', children(513)],
  [
    'an attribute of fifty thousand characters',
    {
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      fields: [],
      nodes: [{ type: 'element', tag: 'div', attributes: { 'aria-label': 'x'.repeat(50_000) } }],
    },
  ],
  [
    'a field label of fifty thousand characters',
    {
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      nodes: [],
      fields: [{ name: 'a', type: 'text', label: 'L'.repeat(50_000) }],
    },
  ],
]

/** Documents at the boundary that must still render, so refusing everything is not a pass. */
const ACCEPTED: [string, unknown][] = [
  ['three levels', atDepth(3)],
  ['fifteen levels, one inside the limit', atDepth(15)],
  ['sixteen levels, exactly the limit', atDepth(16)],
]

test.describe('a structured document the renderer will not accept', () => {
  for (const [label, doc] of REFUSED) {
    test(`${label} renders nothing on the public path and does not throw`, () => {
      expect(() => renderSection(section(doc), 0)).not.toThrow()
      expect(renderSection(section(doc), 0)).toBe('')
    })

    test(`${label} renders nothing in preview either`, () => {
      // Preview is where a hostile document is most likely to be looked at, and
      // it runs the same checks before adding the editor's instrumentation. A
      // wrapper with no body would give the canvas a region to select that has
      // nothing in it.
      expect(() => renderSection(section(doc), 0, { preview: true })).not.toThrow()
      const html = renderSection(section(doc), 0, { preview: true })
      expect(html).toBe('')
      expect(html).not.toContain('data-cms-section')
    })
  }
})

test.describe('a structured document at the boundary still renders', () => {
  for (const [label, doc] of ACCEPTED) {
    test(`${label} renders its field on the public path`, () => {
      const html = renderSection(section(doc), 0)
      expect(html).toContain('visible')
      // Public output carries no editor instrumentation at all (SPEC §8).
      expect(html).not.toContain('data-cms-slot')
      expect(html).not.toContain('data-cms-section')
    })

    test(`${label} renders its field in preview, with the selection instrumentation`, () => {
      const html = renderSection(section(doc), 0, { preview: true })
      expect(html).toContain('visible')
      expect(html).toContain('data-cms-slot="a"')
    })
  }
})

test.describe('the page a hostile section is on', () => {
  const pageWith = (sections: ManifestSection[]) =>
    ({
      page: { id: 'p', version_id: 'v', title: 'Bounded', path: '/p' },
      meta: {},
      sections,
    }) as unknown as RenderManifest

  test('still renders, with the bad section simply absent', async ({ page: browserPage }) => {
    // The point of the test. A refused section must cost the page that section
    // and nothing else: the rest of the document, the shell, the other sections
    // all still arrive, because the alternative is one stored row deciding that
    // nobody sees anything.
    const manifest = pageWith([
      section(atDepth(5_000)),
      section(selfCycle(), {}),
      section(sharedChild(), {}),
      section(siblings(2_001), {}),
      section(atDepth(16), { a: 'the good one' }),
    ])

    let html = ''
    expect(() => {
      html = renderPage({ manifest, shell: SHELL, isStaging: false }).html
    }).not.toThrow()

    await browserPage.route('**', route => route.abort())
    await browserPage.setContent(html, { waitUntil: 'domcontentloaded' })

    expect(await browserPage.evaluate(() => document.body.textContent ?? '')).toContain('the good one')
    expect(await browserPage.evaluate(() => document.querySelectorAll('.cms-section').length)).toBe(1)
    expect(await browserPage.evaluate(() => document.querySelectorAll('script').length)).toBe(0)
    expect(await browserPage.evaluate(() => document.title)).toBe('Bounded')
  })

  test('still renders in preview, and the editor gets one selectable section', async ({ page: browserPage }) => {
    // The same page through the editor's path. A refused section must not leave
    // the canvas an empty region to bind a selection to, and the surviving
    // section must still be selectable — the two halves of "preview and public
    // differ only in instrumentation".
    const manifest = pageWith([
      section(atDepth(50_000)),
      section(longCycle(), {}),
      section(children(513), {}),
      section(atDepth(16), { a: 'the good one' }),
    ])

    let html = ''
    expect(() => {
      html = renderPage({ manifest, shell: SHELL, isStaging: false, options: { preview: true } }).html
    }).not.toThrow()

    await browserPage.route('**', route => route.abort())
    await browserPage.setContent(html, { waitUntil: 'domcontentloaded' })

    expect(await browserPage.evaluate(() => document.body.textContent ?? '')).toContain('the good one')
    expect(await browserPage.evaluate(() => document.querySelectorAll('[data-cms-section]').length)).toBe(1)
    expect(
      await browserPage.evaluate(() =>
        [...document.querySelectorAll('[data-cms-slot]')].map(el => el.getAttribute('data-cms-slot')),
      ),
    ).toEqual(['a'])
  })

  test('renders a page made only of refused sections as a page with no sections', async ({ page: browserPage }) => {
    const manifest = pageWith(REFUSED.map(([, doc]) => section(doc, {})))

    let html = ''
    expect(() => {
      html = renderPage({ manifest, shell: SHELL, isStaging: false }).html
    }).not.toThrow()

    await browserPage.route('**', route => route.abort())
    await browserPage.setContent(html, { waitUntil: 'domcontentloaded' })

    expect(await browserPage.evaluate(() => document.querySelectorAll('.cms-section').length)).toBe(0)
    expect(await browserPage.evaluate(() => document.title)).toBe('Bounded')
  })
})
