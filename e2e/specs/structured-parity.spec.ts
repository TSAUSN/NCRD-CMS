// The three definitions schema v2 newly converted, judged by Chromium.
//
// `packages/importer/src/parity.test.ts` establishes that the markup the
// structured renderer produces is the markup V1 ships, node for node. That is a
// comparison between two trees, and a tree is not a page: it says nothing about
// whether the stylesheet that came across with the definition actually matches
// the elements it was written for, whether the two lay out the same at a phone
// width, or whether an image reserves the box V1 reserved for it. Those are
// questions only a browser answers, and this file asks them.
//
// WHAT COUNTS AS "WHAT V1 WOULD RENDER"
//
// A V1 page builds a section by stamping the definition's template markup into
// its mount, applying the instance's saved content and its settings — both
// no-ops for a section straight out of the library, because every settings
// branch clears rather than sets and a region with no stored value keeps what
// the template shipped — and injecting two page-level stylesheets. So the V1
// side below is the template markup, the definition's own authored stylesheet,
// and INTERACTION_PRESET_CSS read out of the V1 checkout at run time.
//
// Nothing here executes a line of V1's JavaScript, and that is a limit rather
// than a convenience. V1's renderer stamps `.fx-*` classes onto every `.cms-cta`
// in a section that carries an interaction preset, and those classes are defined
// in the page-level sheet; a definition whose rendering depends on that cannot
// be compared against anything this repository holds, and the inventory counts
// 62 of them. `presetStylesheetHooks` decides whether a definition is in that
// position, and the first suite below turns "the page-level sheet is inert for
// these three" from a reading of V1's source into a measurement.
//
// The V2 side is the imported document, the compiled stylesheet the importer
// produced from the same source, and `renderSection` — the function that puts
// sections on the public site — rather than a copy of its behaviour.
//
// SCREENSHOTS ARE DIAGNOSTICS, NOT FIXTURES
//
// Both renderings are captured at both viewports and compared to each other in
// the same run. Nothing is compared against a committed image: a golden of a V1
// rendering would be licensed layout and licensed copy checked into this
// repository, which is not something a convenience in a test framework makes
// acceptable. The captures land in `e2e/parity-artifacts/`, which `e2e/.gitignore`
// keeps out of every commit, and they exist for a person reading a failure.
//
// NOTHING MAY REACH THE NETWORK
//
// Both documents are served from an intercepted origin that resolves nowhere, so
// a site-relative URL in V1's markup resolves the way it would on a real page and
// is still answered locally. Every request is either fulfilled from bytes this
// file owns — the document, and a one-pixel PNG standing in for an image asset,
// so no V1 photograph is ever fetched or captured — or aborted and recorded as a
// failure. Console errors, uncaught errors, dialogs, script elements and inline
// handlers are recorded on every load and asserted empty.
import { expect, test, type Browser, type Page } from '@playwright/test'
import { STRUCTURED_SCHEMA_VERSION } from '@cms/schema'
import {
  CSS_POLICY_VERSION,
  SANITIZER_POLICY_VERSION,
  collectCss,
  renderSection,
  renderStructuredBody,
  stripPreviewInstrumentation,
  type ManifestSection,
  type SectionDefView,
} from '@cms/renderer'
// Reached by path rather than by package name: `e2e` does not depend on the
// importer, and one module of comparison logic is not a reason to widen what
// this package installs.
import {
  compareRenderings,
  decideV1Source,
  describeDifferences,
  partitionDifferences,
  presetStylesheetHooks,
  probeV1Root,
  v1DefaultValues,
} from '../../packages/importer/src/parity.ts'
import { classesInStylesheet } from '../../packages/importer/src/presets.ts'
import { presetClassNames, readV1Catalogue, V1_INPUTS, type V1Definition } from '../../packages/importer/src/source.ts'
import { runImport, type ImportRecord } from '../../packages/importer/src/run.ts'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
/** Where the captured renderings go. Ignored by git — see the note above. */
const ARTIFACTS = path.join(REPO_ROOT, 'e2e', 'parity-artifacts')

/**
 * The origin both documents are served from.
 *
 * `.invalid` is reserved by RFC 2606 and resolves nowhere, so a route that
 * failed to intercept would fail loudly rather than reaching a real host. Having
 * a real origin at all is what makes V1's site-relative `src` and `href` resolve
 * the way they resolve on a live page instead of resolving to nothing at all,
 * which is what happens to a relative URL in a document with no base.
 */
const ORIGIN = 'http://section.invalid'

const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
} as const

/** A 1×1 transparent PNG, standing in for every image an imported definition names. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/** The empty compiled template every structured row stores (migration 0019). */
const NO_TEMPLATE = { nodes: [], policyVersion: SANITIZER_POLICY_VERSION, cssPolicyVersion: CSS_POLICY_VERSION }

/**
 * The definitions two governed changes unblocked, and which this file measures
 * in a browser.
 *
 * Named rather than derived from the run, because the point of this file is to
 * say something about these in particular, and a list computed from the importer
 * would quietly start testing something else the day the importer changes its
 * mind about what converts.
 *
 * `cta-band-v1` and `hero-centered-v1` came from schema v2's governed static
 * attributes; the five dividers from consuming `data-cms-section`, which is V1
 * authoring metadata v2 re-derives (ADR 0009).
 *
 * `hni-hero-v1` was here and is deliberately gone. This file is why: its
 * subtitle region is declared `text` and V1's markup puts a `<br>` and an `<em>`
 * inside it, a text field renders an escaped string, and Chromium found thirteen
 * elements against V1's fifteen. The converter now refuses that shape outright
 * (`text-region-markup`), so there is no longer a document to render — which is
 * the outcome this measurement existed to force, asserted below as a refusal.
 */
const NEWLY_AUTOMATIC = [
  'cta-band-v1',
  'hero-centered-v1',
  'hni-home-divider-1-v1',
  'hni-home-divider-2-v1',
  'hni-home-divider-3-v1',
  'hni-resources-divider-1-v1',
  'hni-resources-divider-2-v1',
] as const

/** Everything the importer converts today, so the sweep at the end has an expectation.
 * campaign-progress-v1 and financial-transparency-v1 joined on October 5, when a
 * comment inside a CSS rule stopped counting as a dropped rule. */
const EVERY_FAITHFUL_DEFINITION = [
  'article-body-v1',
  'campaign-progress-v1',
  'cta-band-v1',
  'divider-v1',
  'financial-transparency-v1',
  'hero-centered-v1',
  'hni-home-divider-1-v1',
  'hni-home-divider-2-v1',
  'hni-home-divider-3-v1',
  'hni-resources-divider-1-v1',
  'hni-resources-divider-2-v1',
  'quote-v1',
  'spacer-v1',
  'urgent-appeal-v1',
]

/**
 * Converted, at markup parity, and impossible to photograph.
 *
 * The five dividers render `<div class="section-divider"><span
 * class="section-divider-dot"></span></div>` and compile to an *empty*
 * stylesheet: everything that gives that markup a size lives in a page-level
 * sheet this repository does not carry. Both renderings are therefore correctly
 * zero pixels tall, and there is no picture of either to compare. Named here
 * rather than skipped, so a divider that started rendering a box would fail the
 * sweep instead of quietly leaving the list.
 */
const NOT_PIXEL_COMPARABLE = [
  'hni-home-divider-1-v1',
  'hni-home-divider-2-v1',
  'hni-home-divider-3-v1',
  'hni-resources-divider-1-v1',
  'hni-resources-divider-2-v1',
]

/**
 * The subset a browser can be asked about, and why it is a subset.
 *
 * The per-definition suites screenshot each definition and compare the two
 * renderings pixel for pixel, and they read a link or image field node's
 * declared class list off the page. The five dividers can support neither: they
 * declare no fields at all, and they have no box. They are not skipped — the
 * suite named for them asserts exactly what is true of them, including the
 * zero-height fact that disqualifies them here.
 */
const MEASURED_IN_A_BROWSER = ['cta-band-v1', 'hero-centered-v1'] as const

// ------------------------------------------------------------------ the gate

const source = decideV1Source(process.env['V1_ROOT'], probeV1Root)
const withCatalogue = source.kind === 'run' ? test.describe : test.describe.skip

/** A suite that is not running says why in its own name. */
function about(name: string): string {
  return source.kind === 'run' ? name : `${name} [skipped: ${source.why}]`
}

if (source.kind === 'fail') {
  const { why } = source
  test.describe('the V1 checkout that V1_ROOT names', () => {
    test('holds the generated catalogue this parity spec reads', () => {
      // Deliberately a failure and not a skip: a skip is indistinguishable from
      // a pass in a summary line, which is how a CI job goes green having
      // rendered nothing at all.
      throw new Error(
        `${why}. Point V1_ROOT at a V1 checkout, or set V1_ROOT to an empty ` +
          'value to skip this suite and run the rest of the e2e run.',
      )
    })
  })
}

type Catalogue = {
  v1Root: string
  records: Map<string, ImportRecord>
  definitions: Map<string, V1Definition>
  presetClasses: string[]
  /** V1's page-level stylesheet, as V1 injects it, read at run time. */
  presetCss: string
}

let memo: Catalogue | undefined

/**
 * The catalogue, read the first time a test asks for it.
 *
 * Lazy because a `test.describe.skip` body still runs during collection, so a
 * describe that read V1 would read it on every machine that has none — the same
 * discipline `catalogue.test.ts` sets out at length for vitest.
 */
function catalogue(): Catalogue {
  if (source.kind !== 'run') {
    throw new Error(`a test asked to read the V1 catalogue where there is none: ${source.why}`)
  }
  const v1Root = source.v1Root
  memo ??= (() => {
    const read = readV1Catalogue({ v1Root, repoRoot: REPO_ROOT }, classesInStylesheet)
    return {
      v1Root,
      records: new Map(
        runImport({ v1Root, repoRoot: REPO_ROOT }).records.map(record => [record.provenance.id, record]),
      ),
      definitions: new Map(read.definitions.map(definition => [definition.id, definition])),
      presetClasses: read.presetClasses,
      presetCss: interactionPresetCss(path.join(v1Root, V1_INPUTS.presets)),
    }
  })()
  return memo
}

/**
 * V1's page-level stylesheet, sliced out of the module that exports it.
 *
 * The same marker and the same template literal `presetClassNames` reads, but
 * the text rather than the class names — that function answers "which classes
 * does this sheet define", and what is wanted here is the sheet. The two are
 * held against each other in the first test below, so a slice that had drifted
 * could not quietly give every comparison a stylesheet nobody checked.
 */
function interactionPresetCss(file: string): string {
  const module = readFileSync(file, 'utf8')
  const marker = 'export const INTERACTION_PRESET_CSS = `'
  const at = module.indexOf(marker)
  if (at === -1) throw new Error(`${file} does not export INTERACTION_PRESET_CSS`)
  const from = at + marker.length
  const to = module.indexOf('`', from)
  if (to === -1) throw new Error('INTERACTION_PRESET_CSS is never closed')
  return module.slice(from, to)
}

// ------------------------------------------------------------- the two pages

type Rendering = { css: string; body: string }

/**
 * The one thing both documents are given that neither definition asked for.
 *
 * Identical on both sides and as small as it can be: anything asymmetric here
 * would become part of the difference being measured. The body margin goes
 * because an element capture is taken against the viewport, and a default eight
 * pixels would move one side and not the other the moment their box trees differ
 * at all.
 */
const RESET = 'body{margin:0;background:#fff}'

/** V1's rendering: the template markup under the stylesheets a V1 page carries. */
function v1Rendering(definition: V1Definition, options: { pageStylesheet?: boolean } = {}): Rendering {
  return {
    // render-sections.js injects the shared sheet before per-template sheets.
    css: `${RESET}${options.pageStylesheet === false ? '' : catalogue().presetCss}${definition.css}`,
    body: definition.html,
  }
}

/** V2's rendering: the imported document, through the function the public site uses. */
function v2Rendering(record: ImportRecord, options: { preview?: boolean } = {}): Rendering {
  const built = sectionOf(record)
  return {
    css: `${RESET}${collectCss([built])}`,
    body: renderSection(built, 0, options.preview === true ? { preview: true } : {}),
  }
}

/** The imported definition and the content V1's own template carries, as one section. */
function sectionOf(record: ImportRecord): ManifestSection {
  const definition = catalogue().definitions.get(record.provenance.id)!
  const extracted = v1DefaultValues(definition.html, definition.slots)
  expect(extracted.problems, `${record.provenance.id}: V1's own default content must be readable`).toEqual([])
  // A converted definition always has one. Refusing rather than falling back to
  // no stylesheet at all, because a section rendered without its CSS looks
  // nothing like V1's and would fail every comparison here for the wrong reason.
  const compiledCss = record.conversion.compiledCss
  if (compiledCss === null) throw new Error(`${record.provenance.id} has no compiled stylesheet to render with`)
  const def: SectionDefView = {
    section_def_id: record.provenance.id,
    version: 1,
    // The definition's own id, because the stylesheet the importer compiled is
    // scoped to the selector this slug derives; a different slug would put the
    // section outside the reach of its own stylesheet.
    slug: record.provenance.id,
    compiled_ast: NO_TEMPLATE,
    definition_kind: 'structured',
    structured_doc: record.conversion.document,
    structured_schema_version: STRUCTURED_SCHEMA_VERSION,
    // The importer's own artifact rather than a recompilation, so the browser is
    // shown what would have been stored.
    css: compiledCss,
    css_policy_version: CSS_POLICY_VERSION,
  }
  return {
    def,
    instance: {
      section_def_id: record.provenance.id,
      section_def_version: 1,
      values: extracted.values,
    },
  } as ManifestSection
}

function documentFor(rendering: Rendering): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<style>${rendering.css}</style></head><body>${rendering.body}</body></html>`
  )
}

// ---------------------------------------------------------------- monitoring

type Observed = {
  /** Requests answered from this file's own bytes. Never from a network. */
  served: string[]
  /** Anything that tried to leave. Always empty, or the test has failed. */
  external: string[]
  consoleErrors: string[]
  pageErrors: string[]
  dialogs: string[]
  scripts: number
  eventHandlers: string[]
}

/**
 * Load one rendering and watch everything it does.
 *
 * The observers go on before the navigation rather than after, because a
 * document that fetched something while parsing would otherwise be watched from
 * just after the moment worth watching.
 */
async function render(page: Page, rendering: Rendering, viewport: keyof typeof VIEWPORTS): Promise<Observed> {
  const observed: Observed = {
    served: [],
    external: [],
    consoleErrors: [],
    pageErrors: [],
    dialogs: [],
    scripts: 0,
    eventHandlers: [],
  }
  const html = documentFor(rendering)

  page.on('console', message => {
    if (message.type() === 'error') observed.consoleErrors.push(message.text())
  })
  page.on('pageerror', error => observed.pageErrors.push(error.message))
  page.on('dialog', dialog => {
    observed.dialogs.push(dialog.message())
    void dialog.dismiss()
  })

  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== ORIGIN) {
      // Aborted rather than merely recorded, so an unreachable host can never
      // turn "this page reached the network" into a timeout instead of a
      // failure.
      observed.external.push(url.href)
      await route.abort()
      return
    }
    observed.served.push(url.pathname)
    if (url.pathname === '/section') {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
      return
    }
    if (/\.(png|jpe?g|webp|avif|gif|svg)$/i.test(url.pathname)) {
      // A pixel of this file's own making. The definition's `src` still has to
      // be the URL V1 wrote — that is one of the things being compared — but no
      // V1 photograph is fetched, and none ends up in a capture.
      await route.fulfill({ contentType: 'image/png', body: ONE_PIXEL_PNG })
      return
    }
    await route.fulfill({ status: 404, contentType: 'text/plain', body: '' })
  })

  await page.setViewportSize(VIEWPORTS[viewport])
  await page.goto(`${ORIGIN}/section`, { waitUntil: 'load' })

  const found = await page.evaluate(() => {
    const handlers: string[] = []
    for (const element of Array.from(document.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.toLowerCase().startsWith('on')) {
          handlers.push(`${element.tagName.toLowerCase()}@${attribute.name}`)
        }
      }
    }
    return { scripts: document.querySelectorAll('script').length, handlers }
  })
  observed.scripts = found.scripts
  observed.eventHandlers = found.handlers
  return observed
}

/** Undo one page's interception so the same page can be used for the other side. */
async function finish(page: Page): Promise<void> {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  page.removeAllListeners('console')
  page.removeAllListeners('pageerror')
  page.removeAllListeners('dialog')
}

/** Everything a rendering is allowed to have done, asserted in one place. */
function expectQuiet(observed: Observed, label: string): void {
  expect(observed.external, `${label}: requests that tried to leave the machine`).toEqual([])
  expect(observed.consoleErrors, `${label}: console errors`).toEqual([])
  expect(observed.pageErrors, `${label}: uncaught page errors`).toEqual([])
  expect(observed.dialogs, `${label}: dialogs`).toEqual([])
  expect(observed.scripts, `${label}: script elements`).toBe(0)
  expect(observed.eventHandlers, `${label}: inline event handlers`).toEqual([])
}

// ----------------------------------------------------- reading a rendered page

/** The properties a stylesheet that failed to apply would show up in. */
const WATCHED_PROPERTIES = [
  'display',
  'position',
  'visibility',
  'opacity',
  'overflow-x',
  'overflow-y',
  'width',
  'height',
  'max-width',
  'min-height',
  'box-sizing',
  'aspect-ratio',
  'object-fit',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-bottom-width',
  'border-top-left-radius',
  'color',
  'background-color',
  'background-image',
  'box-shadow',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration-line',
  'white-space',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'grid-template-columns',
  'transform',
]

type RenderedElement = {
  tag: string
  classes: string[]
  /** Position and size relative to the section root, so the page's own offset drops out. */
  box: { x: number; y: number; width: number; height: number }
  styles: Record<string, string>
  /** What a reader sees, which is the only property here a stylesheet cannot fake. */
  text: string
}

type ReadOptions = {
  /** A selector for elements to step over — the editor's own wrappers, and only those. */
  skip?: string
}

/**
 * Every element of the rendered section, in document order, with the box and the
 * computed styles it ended up with.
 *
 * `root` differs between the two sides on purpose: V1 stamps the definition's
 * own outermost element straight onto the page, and V2 wraps it in the instance
 * envelope `renderSection` puts around every section — the same job V1 does by
 * stamping `data-section-id` onto the element itself. Reading from the
 * definition's own root down is what makes the two lists about the same thing.
 */
function readRendering(page: Page, root: string, options: ReadOptions = {}): Promise<RenderedElement[]> {
  return page.evaluate(
    input => {
      const start = document.querySelector(input.root)
      if (start === null) throw new Error(`nothing matched ${input.root}`)
      const origin = start.getBoundingClientRect()
      const round = (value: number): number => Math.round(value * 100) / 100
      const out: {
        tag: string
        classes: string[]
        box: { x: number; y: number; width: number; height: number }
        styles: Record<string, string>
        text: string
      }[] = []
      const walk = (element: Element): void => {
        // Stepped over rather than removed: the children still take part, which is
        // the whole question when the thing being stepped over is a wrapper.
        if (input.skip === undefined || !element.matches(input.skip)) {
          const rect = element.getBoundingClientRect()
          const computed = getComputedStyle(element)
          const styles: Record<string, string> = {}
          for (const property of input.properties) styles[property] = computed.getPropertyValue(property)
          out.push({
            tag: element.tagName.toLowerCase(),
            classes: Array.from(element.classList),
            box: {
              x: round(rect.x - origin.x),
              y: round(rect.y - origin.y),
              width: round(rect.width),
              height: round(rect.height),
            },
            styles,
            text: (element as HTMLElement).innerText,
          })
        }
        for (const child of Array.from(element.children)) walk(child)
      }
      walk(start)
      return out
    },
    { root, properties: WATCHED_PROPERTIES, skip: options.skip },
  )
}

type RenderingDifference = {
  /** Position in document order, which is the only identity both sides share. */
  index: number
  tag: string
  /** What differs: a box side, a computed property, `tag`, `classes`, `text`, or the count. */
  property: string
  first: string
  second: string
}

/**
 * How two readings of the same section differ.
 *
 * Structured rather than formatted, because two callers need to *classify* the
 * differences rather than only print them — a preview page legitimately
 * blockifies one property and must not be allowed to quietly differ in any
 * other, and a formatted line cannot be filtered without a regular expression
 * that would eventually match more than it meant to.
 */
function renderingDifferences(v1: RenderedElement[], v2: RenderedElement[]): RenderingDifference[] {
  const problems: RenderingDifference[] = []
  const note = (index: number, tag: string, property: string, first: unknown, second: unknown): void => {
    problems.push({ index, tag, property, first: String(first), second: String(second) })
  }
  if (v1.length !== v2.length) {
    note(
      -1,
      '',
      'element count',
      `${v1.length} (${v1.map(element => element.tag).join(' ')})`,
      `${v2.length} (${v2.map(element => element.tag).join(' ')})`,
    )
  }
  for (let index = 0; index < Math.min(v1.length, v2.length); index += 1) {
    const left = v1[index]!
    const right = v2[index]!
    if (left.tag !== right.tag) {
      note(index, left.tag, 'tag', left.tag, right.tag)
      continue
    }
    if (left.classes.join(' ') !== right.classes.join(' ')) {
      note(index, left.tag, 'classes', left.classes.join(' '), right.classes.join(' '))
    }
    for (const side of ['x', 'y', 'width', 'height'] as const) {
      if (left.box[side] !== right.box[side]) note(index, left.tag, side, left.box[side], right.box[side])
    }
    if (left.text !== right.text) {
      // The text a reader sees, said by length rather than quoted: a page's copy
      // does not leave the machine it is measured on.
      note(index, left.tag, 'text', `${left.text.length} characters`, `${right.text.length} characters`)
    }
    for (const [property, value] of Object.entries(left.styles)) {
      if (right.styles[property] !== value) note(index, left.tag, property, value, right.styles[property])
    }
  }
  return problems
}

/** A difference list as lines somebody can act on. */
function describeRenderingDifferences(differences: readonly RenderingDifference[]): string {
  return differences
    .map(
      difference =>
        `element ${difference.index} <${difference.tag}> ${difference.property}: ` +
        `${difference.first} against ${difference.second}`,
    )
    .join('\n')
}

// ------------------------------------------------------------- the pixel diff

type PixelComparison = { equal: boolean; detail: string }

/**
 * Two captures, compared pixel by pixel in a page of their own.
 *
 * Byte equality is checked first because it is the honest answer when it holds —
 * two identical renderings produce identical PNGs — and the decode only runs
 * when it does not, to turn "these files differ" into "they differ in 412
 * pixels, the worst by 37 of 255", which is the difference between a failure
 * somebody can act on and one they can only look at.
 *
 * The comparison runs on a page with no interception attached and both images
 * arrive as `data:` URLs, so the diagnosis reaches the network no more than the
 * renderings did.
 */
async function comparePixels(browser: Browser, a: Buffer, b: Buffer): Promise<PixelComparison> {
  if (a.equals(b)) return { equal: true, detail: 'byte-identical captures' }
  const page = await browser.newPage()
  try {
    const found = await page.evaluate(
      async input => {
        const load = (data: string): Promise<HTMLImageElement> =>
          new Promise((resolve, reject) => {
            const image = new Image()
            image.onload = () => {
              resolve(image)
            }
            image.onerror = () => {
              reject(new Error('a capture could not be decoded'))
            }
            image.src = data
          })
        const [left, right] = await Promise.all([load(input.a), load(input.b)])
        if (left.width !== right.width || left.height !== right.height) {
          return {
            differing: -1,
            worst: -1,
            size: `${left.width}×${left.height} against ${right.width}×${right.height}`,
          }
        }
        const pixelsOf = (image: HTMLImageElement): Uint8ClampedArray => {
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext('2d')!
          context.drawImage(image, 0, 0)
          return context.getImageData(0, 0, canvas.width, canvas.height).data
        }
        const one = pixelsOf(left)
        const other = pixelsOf(right)
        let differing = 0
        let worst = 0
        for (let at = 0; at < one.length; at += 4) {
          let delta = 0
          for (let channel = 0; channel < 4; channel += 1) {
            delta = Math.max(delta, Math.abs(one[at + channel]! - other[at + channel]!))
          }
          if (delta > 0) {
            differing += 1
            worst = Math.max(worst, delta)
          }
        }
        return { differing, worst, size: `${left.width}×${left.height}` }
      },
      { a: `data:image/png;base64,${a.toString('base64')}`, b: `data:image/png;base64,${b.toString('base64')}` },
    )

    if (found.differing === -1) return { equal: false, detail: `the captures are different sizes: ${found.size}` }
    return {
      equal: found.differing === 0,
      detail: `${found.differing} of ${found.size} pixels differ, the worst by ${found.worst} of 255`,
    }
  } finally {
    await page.close()
  }
}

/** Keep a capture where a person can look at it. Never where git can see it. */
function keep(name: string, capture: Buffer): string {
  mkdirSync(ARTIFACTS, { recursive: true })
  const file = path.join(ARTIFACTS, `${name}.png`)
  writeFileSync(file, capture)
  return file
}

// ------------------------------------------------ reading the imported document

type FieldNode = {
  type: string
  field: string
  staticAttributes?: { class?: string[]; width?: number; height?: number }
}

/** Every field node in the document, in the order the renderer emits them. */
function fieldNodes(record: ImportRecord): FieldNode[] {
  const out: FieldNode[] = []
  const walk = (nodes: readonly unknown[]): void => {
    for (const raw of nodes) {
      const node = raw as { type?: string; children?: unknown[] }
      if (node.type === 'element') {
        walk(node.children ?? [])
        continue
      }
      out.push(raw as FieldNode)
    }
  }
  walk(record.conversion.document?.nodes ?? [])
  return out
}

/** Whether a compiled stylesheet has a rule about this class, as a whole token. */
function stylesheetDefines(css: string, token: string): boolean {
  return new RegExp(`\\.${token.replace(/[^\w-]/g, '\\$&')}(?![\\w-])`).test(css)
}

// ================================================================== the tests

withCatalogue(about('V1’s page-level stylesheet, before anything is compared against it'), () => {
  test('is the same slice of the same file the importer reads its preset class names from', () => {
    // Two readings of one template literal, held against each other. A slice
    // that had drifted would give every comparison below a stylesheet nobody
    // checked, and it would still look like a stylesheet.
    const classes = presetClassNames(
      readFileSync(path.join(catalogue().v1Root, V1_INPUTS.presets), 'utf8'),
      classesInStylesheet,
    )
    expect(classes.length).toBeGreaterThan(0)
    expect(classes).toEqual(catalogue().presetClasses)
    for (const name of classes) expect(catalogue().presetCss, name).toContain(`.${name}`)
  })

  test('changes nothing about how the measured definitions render, which is the only reason they can be compared', async ({
    page,
  }) => {
    // The claim the whole file rests on, measured rather than read off V1's
    // source. If a rule in the page-level sheet did reach into one of these
    // definitions, its V1 rendering would depend on a stylesheet this repository
    // has never carried, and comparing V2 against a page rendered without it
    // would be comparing against a partial render and calling the difference
    // parity.
    // Asked of every definition whose status changed, because the claim is about
    // all of them; the two renders below are only taken for the ones a browser
    // can be asked to measure.
    for (const id of NEWLY_AUTOMATIC) {
      const definition = catalogue().definitions.get(id)!
      expect(presetStylesheetHooks(definition.html, catalogue().presetClasses), id).toEqual([])
      if (!(MEASURED_IN_A_BROWSER as readonly string[]).includes(id)) continue

      const withSheet = await render(page, v1Rendering(definition), 'desktop')
      expectQuiet(withSheet, `${id}: V1 with the page stylesheet`)
      const styled = await readRendering(page, 'body > *')
      await finish(page)

      const without = await render(page, v1Rendering(definition, { pageStylesheet: false }), 'desktop')
      expectQuiet(without, `${id}: V1 without the page stylesheet`)
      const bare = await readRendering(page, 'body > *')
      await finish(page)

      expect(
        describeRenderingDifferences(renderingDifferences(styled, bare)),
        `${id}: V1's page-level sheet is not inert`,
      ).toBe('')
    }
  })
})

for (const id of MEASURED_IN_A_BROWSER) {
  withCatalogue(about(`${id}, rendered by V1 and by the structured renderer`), () => {
    for (const viewport of ['desktop', 'mobile'] as const) {
      test(`lays out at ${viewport} exactly as far as the conversion is faithful`, async ({
        page,
        browser,
      }, testInfo) => {
        const definition = catalogue().definitions.get(id)!
        const record = catalogue().records.get(id)!

        const v1Observed = await render(page, v1Rendering(definition), viewport)
        expectQuiet(v1Observed, `${id} ${viewport} V1`)
        // One root, or the two sides are not being read from the same place.
        expect(await page.locator('body > *').count(), `${id}: V1's markup is not a single element`).toBe(1)
        const v1Elements = await readRendering(page, 'body > *')
        const v1Capture = await page.locator('body > *').first().screenshot()
        await finish(page)

        const v2Observed = await render(page, v2Rendering(record), viewport)
        expectQuiet(v2Observed, `${id} ${viewport} V2`)
        const v2Elements = await readRendering(page, 'body > * > *')
        const v2Capture = await page.locator('body > * > *').first().screenshot()
        await finish(page)

        // A parity property in its own right: two renderings of one definition
        // must ask for the same things, or one of them is fetching something the
        // other is not.
        expect(v2Observed.served, `${id} ${viewport}: the two renderings request different URLs`).toEqual(
          v1Observed.served,
        )

        const differences = renderingDifferences(v1Elements, v2Elements)
        const pixels = await comparePixels(browser, v1Capture, v2Capture)
        // Kept whatever the outcome. A passing run's captures are what somebody
        // looks at to see what "parity" meant here; a failing run's are the
        // finding itself.
        await testInfo.attach(`${id}-${viewport}-v1`, {
          path: keep(`${id}-${viewport}-v1`, v1Capture),
          contentType: 'image/png',
        })
        await testInfo.attach(`${id}-${viewport}-v2`, {
          path: keep(`${id}-${viewport}-v2`, v2Capture),
          contentType: 'image/png',
        })

        // Every definition this file measures is one the importer claims to
        // reproduce, so there is one outcome and no branch. A definition the
        // conversion changes is refused before it gets here — see the refusal
        // suite below, and the comment on NEWLY_AUTOMATIC for how that rule came
        // to exist.
        expect(describeRenderingDifferences(differences), `${id} ${viewport}: computed styles and boxes`).toBe('')
        expect(pixels.equal, `${id} ${viewport}: ${pixels.detail}`).toBe(true)
      })
    }

    test('carries every class the definition declared, and the stylesheet matches the ones it defines', async ({
      page,
    }) => {
      const record = catalogue().records.get(id)!
      const observed = await render(page, v2Rendering(record), 'desktop')
      expectQuiet(observed, `${id}: classes`)

      // Two claims, and the second is the one worth the browser. The first is
      // that a link or image field node's declared token list is the token list
      // on the element — checked on the page rather than in the markup. The
      // second is that each token is what the definition's stylesheet says it
      // is: a token the compiled sheet defines must change the section when it
      // is taken off, and a token the sheet does not define must change nothing.
      // That second half is why `cms-cta` can be carried without lying about it
      // — it is a hook V1's own script reads, with no rule anywhere in the
      // catalogue, and this is the assertion that says so rather than assuming.
      const markup = fieldNodes(record).filter(node => node.type === 'link' || node.type === 'image')
      expect(markup.length, `${id} renders no link or image field`).toBeGreaterThan(0)
      for (const node of markup) {
        const declared = node.staticAttributes?.class ?? []
        const onThePage = await page.evaluate(
          input => {
            const element = Array.from(document.querySelectorAll(input.tag)).find(
              candidate =>
                input.declared.every(token => candidate.classList.contains(token)) &&
                candidate.classList.length === input.declared.length,
            )
            return element === undefined ? null : Array.from(element.classList)
          },
          { tag: node.type === 'link' ? 'a' : 'img', declared },
        )
        expect(
          onThePage,
          `${id}: no <${node.type === 'link' ? 'a' : 'img'}> carries exactly ${node.field}'s classes`,
        ).toEqual(declared)
      }

      // Every class on the page, not only the field nodes', because "the
      // governed classes apply" is a claim about the section rather than about
      // three elements in it.
      const verdicts = await page.evaluate(() => {
        // The whole computed style, property by property. `cssText` is empty on
        // a computed declaration by specification, and comparing two empty
        // strings is how a check like this passes without measuring anything.
        const snapshot = (root: Element): string => {
          let out = ''
          for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
            const computed = getComputedStyle(element)
            for (let at = 0; at < computed.length; at += 1) {
              const property = computed.item(at)
              out += `${property}:${computed.getPropertyValue(property)};`
            }
          }
          return out
        }
        const section = document.querySelector('body > * > *')!
        const found: { tag: string; token: string; changesTheSection: boolean }[] = []
        for (const element of [section, ...Array.from(section.querySelectorAll('*'))]) {
          for (const token of Array.from(element.classList)) {
            const before = snapshot(section)
            element.classList.remove(token)
            const after = snapshot(section)
            element.classList.add(token)
            found.push({ tag: element.tagName.toLowerCase(), token, changesTheSection: before !== after })
          }
        }
        return found
      })

      expect(verdicts.length, `${id} puts no classes on the page`).toBeGreaterThan(0)
      for (const verdict of verdicts) {
        expect(
          verdict.changesTheSection,
          `${id}: <${verdict.tag}> class ${verdict.token} ${verdict.changesTheSection ? 'changes' : 'changes nothing'}` +
            ' but the compiled stylesheet says otherwise',
        ).toBe(stylesheetDefines(record.conversion.compiledCss!, verdict.token))
      }
    })

    test('lays out in the editor’s preview exactly as it publishes, down to the one thing the wrapper changes', async ({
      page,
    }) => {
      const record = catalogue().records.get(id)!
      const published = v2Rendering(record)
      const previewed = v2Rendering(record, { preview: true })

      // The markup half, through the renderer's own stripper rather than a
      // pattern written here: the function that adds the instrumentation and the
      // one that removes it live beside each other on purpose, so a new preview
      // affordance fails this test rather than sliding past a regular
      // expression in a spec file.
      expect(stripPreviewInstrumentation(previewed.body), `${id}: preview markup`).toBe(published.body)

      const publicObserved = await render(page, published, 'desktop')
      expectQuiet(publicObserved, `${id}: public`)
      const live = await readRendering(page, 'body > * > *')
      await finish(page)

      const previewObserved = await render(page, previewed, 'desktop')
      expectQuiet(previewObserved, `${id}: preview`)
      const instrumentation = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-cms-slot]')).map(element => ({
          slot: element.getAttribute('data-cms-slot'),
          kind: element.getAttribute('data-cms-kind'),
          tag: element.tagName.toLowerCase(),
        })),
      )
      // The canvas is the same page with selection handles on it: one wrapper
      // per field node, each naming the field it wraps and the kind the editor
      // should offer for it.
      expect(instrumentation.map(entry => entry.slot)).toEqual(fieldNodes(record).map(node => node.field))
      expect(instrumentation.map(entry => entry.kind)).toEqual(fieldNodes(record).map(node => node.type))
      expect([...new Set(instrumentation.map(entry => entry.tag))]).toEqual(
        instrumentation.length === 0 ? [] : ['cms-slot'],
      )

      // The layout half, which reading the markup cannot settle: preview wraps
      // every field's content in an inline element, and an inline element in the
      // wrong place moves a line.
      const canvas = await readRendering(page, 'body > * > *', { skip: '[data-cms-slot]' })
      await finish(page)
      const differences = renderingDifferences(live, canvas)

      // Every box, every colour, every font: identical. Nothing about the page a
      // reader can see may depend on which of the two rendered it.
      expect(
        describeRenderingDifferences(differences.filter(difference => difference.property !== 'display')),
        `${id}: preview against public`,
      ).toBe('')

      // `display` is the one exception, and it is a real one rather than a
      // tolerance. A link or image field node renders an element of its own, so
      // preview's wrapper becomes that element's parent — and an `inline-flex`
      // anchor that was a flex item of the section's own flex container is
      // blockified to `flex`, while the same anchor inside a wrapper is not.
      // The boxes come out in the same places for these definitions, which is
      // what the assertion above establishes; the computed value still differs,
      // and the honest thing is to say which elements it differs on rather than
      // to leave `display` out of the comparison.
      const BLOCKIFIED: Record<string, string> = {
        flex: 'inline-flex',
        grid: 'inline-grid',
        block: 'inline-block',
        'flow-root': 'inline-block',
      }
      for (const difference of differences) {
        expect(['a', 'img'], `${id}: preview changed display on <${difference.tag}>, which it does not wrap`).toContain(
          difference.tag,
        )
        expect(
          BLOCKIFIED[difference.first],
          `${id}: <${difference.tag}> display ${difference.first} became ${difference.second}`,
        ).toBe(difference.second)
      }
    })
  })
}

withCatalogue(about('the five dividers, which convert and cannot be photographed'), () => {
  test('render identical markup and no box at all, under this repository’s stylesheets', async ({ page }) => {
    // The assertion the suites above cannot make about them, made once here so
    // "not pixel-comparable" is a measured fact rather than an exemption. If a
    // divider ever grew a box, or its two renderings stopped matching, this
    // fails — which is the property that makes leaving them out of the pixel
    // sweep honest.
    for (const id of NOT_PIXEL_COMPARABLE) {
      const record = catalogue().records.get(id)!
      const definition = catalogue().definitions.get(id)!
      expect(record.status, id).toBe('automatic')

      const body = renderStructuredBody(
        {
          definition_kind: 'structured',
          structured_doc: record.conversion.document,
          structured_schema_version: STRUCTURED_SCHEMA_VERSION,
        },
        v1DefaultValues(definition.html, definition.slots).values,
      )
      const { substantive } = partitionDifferences(compareRenderings(definition.html, body ?? ''))
      expect(describeDifferences(substantive), id).toBe('')

      // Empty, and that is why there is nothing to photograph: the classes this
      // markup carries are defined in a page-level stylesheet the repository
      // does not hold, so both renderings are correctly a zero-height box.
      // The carried preset sheet adds inherited motion tokens, but it must not
      // invent the missing page-level layout rules for these dividers.
      expect(record.conversion.compiledCss, `${id} acquired a divider layout rule`).not.toContain('.section-divider')

      const observed = await render(page, v2Rendering(record), 'desktop')
      expectQuiet(observed, `${id}: box`)
      const box = await page.locator('body > * > *').first().boundingBox()
      expect(box?.height ?? 0, `${id} renders a box, so it belongs in the pixel sweep`).toBe(0)
      await finish(page)
    }
  })
})

withCatalogue(about('the definition the converter refuses rather than changes'), () => {
  test('hni-hero-v1 produces no document, and says which markup it could not carry', () => {
    // The finding this file made, kept as an assertion after the thing it
    // convicted stopped being rendered. Chromium counted thirteen elements
    // against V1's fifteen because a `<br>` and an `<em>` sat inside a region
    // declared `text`; the converter now refuses that shape before any document
    // exists, so the honest form of the measurement is that there is nothing to
    // measure, and why.
    const record = catalogue().records.get('hni-hero-v1')
    expect(record, 'hni-hero-v1 is no longer in the catalogue at all').toBeDefined()
    expect(record!.status).toBe('quarantined')
    expect(record!.conversion.document).toBeNull()
    expect(record!.reasons.map(reason => reason.code)).toEqual(['text-region-markup'])
    expect(record!.reasons[0]!.detail).toBe('br em')
  })
})

test.describe('intrinsic dimensions on an image field node', () => {
  /**
   * Driven by a document written here rather than by an imported one, and that
   * is a change of subject on purpose.
   *
   * This suite used to read `hni-hero-v1`, the only converted definition whose
   * image declared a width and a height — and that definition is now refused for
   * an unrelated reason, which took the measurement with it. The property being
   * measured was never a fact about that definition: it is the renderer's, that
   * a governed `width`/`height` pair on an image field node reaches the page and
   * gives the browser an intrinsic ratio before the asset arrives, which is the
   * layout shift the pair exists to prevent. Written against a document built
   * through the real schema, it goes on holding whatever the importer converts,
   * and it runs on a machine with no V1 checkout.
   */
  const DIMENSIONS = { width: 640, height: 360 }

  function imageSection(staticAttributes: Record<string, unknown> | undefined): Rendering {
    const body = renderStructuredBody(
      {
        definition_kind: 'structured',
        structured_doc: {
          schemaVersion: STRUCTURED_SCHEMA_VERSION,
          fields: [{ name: 'picture', type: 'image', label: 'Picture' }],
          nodes: [
            {
              type: 'element',
              tag: 'div',
              attributes: { class: 'shot' },
              children: [
                staticAttributes === undefined
                  ? { type: 'image', field: 'picture' }
                  : { type: 'image', field: 'picture', staticAttributes },
              ],
            },
          ],
        },
        structured_schema_version: STRUCTURED_SCHEMA_VERSION,
      },
      { picture: { src: '/fixture.png', alt: 'A picture' } },
    )
    expect(body, 'the fixture document did not render').not.toBeNull()
    // `/fixture.png` is served by this file's own route as a one-pixel image,
    // which is what makes the assertion below a measurement of the attributes:
    // any ratio the browser computes can only have come from them.
    return { css: `${RESET}.shot img{width:100%;height:auto}`, body: body! }
  }

  test('reserves the shape they describe, on the page rather than in the document', async ({ page }) => {
    const observed = await render(page, imageSection(DIMENSIONS), 'desktop')
    expectQuiet(observed, 'image with declared dimensions')
    const measured = await page.evaluate(() => {
      const image = document.querySelector('img')!
      return {
        width: image.getAttribute('width'),
        height: image.getAttribute('height'),
        aspectRatio: getComputedStyle(image).aspectRatio,
        natural: { width: image.naturalWidth, height: image.naturalHeight },
      }
    })
    await finish(page)

    expect(measured.width).toBe(String(DIMENSIONS.width))
    expect(measured.height).toBe(String(DIMENSIONS.height))
    expect(measured.natural).toEqual({ width: 1, height: 1 })
    expect(measured.aspectRatio).toBe(`auto ${DIMENSIONS.width} / ${DIMENSIONS.height}`)
  })

  test('and without them the browser has no ratio to work from, which is the control', async ({ page }) => {
    const observed = await render(page, imageSection(undefined), 'desktop')
    expectQuiet(observed, 'image with no declared dimensions')
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('img')!).aspectRatio)).toBe('auto')
    await finish(page)
  })
})

withCatalogue(about('every definition the importer converted, swept once as a page'), () => {
  test('agrees with the markup comparison about which ones reproduce V1 and which do not', async ({
    page,
    browser,
  }) => {
    // The markup comparison and the browser are two ways of asking one question,
    // and a definition where they disagreed would be one where a difference is
    // invisible on the page, or where a sameness is not real. Seven definitions,
    // two page loads and a decode each, so the default timeout is not enough.
    test.setTimeout(180_000)
    const verdicts: { id: string; markup: boolean; pixels: boolean | null; detail: string }[] = []

    /**
     * The rendered box, or null when the element has none.
     *
     * A screenshot needs somewhere to point. Five of the eleven definitions are
     * decorative dividers with an empty compiled stylesheet — everything that
     * gives their markup a size lives in a page-level sheet this repository does
     * not carry — so both renderings are correctly zero pixels tall, and asking
     * Playwright for a picture of one waits for a stable non-empty rect until
     * the test times out. Measuring first turns that from a hang into a fact.
     */
    const boxOf = async (selector: string) =>
      (await page.locator(selector).first().boundingBox()) ?? { width: 0, height: 0 }

    for (const [id, record] of catalogue().records) {
      if (record.status !== 'automatic') continue
      const definition = catalogue().definitions.get(id)!
      const values = v1DefaultValues(definition.html, definition.slots)
      const body = renderStructuredBody(
        {
          definition_kind: 'structured',
          structured_doc: record.conversion.document,
          structured_schema_version: STRUCTURED_SCHEMA_VERSION,
        },
        values.values,
      )
      const { substantive } = partitionDifferences(compareRenderings(definition.html, body ?? ''))

      const v1Observed = await render(page, v1Rendering(definition), 'desktop')
      expectQuiet(v1Observed, `${id}: sweep V1`)
      const v1Box = await boxOf('body > *')
      const v1Capture = v1Box.height > 0 ? await page.locator('body > *').first().screenshot() : null
      await finish(page)

      const v2Observed = await render(page, v2Rendering(record), 'desktop')
      expectQuiet(v2Observed, `${id}: sweep V2`)
      const v2Box = await boxOf('body > * > *')
      const v2Capture = v2Box.height > 0 ? await page.locator('body > * > *').first().screenshot() : null
      await finish(page)

      // Whether a definition renders a box at all is itself a parity claim, and
      // the one that would be lost by skipping. A conversion that turned a
      // zero-height decorative divider into something with a size, or the other
      // way round, differs here even though no picture of either exists.
      expect(v1Box.height > 0, `${id}: V1 renders a box and V2 does not, or the reverse`).toBe(v2Box.height > 0)

      if (v1Capture === null || v2Capture === null) {
        verdicts.push({
          id,
          markup: substantive.length === 0,
          pixels: null,
          detail:
            `renders no box under this repository's stylesheets; ` +
            `${describeDifferences(substantive) || 'no markup differences'}`,
        })
        continue
      }

      const pixels = await comparePixels(browser, v1Capture, v2Capture)
      keep(`sweep-${id}-v1`, v1Capture)
      keep(`sweep-${id}-v2`, v2Capture)
      verdicts.push({
        id,
        markup: substantive.length === 0,
        pixels: pixels.equal,
        detail: `${pixels.detail}; ${describeDifferences(substantive) || 'no markup differences'}`,
      })
    }

    for (const verdict of verdicts) {
      // A definition with no box is held to the markup comparison alone, and
      // says so. `null` is not `true` — the two are kept apart so "the browser
      // agreed" and "the browser was not asked" can never be read as one thing.
      if (verdict.pixels === null) {
        expect(verdict.markup, `${verdict.id}: ${verdict.detail}`).toBe(true)
        continue
      }
      expect(verdict.pixels, `${verdict.id}: the markup comparison and the browser disagree — ${verdict.detail}`).toBe(
        verdict.markup,
      )
    }
    // Every automatic definition reproduces V1, however it was measured, and the
    // list names which ones the browser could be asked about.
    expect(verdicts.filter(verdict => verdict.markup).map(verdict => verdict.id)).toEqual(EVERY_FAITHFUL_DEFINITION)
    expect(verdicts.filter(verdict => verdict.pixels === null).map(verdict => verdict.id)).toEqual(NOT_PIXEL_COMPARABLE)
  })
})
