// Preview instrumentation must not move anything (SPEC §9), judged by Chromium.
//
// THE DEFECT. Both renderers wrap an editable region in
// `<cms-slot data-cms-slot=… data-cms-kind=…>` so the canvas has a node to select,
// outline and type into. This inert custom element defaults to an inline box. When a link field or an image
// field sits where the definition's own stylesheet has made a flex or grid
// container, the span became the flex or grid item and the `<a>` or `<img>` it
// wraps became an ordinary in-flow child of the span — so the rules written for
// the item applied to an element that was no longer the item, and the canvas
// laid the section out differently from the page that would be published from
// it. An author approves what the canvas shows them, which is what makes a
// preview-only layout difference worse than a difference on both sides.
//
// WHY THIS SPEC AND NOT A UNIT TEST. `packages/renderer/src/preview-layout.test.ts`
// holds the structure of the fix — which kinds are declared `display:contents`,
// and that every affordance is mirrored onto the child that now has to paint
// them. Neither of those is the claim. The claim is that two documents lay out
// identically, and only a layout engine can say whether they do; a unit test
// asserting on the CSS is a test of what somebody meant, and this is a test of
// what happens. So the same page is rendered twice by the same renderer, once
// with `{ preview: true }` and once without, both go into Chromium, and the
// rectangles of the `<a>` and the `<img>` are compared.
//
// WHAT IT DELIBERATELY DOES NOT COVER. `display:contents` changes box
// generation, not selector matching. A definition whose stylesheet reaches its
// link through a child combinator — `.row > a` — still matches in public output
// and still does not match in preview, because in preview the `<a>` is the
// span's child rather than the row's. That is a fact about the markup shape and
// no stylesheet can answer it; the fixtures below use descendant selectors so
// the one thing under test is box generation. The limitation is written down
// here rather than left for whoever next finds a section that lays out oddly.
import { expect, test, type Page } from '@playwright/test'
import { STRUCTURED_SCHEMA_VERSION } from '@cms/schema'
import {
  CSS_POLICY_VERSION,
  SANITIZER_POLICY_VERSION,
  compileSection,
  compileStructuredSection,
  renderPage,
  type ManifestSection,
  type RenderManifest,
  type SiteShell,
} from '@cms/renderer'

const SHELL: SiteShell = {
  site: { id: 's1', name: 'Site', slug: 'site' },
  theme: {},
  navigation: [],
  canonical_host: null,
  staging_host: null,
}

/**
 * A section holding one link field and one image field side by side, laid out by
 * whichever container `layout` asks for.
 *
 * Those two fields are the whole point: their rendered form is a single element,
 * so they are the two kinds whose wrapper had to stop generating a box. The
 * width rules are what make a wrapper box *measurable* rather than merely
 * present. `flex:1` and a `1fr` track size the item and nothing else, so if the
 * wrapper is the item then the `<a>` inside it is only as wide as its own text,
 * and `align-self` positions the item and nothing else, so the `<img>` never
 * leaves the cross-axis centre. Both diverge by tens or hundreds of pixels
 * rather than by a rounding error, which is the difference between a test that
 * fails and a test that flakes.
 */
function laidOut(slug: string, layout: string): ManifestSection {
  const document = {
    schemaVersion: STRUCTURED_SCHEMA_VERSION,
    fields: [
      { name: 'cta', type: 'link', label: 'Call to action' },
      { name: 'portrait', type: 'image', label: 'Portrait' },
    ],
    nodes: [
      {
        type: 'element',
        tag: 'div',
        attributes: { class: 'row' },
        children: [
          { type: 'link', field: 'cta' },
          { type: 'image', field: 'portrait' },
        ],
      },
    ],
  }

  // Descendant selectors, for the reason given in the file header: a child
  // combinator would be asking a different question, and would answer it the
  // same way whether or not the wrapper generates a box.
  const compiled = compileStructuredSection({
    slug,
    document,
    sourceCss:
      `.row{${layout};gap:24px;align-items:center;justify-content:space-between;width:600px;height:120px}` +
      '.row a{flex:1 1 auto;background:rgb(220,228,240);font-size:16px;line-height:1.5;font-family:monospace}' +
      '.row img{width:48px;height:48px;align-self:flex-start}',
  })
  // Thrown rather than asserted because this runs while the file is being
  // imported, where a failed expectation is reported as a spec that would not
  // load and never says which definition the compiler refused.
  if (compiled.blocking.length > 0) {
    throw new Error(
      `the ${slug} fixture is not a definition this repository would store: ` + compiled.blocking.join('; '),
    )
  }

  return {
    def: {
      section_def_id: slug,
      version: 1,
      slug,
      definition_kind: 'structured',
      structured_doc: compiled.document,
      structured_schema_version: STRUCTURED_SCHEMA_VERSION,
      compiled_ast: { nodes: [], policyVersion: SANITIZER_POLICY_VERSION, cssPolicyVersion: CSS_POLICY_VERSION },
      css: compiled.css,
      slots: [],
      render_hash: compiled.renderHash,
      sanitizer_policy_version: SANITIZER_POLICY_VERSION,
      css_policy_version: CSS_POLICY_VERSION,
    },
    instance: {
      label: slug,
      hidden: false,
      hidden_at: [],
      values: {
        cta: { url: `/${slug}-link`, label: 'Read the whole thing' },
        portrait: { src: `/${slug}.png`, alt: 'A photograph' },
      },
    },
  } as unknown as ManifestSection
}

// Both container models, because the wrapper displaced the item in both and a
// fix that only answered for flex would leave half the defect on the page.
const SECTIONS = [laidOut('flexrow', 'display:flex'), laidOut('gridrow', 'display:grid;grid-template-columns:1fr 48px')]

const MANIFEST: RenderManifest = {
  page: { id: 'p1', version_id: 'v1', title: 'Layout', path: '/' },
  meta: { description: 'Two sections whose fields are container items.' },
  sections: SECTIONS,
}

/** The same page, from the same renderer, with and without the canvas instrumentation. */
const PREVIEW = renderPage({ manifest: MANIFEST, shell: SHELL, isStaging: false, options: { preview: true } }).html
const PUBLIC = renderPage({ manifest: MANIFEST, shell: SHELL, isStaging: false }).html

/** Every element the two documents have to agree about the position of. */
const MEASURED = [
  'a[href="/flexrow-link"]',
  'img[src="/flexrow.png"]',
  'a[href="/gridrow-link"]',
  'img[src="/gridrow.png"]',
] as const

type Rect = { x: number; y: number; width: number; height: number }

/**
 * Load a document and measure it.
 *
 * Nothing is allowed off the page. The images were never going to load from the
 * `about:blank` base `setContent` leaves behind, and a request that half
 * succeeded would make a layout assertion depend on the network; aborting makes
 * both documents broken in exactly the same way, and the stylesheet gives the
 * `<img>` an explicit box in either case.
 */
async function measure(page: Page, html: string): Promise<Record<string, Rect>> {
  await page.route('**', (route, request) => {
    const url = request.url()
    return url.startsWith('about:') || url.startsWith('data:') ? route.continue() : route.abort()
  })
  await page.setContent(html, { waitUntil: 'load' })

  const measured = await page.evaluate(
    selectors => {
      const out: Record<string, { x: number; y: number; width: number; height: number }> = {}
      for (const selector of selectors) {
        // Scoped to `<main>`: the page shell ships a skip link and a nav, and an
        // unscoped `a` would sometimes measure those instead.
        const element = document.querySelector(`main ${selector}`)
        if (element === null) throw new Error(`no element for ${selector}`)
        const { x, y, width, height } = element.getBoundingClientRect()
        out[selector] = { x, y, width, height }
      }
      return out
    },
    [...MEASURED],
  )

  await page.unrouteAll({ behavior: 'ignoreErrors' })
  return measured
}

test.describe('a link field and an image field that are container items', () => {
  test('phone stacking reverses two columns while preserving desktop positions', async ({ page }) => {
    const compiled = compileStructuredSection({
      slug: 'phone-columns',
      sourceCss:
        '.builder-columns{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:767px){.builder-columns{grid-template-columns:1fr}}',
      document: {
        schemaVersion: 3,
        fields: [
          { name: 'left', type: 'text', label: 'Left' },
          { name: 'right', type: 'text', label: 'Right' },
        ],
        nodes: [
          {
            type: 'element',
            tag: 'section',
            children: [
              {
                type: 'element',
                tag: 'div',
                attributes: { class: 'builder-columns' },
                children: [
                  { type: 'element', tag: 'div', children: [{ type: 'text', field: 'left' }] },
                  { type: 'element', tag: 'div', children: [{ type: 'text', field: 'right' }] },
                ],
              },
            ],
          },
        ],
      },
    })
    const section: ManifestSection = {
      def: {
        section_def_id: 'columns',
        version: 1,
        slug: 'phone-columns',
        definition_kind: 'structured',
        structured_doc: compiled.document,
        structured_schema_version: 3,
        compiled_ast: { nodes: [], policyVersion: 4, cssPolicyVersion: 6 },
        css: compiled.css,
        css_policy_version: 6,
        sanitizer_policy_version: 4,
        slots: [],
      },
      instance: {
        section_def_id: 'columns',
        section_def_version: 1,
        values: { left: 'First column', right: 'Second column' },
        appearance: { mobileOrder: 'reverse' },
      },
    }
    for (const preview of [false, true]) {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.setContent(
        renderPage({
          manifest: { ...MANIFEST, sections: [section] },
          shell: SHELL,
          isStaging: false,
          options: { preview },
        }).html,
      )
      const columns = page.locator('.builder-columns>div')
      const desktop = await columns.evaluateAll(es =>
        es.map(e => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y })),
      )
      expect(desktop[0]!.y).toBe(desktop[1]!.y)
      expect(desktop[0]!.x).toBeLessThan(desktop[1]!.x)
      await page.setViewportSize({ width: 390, height: 800 })
      const mobile = await columns.evaluateAll(es => es.map(e => e.getBoundingClientRect().y))
      expect(mobile[1]!).toBeLessThan(mobile[0]!)
    }
  })
  test('preserved image and link elements keep their boxes when made editable', async ({ page }) => {
    const compiled = compileSection({
      sourceHtml: '<div class="row"><img src="{{portrait}}" alt="{{portrait}}"><a href="{{cta}}">Read more</a></div>',
      sourceCss: '.row img{display:block;width:120px;height:80px}',
      scopeSelector: '.cms-section--preserved',
      slots: [
        { id: 'portrait', kind: 'image', label: 'Portrait', constraints: {} },
        { id: 'cta', kind: 'link', label: 'Destination', constraints: {} },
      ],
    })
    const manifest: RenderManifest = {
      ...MANIFEST,
      sections: [
        {
          def: {
            section_def_id: 'preserved',
            version: 1,
            slug: 'preserved',
            compiled_ast: compiled.ast,
            css: compiled.css,
            css_policy_version: compiled.ast.cssPolicyVersion,
            sanitizer_policy_version: compiled.ast.policyVersion,
            slots: [],
          },
          instance: {
            section_def_id: 'preserved',
            section_def_version: 1,
            values: { portrait: { src: '/portrait.png', alt: 'Portrait' }, cta: { url: '/read' } },
          },
        },
      ],
    }
    const rectangles = []
    for (const preview of [false, true]) {
      await page.setContent(renderPage({ manifest, shell: SHELL, isStaging: false, options: { preview } }).html)
      rectangles.push(
        await page.locator('main img, main a').evaluateAll(elements =>
          elements.map(element => {
            const rect = element.getBoundingClientRect()
            return { width: rect.width, height: rect.height, display: getComputedStyle(element).display }
          }),
        ),
      )
    }
    expect(rectangles[1]).toEqual(rectangles[0])
    expect(rectangles[1]![0]!.width).toBe(120)
    expect(rectangles[1]![0]!.height).toBe(80)
  })
  test('the fixture really is two different documents', () => {
    // Without this the comparison below could pass by measuring the same page
    // twice, which is how this kind of proof usually stops proving anything.
    expect(PREVIEW).toContain('<cms-slot data-cms-slot="cta" data-cms-kind="link">')
    expect(PREVIEW).toContain('<cms-slot data-cms-slot="portrait" data-cms-kind="image">')
    expect(PUBLIC).not.toContain('data-cms-slot')
    expect(PUBLIC).not.toContain('<script')
  })

  test('the wrapper is still in the preview markup and still generates no box', async ({ page }) => {
    // `stripPreviewInstrumentation` and the preview/public parity tests both
    // recognize the custom wrapper; the browser must still give it no box.
    // Saying so here
    // means a regression in either half fails somewhere legible instead of
    // showing up as four rectangles that no longer agree.
    await page.setContent(PREVIEW, { waitUntil: 'load' })
    const displays = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main [data-cms-slot]')).map(
        node => `${node.getAttribute('data-cms-kind')}:${getComputedStyle(node).display}`,
      ),
    )
    expect(displays).toEqual(['link:contents', 'image:contents', 'link:contents', 'image:contents'])
  })

  test('lay out identically whether or not the canvas is instrumented', async ({ page }) => {
    const preview = await measure(page, PREVIEW)
    const published = await measure(page, PUBLIC)

    // Every rectangle in one assertion rather than one assertion each: a failure
    // should show the whole shape of the divergence, because "the link is 140px
    // wide instead of 528px" and "the image is 36px lower than it should be" are
    // one defect, and reading them one at a time invites fixing half of it.
    expect(preview).toEqual(published)
  })

  test('and the measurement is capable of failing', async ({ page }) => {
    // The rectangles above agree; this is what says they agree on the right
    // answer. `flex:1 1 auto` fills the row when it lands on a real flex item
    // and does nothing at all when it lands on an inline child of a block, and
    // `align-self:flex-start` lifts a real item out of the centre and is ignored
    // otherwise. A link only as wide as its own text, or an image sitting at the
    // vertical centre, would mean the wrapper had taken the item's place —
    // exactly the state this file exists to keep the canvas out of.
    const preview = await measure(page, PREVIEW)
    for (const slug of ['flexrow', 'gridrow']) {
      const link = preview[`a[href="/${slug}-link"]`]!
      const image = preview[`img[src="/${slug}.png"]`]!
      expect(link.width, `${slug} link fills its track`).toBeGreaterThan(400)
      expect(image.y, `${slug} image is aligned to the top of the row`).toBeLessThan(link.y - 20)
    }
  })
})
