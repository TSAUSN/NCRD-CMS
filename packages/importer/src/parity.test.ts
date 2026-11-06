// Does an imported definition render the page V1 rendered?
//
// `catalogue.test.ts` establishes that the seven automatic definitions produce
// documents the schema accepts, stylesheets the CSS policy accepts, and markup
// rather than null. None of that is evidence about the page. This file supplies
// the evidence it can supply without a browser: take the definition's own
// default content out of V1's template, render the imported document with it,
// and compare the two markups node for node.
//
// The two halves are deliberately different in kind. The synthetic half proves
// the comparison *works* — that it catches a dropped attribute, a changed class
// token, a moved element, a different image width, and that it is blind to
// exactly three things and no more — and it runs on every machine, because a
// comparison nobody has tested is not evidence of anything either. The licensed
// half runs the tested comparison over the real catalogue, and skips visibly
// where the catalogue is not on the machine.
//
// The licensed half asserts today's answer per definition by name, including the
// definition that is *not* at parity. That is on purpose and follows the
// convention `catalogue.test.ts` set with its count of seventeen: a measurement
// is written down so that changing it is a decision somebody makes rather than a
// number that drifts. When `hni-hero-v1` stops losing its line break, this file
// goes red and whoever fixed it moves it into the other list.

import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STRUCTURED_SCHEMA_VERSION } from '@cms/schema'
import { renderStructuredBody } from '@cms/renderer'
import {
  V1_EDITOR_INSTRUMENTATION,
  compareRenderings,
  comparisonTree,
  decideV1Source,
  describeDifferences,
  partitionDifferences,
  presetStylesheetHooks,
  probeV1Root,
  v1DefaultValues,
  type ParityDifference,
  type V1RootProbe,
} from './parity.ts'
import { classesInStylesheet } from './presets.ts'
import { readV1Catalogue, V1_INPUTS, type V1Definition, type V1Slot } from './source.ts'
import { runImport, type ImportRecord, type ImportRun } from './run.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** The kinds a difference list reports, so an assertion can be about kinds. */
function kinds(differences: readonly ParityDifference[]): string[] {
  return differences.map(difference => difference.kind)
}

// ------------------------------------------------------- the comparison itself

describe('what the rendering comparison is blind to', () => {
  // Three things, named in `parity.ts`, and this is where "three" is checked
  // rather than asserted in a comment. Each case below is the same document
  // written two ways; anything the comparison reported here would be a thing it
  // is normalizing that it should not be, or a thing it is not normalizing that
  // it should.

  it('does not report the whitespace between two tags', () => {
    const packed = '<section class="a"><div><p>Copy</p></div></section>'
    const spread = '<section class="a">\n  <div>\n    <p>Copy</p>\n  </div>\n</section>'
    expect(compareRenderings(packed, spread)).toEqual([])
    expect(compareRenderings(spread, packed)).toEqual([])
  })

  it('does not report the order the attributes were written in', () => {
    const one = '<img src="/a.png" alt="A cat" width="10" height="20">'
    const other = '<img height="20" width="10" alt="A cat" src="/a.png">'
    expect(compareRenderings(one, other)).toEqual([])
  })

  it('does not report the quoting around an attribute value', () => {
    // The importer's reader accepts both spellings and keeps neither, which is
    // why the comparison can be blind to this without deciding anything.
    expect(compareRenderings(`<a href='/about' class='b'>Go</a>`, '<a href="/about" class="b">Go</a>')).toEqual([])
  })

  it('reports nothing at all when the two renderings are the same document', () => {
    const html = '<section class="x"><h2 class="t">Title</h2><a href="/x" rel="noopener">Go</a></section>'
    expect(compareRenderings(html, html)).toEqual([])
  })
})

describe('what the rendering comparison refuses to be blind to', () => {
  const v1 =
    '<section class="band wide" id="s"><h2 class="title">Heading</h2>' +
    '<a class="cta" href="/donate" target="_blank" rel="noopener">Donate</a>' +
    '<img src="/hero.png" alt="A volunteer" width="800" height="400" decoding="async">' +
    '</section>'

  it('reports an attribute V2 dropped, naming it', () => {
    const v2 = v1.replace(' decoding="async"', '')
    const found = compareRenderings(v1, v2)
    expect(kinds(found)).toEqual(['attribute-only-in-v1'])
    expect(found[0]!.name).toBe('decoding')
  })

  it('reports an attribute V2 added that V1 never had', () => {
    const v2 = v1.replace('<h2 class="title">', '<h2 class="title" hidden="hidden">')
    const found = compareRenderings(v1, v2)
    expect(kinds(found)).toEqual(['attribute-only-in-v2'])
    expect(found[0]!.name).toBe('hidden')
  })

  it('reports a class token that only one side has, and says which side', () => {
    const found = compareRenderings(v1, v1.replace('class="band wide"', 'class="band"'))
    expect(kinds(found)).toEqual(['class-tokens'])
    expect(found[0]!.detail).toContain('only in V1: wide')
    expect(found[0]!.detail).toContain('only in V2: none')
  })

  it('reports the same class tokens in a different order rather than deciding it does not matter', () => {
    const found = compareRenderings(v1, v1.replace('class="band wide"', 'class="wide band"'))
    expect(kinds(found)).toEqual(['class-order'])
  })

  it('reports a changed link URL', () => {
    const found = compareRenderings(v1, v1.replace('href="/donate"', 'href="/give"'))
    expect(kinds(found)).toEqual(['attribute-value'])
    expect(found[0]!.name).toBe('href')
  })

  it('reports a changed image source', () => {
    const found = compareRenderings(v1, v1.replace('src="/hero.png"', 'src="/hero-2.png"'))
    expect(found.map(difference => difference.name)).toEqual(['src'])
  })

  it('reports a changed image width, which is the box the page reserves', () => {
    const found = compareRenderings(v1, v1.replace('width="800"', 'width="801"'))
    expect(kinds(found)).toEqual(['attribute-value'])
    // A dimension is a number rather than somebody's copy, so the difference is
    // allowed to quote both values — which is what makes it debuggable.
    expect(found[0]!.detail).toBe('V1 has "800", V2 has "801"')
  })

  it('reports changed alt text without reproducing either version of it', () => {
    const found = compareRenderings(v1, v1.replace('alt="A volunteer"', 'alt="A supporter"'))
    expect(kinds(found)).toEqual(['attribute-value'])
    expect(found[0]!.name).toBe('alt')
    // The rule from `parity.ts`: a page's copy does not leave the machine it is
    // measured on, so the difference carries lengths and an offset instead.
    expect(found[0]!.detail).not.toContain('volunteer')
    expect(found[0]!.detail).not.toContain('supporter')
    expect(found[0]!.detail).toContain('first differing at')
  })

  it('reports a dropped rel, which is the relationship that protects the opened page', () => {
    const found = compareRenderings(v1, v1.replace(' rel="noopener"', ''))
    expect(kinds(found)).toEqual(['attribute-only-in-v1'])
    expect(found[0]!.name).toBe('rel')
  })

  it('reports a dropped accessibility attribute', () => {
    const withRole = '<span role="presentation" aria-hidden="true"></span>'
    expect(compareRenderings(withRole, '<span aria-hidden="true"></span>').map(d => d.name)).toEqual(['role'])
  })

  it('reports changed text', () => {
    const found = compareRenderings(v1, v1.replace('>Heading<', '>Headings<'))
    expect(kinds(found)).toEqual(['text'])
  })

  it('reports an element V2 did not render, and says what the child list was on each side', () => {
    const v2 = v1.replace('<img src="/hero.png" alt="A volunteer" width="800" height="400" decoding="async">', '')
    const found = compareRenderings(v1, v2)
    expect(kinds(found)).toEqual(['child-count'])
    expect(found[0]!.detail).toContain('<img>')
    expect(found[0]!.path).toBe('/section[1]')
  })

  it('reports an element V2 rendered that V1 never had', () => {
    const found = compareRenderings(v1, v1.replace('</section>', '<hr></section>'))
    expect(kinds(found)).toEqual(['child-count'])
    expect(found[0]!.detail).toContain('V2 has 4')
  })

  it('reports a substituted tag rather than descending into it as though it matched', () => {
    const found = compareRenderings('<section><h2>Title</h2></section>', '<section><h3>Title</h3></section>')
    expect(kinds(found)).toEqual(['tag'])
    expect(found[0]!.detail).toBe('V1 has <h2>, V2 has <h3>')
  })

  it('reports text where the other side has an element, without pretending they line up', () => {
    const found = compareRenderings('<p><em>Words</em></p>', '<p>Words</p>')
    expect(kinds(found)).toEqual(['node-kind'])
  })

  it('finds a difference nested several levels down and names the path to it', () => {
    const deep = '<section><div><div><p class="a">x</p></div></div></section>'
    const found = compareRenderings(deep, deep.replace('class="a"', 'class="b"'))
    expect(found[0]!.path).toBe('/section[1]/div[1]/div[1]/p[1]')
  })

  it('keeps comparing past a length mismatch, so the differences beside one are still reported', () => {
    // A conversion that drops an element usually drops one, and abandoning the
    // walk at the count would hide everything else at that level — the list
    // somebody has to work through would be one line long every time.
    const before = '<div><p class="a">x</p><span>b</span><span>c</span></div>'
    const after = '<div><p class="z">x</p><span>b</span></div>'
    expect(kinds(compareRenderings(before, after))).toEqual(['child-count', 'class-tokens'])
  })
})

describe('a rendering the strict reader cannot read', () => {
  it('is reported as unreadable rather than compared and called equal', () => {
    // Two documents that no reader here understands are not two documents that
    // agree. A comparison that returned an empty list for them would be the
    // most expensive kind of false green available.
    const found = compareRenderings('<section><p>unclosed</section>', '<section><p>unclosed</section>')
    expect(kinds(found)).toEqual(['unreadable', 'unreadable'])
  })

  it('says which side it could not read', () => {
    const found = compareRenderings('<section></section>', '<section><p></section>')
    expect(kinds(found)).toEqual(['unreadable'])
    expect(found[0]!.detail).toContain("V2's rendering")
  })

  it('hands back a refusal from the tree reader rather than an empty tree', () => {
    const read = comparisonTree('<div><span></div>')
    expect(read.ok).toBe(false)
  })
})

// --------------------------------------- the definition's own default content

describe('reading a definition’s own default content out of its markup', () => {
  const slots = (...entries: [string, string][]): V1Slot[] =>
    entries.map(([blockId, editable]) => ({ blockId, editable, label: blockId, role: null }))

  it('reads a text region as the text it holds', () => {
    const extracted = v1DefaultValues('<h2 data-block-id="t" data-editable="text">Ready</h2>', slots(['t', 'text']))
    expect(extracted.values).toEqual({ t: 'Ready' })
    expect(extracted.problems).toEqual([])
  })

  it('reads a richtext region as the markup it holds', () => {
    const extracted = v1DefaultValues(
      '<div data-block-id="b" data-editable="richtext"><p>One sentence.</p></div>',
      slots(['b', 'richtext']),
    )
    expect(extracted.values).toEqual({ b: '<p>One sentence.</p>' })
  })

  it('reads a link region as the URL and the label V1 would have shown', () => {
    const extracted = v1DefaultValues(
      '<a data-block-id="l" data-editable="link" href="/about">About</a>',
      slots(['l', 'link']),
    )
    expect(extracted.values).toEqual({ l: { url: '/about', label: 'About' } })
  })

  it('reads an image region as its source and its alt text', () => {
    const extracted = v1DefaultValues(
      '<img data-block-id="i" data-editable="image" src="/a.png" alt="A cat" width="10" height="20">',
      slots(['i', 'image']),
    )
    expect(extracted.values).toEqual({ i: { src: '/a.png', alt: 'A cat' } })
  })

  it('states an empty alt as decorative, because the structured renderer refuses to infer it', () => {
    const extracted = v1DefaultValues(
      '<img data-block-id="i" data-editable="image" src="/a.png" alt="">',
      slots(['i', 'image']),
    )
    expect(extracted.values).toEqual({ i: { src: '/a.png', alt: '', decorative: true } })
  })

  it('names a text region whose markup holds elements, which no author value can put back', () => {
    // The finding this whole file exists to be able to make. A `text` field node
    // renders an escaped string, so a `<br>` or an `<em>` the template shipped
    // inside the region is not somewhere else in the document — it is gone.
    const extracted = v1DefaultValues(
      '<p data-block-id="s" data-editable="text">One<br><em>two</em></p>',
      slots(['s', 'text']),
    )
    expect(extracted.markupInsideTextRegions).toEqual(['s: br em'])
  })

  it('refuses a region carrying a character reference rather than guessing what it decodes to', () => {
    const extracted = v1DefaultValues(
      '<h2 data-block-id="t" data-editable="text">Bed &amp; Board</h2>',
      slots(['t', 'text']),
    )
    expect(extracted.values).toEqual({})
    expect(extracted.problems).toEqual(['t holds a character reference this extractor does not decode'])
  })

  it('reports a declared slot that has no region in the markup', () => {
    const extracted = v1DefaultValues('<section></section>', slots(['gone', 'text']))
    expect(extracted.problems).toEqual(['gone is declared as a slot and has no region in the markup'])
  })

  it('reports markup it cannot read rather than returning an empty set of values', () => {
    expect(v1DefaultValues('<div><span></div>', slots(['t', 'text'])).problems[0]).toContain(
      'the markup could not be read',
    )
  })
})

describe('the hooks V1’s page-level stylesheets reach for', () => {
  // The check that decides whether a browser comparison means anything. The
  // preset class list is read off V1's own stylesheet in a real run; here it is
  // supplied directly so the function can be tested where V1 is not.
  const presets = ['fx-lift', 'fx-none', 'cms-form-action']

  it('finds none in markup that carries only its own definition’s classes', () => {
    expect(presetStylesheetHooks('<section class="cms-section-quote"><p class="q">x</p></section>', presets)).toEqual(
      [],
    )
  })

  it('finds a preset class wherever it sits in the tree', () => {
    expect(presetStylesheetHooks('<section><div><a class="btn fx-lift">Go</a></div></section>', presets)).toEqual([
      'class fx-lift',
    ])
  })

  it('finds the hidden form-action handle, whose absence turns a link into visible body copy', () => {
    expect(presetStylesheetHooks('<a class="cms-form-action" href="#">endpoint</a>', presets)).toEqual([
      'class cms-form-action',
    ])
  })

  it('finds the arrow hook, which is drawn as generated content rather than as a class rule', () => {
    expect(presetStylesheetHooks('<a class="cms-arrow">Go</a>', presets)).toEqual(['class cms-arrow'])
  })

  it('finds the mobile-density attribute, which is the second injected sheet’s only hook', () => {
    expect(presetStylesheetHooks('<section data-mobile-density="compact"></section>', presets)).toEqual([
      'attribute data-mobile-density',
    ])
  })
})

// ------------------------------------------------------------ expected residue

describe('separating the difference V2 is expected to have from every other one', () => {
  const region = '<h2 class="t" data-block-id="title" data-cms-section="home-hero" ' + 'data-editable="text">Ready</h2>'
  const rendered = '<h2 class="t">Ready</h2>'

  it('puts V1’s editor instrumentation on its own side of the line', () => {
    const { instrumentation, substantive } = partitionDifferences(compareRenderings(region, rendered))
    expect(instrumentation.map(difference => difference.name).sort()).toEqual([...V1_EDITOR_INSTRUMENTATION].sort())
    expect(substantive).toEqual([])
  })

  it('treats one of those names carrying a different value as substantive, not as instrumentation', () => {
    // The property an ignore-list cannot have. `data-editable="link"` where V1
    // said `text` is a conversion that changed what the region is, and a rule
    // written as "ignore these two attribute names" would have swallowed it.
    const { instrumentation, substantive } = partitionDifferences(
      compareRenderings(region, region.replace('data-editable="text"', 'data-editable="link"')),
    )
    expect(instrumentation).toEqual([])
    expect(kinds(substantive)).toEqual(['attribute-value'])
  })

  it('treats one of those names appearing only on V2’s side as substantive', () => {
    const { instrumentation, substantive } = partitionDifferences(compareRenderings(rendered, region))
    expect(instrumentation).toEqual([])
    expect(kinds(substantive)).toEqual(['attribute-only-in-v2', 'attribute-only-in-v2', 'attribute-only-in-v2'])
  })
})

// ------------------------------------------------------------- the V1_ROOT gate

describe('deciding what a V1_ROOT means before this file opens anything', () => {
  // The same three answers `catalogue.test.ts` routes on, restated here because
  // the Playwright spec that does the browser half cannot import a vitest file
  // to reuse them. All three routes are reachable from a test rather than only
  // from whichever machine happens to be running it.
  const probeFinding = (found: V1RootProbe) => () => found

  it('skips, saying why, when V1_ROOT is not set at all', () => {
    const decided = decideV1Source(undefined, probeFinding('nothing'))
    expect(decided.kind).toBe('skip')
    expect(decided.why).toContain('not on this machine')
  })

  it('reads an empty V1_ROOT as absence, which is how a machine overrides a .env that names V1', () => {
    expect(decideV1Source('', probeFinding('nothing')).kind).toBe('skip')
    expect(decideV1Source('   ', probeFinding('nothing')).kind).toBe('skip')
  })

  it('fails rather than skipping when V1_ROOT names a path that is not there', () => {
    const decided = decideV1Source('/nowhere/v1-checkout', probeFinding('nothing'))
    expect(decided.kind).toBe('fail')
    expect(decided.why).toContain('nothing at that path')
  })

  it('fails when the path is there but holds no generated catalogue', () => {
    const decided = decideV1Source('/somewhere/else', probeFinding('directory-without-catalogue'))
    expect(decided.kind).toBe('fail')
    expect(decided.why).toContain(V1_INPUTS.sources)
  })

  it('runs against the path it was given once the catalogue is under it', () => {
    expect(decideV1Source('/opt/v1', probeFinding('catalogue'))).toMatchObject({ kind: 'run', v1Root: '/opt/v1' })
  })

  it('tells a V1 checkout from a directory and from nothing at all', () => {
    // Against a real filesystem, over a directory this test builds into each of
    // the three states in turn. The file it writes is empty: what is being
    // checked is where the gate looks, and nothing here needs — or may hold — a
    // byte of the real catalogue.
    const root = mkdtempSync(path.join(tmpdir(), 'cms-parity-root-'))
    try {
      expect(probeV1Root(root)).toBe('directory-without-catalogue')
      expect(probeV1Root(path.join(root, 'absent'))).toBe('nothing')
      mkdirSync(path.join(root, path.dirname(V1_INPUTS.sources)), { recursive: true })
      writeFileSync(path.join(root, V1_INPUTS.sources), '')
      expect(probeV1Root(root)).toBe('catalogue')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// -------------------------------------------------------- against the catalogue

const source = decideV1Source(process.env['V1_ROOT'], probeV1Root)
const withCatalogue = source.kind === 'run' ? describe : describe.skip

/** The suite name a reader sees. A suite that is not running says why in its own name. */
function about(name: string): string {
  return source.kind === 'run' ? name : `${name} [skipped: ${source.why}]`
}

if (source.kind === 'fail') {
  const { why } = source
  describe('the V1 checkout that V1_ROOT names', () => {
    it('holds the generated catalogue this parity check reads', () => {
      throw new Error(
        `${why}. Point V1_ROOT at a V1 checkout, or set V1_ROOT to an empty ` +
          'value to skip these suites and run everything else.',
      )
    })
  })
}

let memo: { run: ImportRun; definitions: Map<string, V1Definition>; presetClasses: string[] } | undefined

/**
 * The import run and the catalogue it came from, read the first time a test
 * asks.
 *
 * Lazy for the reason `catalogue.test.ts` gives at length: `describe.skip` still
 * evaluates its callback, so a describe body that read V1 would read it on every
 * machine that has none.
 */
function catalogue() {
  if (source.kind !== 'run') {
    throw new Error(`a test asked to read the V1 catalogue where there is none: ${source.why}`)
  }
  const v1Root = source.v1Root
  memo ??= (() => {
    const read = readV1Catalogue({ v1Root, repoRoot: REPO_ROOT }, classesInStylesheet)
    return {
      run: runImport({ v1Root, repoRoot: REPO_ROOT }),
      definitions: new Map(read.definitions.map(definition => [definition.id, definition])),
      presetClasses: read.presetClasses,
    }
  })()
  return memo
}

/**
 * One definition, rendered both ways and compared.
 *
 * This is the whole measurement: V1's rendering is the template markup, because
 * a section with no saved content and no settings is what V1 stamps onto the
 * page unchanged; V2's is the imported document rendered with the values that
 * same template carries. Anything the two disagree about is something the
 * conversion changed about the page.
 */
function parityOf(record: ImportRecord) {
  const definition = catalogue().definitions.get(record.provenance.id)
  if (definition === undefined) throw new Error(`${record.provenance.id} left the catalogue`)
  const extracted = v1DefaultValues(definition.html, definition.slots)
  const v2 = renderStructuredBody(
    {
      definition_kind: 'structured',
      structured_doc: record.conversion.document,
      structured_schema_version: STRUCTURED_SCHEMA_VERSION,
    },
    extracted.values,
  )
  if (v2 === null) throw new Error(`${record.provenance.id} rendered nothing at all`)
  return { definition, extracted, v2, ...partitionDifferences(compareRenderings(definition.html, v2)) }
}

function automatic(): ImportRecord[] {
  return catalogue().run.records.filter(record => record.status === 'automatic')
}

/**
 * Definitions whose rendering V1's own default content reproduces exactly, and
 * the one it does not.
 *
 * Written as two lists rather than as a count, for the reason `catalogue.test.ts`
 * gives about naming rather than counting: a count that moves is a count
 * somebody updates, and a name that moves says which definition changed and is
 * the first thing to go and look at.
 */
const AT_PARITY = [
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
 * Empty, and that is the claim.
 *
 * It held `hni-hero-v1` for exactly as long as the importer was willing to
 * convert a definition it could not reproduce. This harness is what found that:
 * every shape check passed, the census said `automatic`, and Chromium rendered
 * thirteen elements where V1 renders fifteen because a `<br>` and an `<em>`
 * inside a plain-text region have nowhere to live. The converter now refuses
 * that shape outright (`text-region-markup`), so the honest state of this list
 * is empty — an importer that says `automatic` about something it changed is
 * the one failure mode this file exists to catch, and it is now caught one step
 * earlier, before anything is converted at all.
 */
const NOT_AT_PARITY: string[] = []

/** Each automatic definition that uses V1's interaction presets, the preset
 * classes its markup names, and the preset rules its compiled CSS must carry. */
const PRESET_DEPENDENCIES: Record<string, { hooks: string[]; rules: string[] }> = {
  'campaign-progress-v1': { hooks: ['class fx-brand', 'class fx-press'], rules: ['.fx-brand', '.fx-press:active'] },
  'financial-transparency-v1': { hooks: ['class fx-underline'], rules: ['.fx-underline'] },
  'urgent-appeal-v1': {
    hooks: ['class fx-fill', 'class fx-press'],
    rules: ['.fx-fill::before', '.fx-fill:focus-visible', '.fx-fill:hover', '.fx-press:active'],
  },
}

withCatalogue(about('every definition the importer calls automatic, rendered against V1’s own markup'), () => {
  it('splits into exactly the definitions that reproduce V1’s markup and the ones that do not', () => {
    const reproduced: string[] = []
    const changed: string[] = []
    for (const record of automatic()) {
      const { substantive } = parityOf(record)
      ;(substantive.length === 0 ? reproduced : changed).push(record.provenance.id)
    }
    expect(reproduced).toEqual(AT_PARITY)
    expect(changed).toEqual(NOT_AT_PARITY)
    // Every automatic definition is in one list or the other, so a new one
    // cannot appear and go unmeasured.
    expect([...reproduced, ...changed].sort()).toEqual(automatic().map(r => r.provenance.id))
  })

  it('reproduces them node for node, differing only where V1 marks its own editable regions', () => {
    for (const id of AT_PARITY) {
      const record = automatic().find(candidate => candidate.provenance.id === id)!
      const { instrumentation, substantive, definition } = parityOf(record)
      expect(describeDifferences(substantive), id).toBe('')
      // The residue, stated exactly: both of V1's markers, once per mappable
      // region, and nothing else. A conversion that had quietly dropped a
      // region would show up here as a shortfall rather than as a pass.
      // Counted per name rather than as one product, because the three names
      // do not appear at the same cardinality: `data-block-id` and
      // `data-editable` mark every mappable region, while `data-cms-section`
      // names the definition once, on its root, in the twenty definitions that
      // carry it at all. Multiplying region count by name count was arithmetic
      // that happened to be right while both names were per-region, and would
      // have gone on looking right while hiding a missing marker.
      const mappable = definition.slots.filter(slot => slot.editable !== 'icon')
      const byName = new Map<string, number>()
      for (const difference of instrumentation) {
        // `name` is optional on a Difference because not every kind of
        // difference is about an attribute. Every instrumentation difference is
        // — `partitionDifferences` selects them by name — so an unnamed one here
        // would mean that selection had changed underneath this test, which is
        // worth failing on rather than skipping.
        expect(difference.name, `${id}: an instrumentation difference with no attribute name`).toBeDefined()
        const name = difference.name!
        byName.set(name, (byName.get(name) ?? 0) + 1)
      }
      expect(byName.get('data-block-id') ?? 0, id).toBe(mappable.length)
      expect(byName.get('data-editable') ?? 0, id).toBe(mappable.length)
      // Present exactly when V1's own markup carries it, so a definition that
      // never had one is not asserted to have lost one.
      const declared = /\sdata-cms-section=/.test(definition.html) ? 1 : 0
      expect(byName.get('data-cms-section') ?? 0, id).toBe(declared)
      expect([...byName.keys()].sort(), id).toEqual(
        [
          ...(mappable.length > 0 ? ['data-block-id', 'data-editable'] : []),
          ...(declared > 0 ? ['data-cms-section'] : []),
        ].sort(),
      )
    }
  })

  it('refuses hni-hero-v1 rather than converting a page it cannot reproduce', () => {
    // This harness is why that definition is refused. Every shape check passed
    // it, the census called it `automatic`, and rendering both markups in
    // Chromium found thirteen elements where V1 has fifteen: its subtitle
    // region is declared `text` and holds a `<br>` and an `<em>`, a text field
    // node renders an escaped string, and no author value can put either back.
    //
    // The measurement is kept rather than deleted along with the definition it
    // convicted. `parityOf` needs a converted document and there is no longer
    // one, so what is asserted here is the refusal and its reason — the same
    // fact, one step earlier, where it costs nobody a published page.
    const record = catalogue().run.records.find(r => r.provenance.id === 'hni-hero-v1')!
    expect(record.status).toBe('quarantined')
    expect(record.conversion.document).toBeNull()
    expect(record.reasons.map(reason => reason.code)).toEqual(['text-region-markup'])
    expect(record.reasons[0]!.detail).toBe('br em')
  })

  it('reads every one of their regions without meeting a character reference it would have to guess at', () => {
    for (const record of automatic()) {
      expect(parityOf(record).extracted.problems, record.provenance.id).toEqual([])
    }
  })

  it('carries each automatic definition’s explicit preset dependency in its compiled CSS', () => {
    const dependants: string[] = []
    for (const record of automatic()) {
      const definition = catalogue().definitions.get(record.provenance.id)!
      const hooks = presetStylesheetHooks(definition.html, catalogue().presetClasses)
      if (hooks.length === 0) continue
      dependants.push(record.provenance.id)
      const { hooks: expected, rules } = PRESET_DEPENDENCIES[record.provenance.id]!
      expect(hooks, record.provenance.id).toEqual(expected)
      for (const rule of rules) expect(record.conversion.compiledCss, `${record.provenance.id} ${rule}`).toContain(rule)
      expect(record.conversion.compiledCss).toContain('prefers-reduced-motion: reduce')
      expect(record.conversion.compiledCss).not.toContain(':root')
    }
    expect(dependants).toEqual(Object.keys(PRESET_DEPENDENCIES))
  })

  it('renders the same markup twice from the same document and the same values', () => {
    // Determinism at the render boundary rather than at the report boundary,
    // which is the one `determinism.test.ts` covers. A renderer that iterated a
    // Set somewhere would produce two orders of the same attributes, and every
    // comparison above would still pass while the published page changed on
    // every deploy.
    for (const record of automatic()) {
      expect(parityOf(record).v2, record.provenance.id).toBe(parityOf(record).v2)
    }
  })
})

withCatalogue(about('a definition the importer refused'), () => {
  it('has no document to compare, which is the difference between refusing and converting badly', () => {
    // The guard on the whole exercise. If a quarantined definition carried a
    // document, everything above would be measuring the wrong seven.
    for (const record of catalogue().run.records.filter(r => r.status !== 'automatic')) {
      expect(record.conversion.document, record.provenance.id).toBeNull()
    }
  })
})
