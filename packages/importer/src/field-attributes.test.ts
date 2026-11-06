// The field-attribute inventory, over markup written for this test and then over
// the real catalogue.
//
// Split the way `determinism.test.ts` and `catalogue.test.ts` are split, and for
// the same reason. The synthetic half runs everywhere, including on a machine
// that has never seen the V1 checkout, and contains the shapes that would break
// a careless classifier: an attribute whose value tracks a repeat index and one
// that merely contains a digit, a class list the schema's own grammar rejects, a
// definition refused at an earlier gate than the one this inventory measures.
// The V1 half checks arithmetic that no fixture can check — that the inventory
// and the classification run agree about the same 118 definitions. It skips
// visibly when no V1_ROOT names a path, and fails when one names something that
// is not a V1 checkout, rather than passing on an empty read in either case.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  inventoryFieldAttributes,
  valueShape,
  type FieldAttributeInventory,
  type FieldKind,
} from './field-attributes.ts'
import { inventoryCsv, inventoryJson, inventoryMarkdown } from './field-attributes-report.ts'
import { V1_INPUTS } from './source.ts'
import { runImport, type ImportRun } from './run.ts'

/**
 * A catalogue shaped like V1's generated files, holding markup written here.
 *
 * Every definition below exists to make one classification decision observable.
 * Nothing is copied from V1: the shape of the files is the part that has to
 * match, and the contents are chosen to be awkward.
 */
function writeFixture(root: string): void {
  const sources = {
    // One anchor, one class, nothing else: the shape 59 real definitions have.
    'link-classy-v1': {
      html: '<section class="lc"><a class="lc__cta" data-block-id="cta" data-editable="link" href="#next">go</a></section>',
      css: '.lc{padding:1rem}.lc__cta{color:#111}',
    },
    // An anchor that opens a new tab, which needs two attributes rather than one.
    'link-external-v1': {
      html: '<section class="le"><a class="le__cta" data-block-id="out" data-editable="link" href="https://example.test/" rel="noopener noreferrer" target="_blank">go</a></section>',
      css: '.le{padding:1rem}.le__cta{color:#111}',
    },
    // An image with the full V1 loading bundle. Five attributes, and no proper
    // subset of them clears this definition.
    'image-sized-v1': {
      html: '<section class="is"><img alt="A" class="is__img" data-block-id="pic" data-editable="image" decoding="async" height="600" loading="lazy" src="/i/a.png" width="800"></section>',
      css: '.is{padding:1rem}.is__img{display:block}',
    },
    // Two copies of one card. `alt` changes with the index; `class` does not,
    // even though it contains a digit.
    'repeat-cards-v1': {
      html:
        '<section class="rc">' +
        '<img alt="Card 1" class="ring-1" data-block-id="card-1-image" data-editable="image" src="/i/1.png">' +
        '<img alt="Card 2" class="ring-1" data-block-id="card-2-image" data-editable="image" src="/i/2.png">' +
        '</section>',
      css: '.rc{padding:1rem}',
    },
    // An inline declaration list, which no allowlist should ever accept.
    'image-styled-v1': {
      html: '<section class="iy"><img alt="B" data-block-id="bg" data-editable="image" src="/i/b.png" style="object-position: center center;"></section>',
      css: '.iy{padding:1rem}',
    },
    // A class list the schema grammar rejects, so allowing `class` does not
    // clear this one and an unlock estimate must not count it.
    'link-utility-v1': {
      html: '<section class="lu"><a class="px-4 sm:px-6" data-block-id="util" data-editable="link" href="#top">go</a></section>',
      css: '.lu{padding:1rem}',
    },
    // An editable region inside another. The converter refuses it before it ever
    // reaches the inner anchor's attributes, so the loss is present and the code
    // is not.
    'nested-region-v1': {
      html:
        '<section class="nr"><div class="nr__body" data-block-id="body" data-editable="richtext">' +
        '<a class="nr__cta" data-block-id="inner" data-editable="link" href="#x">go</a></div></section>',
      css: '.nr{padding:1rem}',
    },
  }
  const registry = [
    {
      source: 'git',
      id: 'link-classy-v1',
      name: 'Link',
      category: 'Content',
      version: 1,
      slots: [{ blockId: 'cta', editable: 'link', label: 'CTA' }],
    },
    {
      source: 'git',
      id: 'link-external-v1',
      name: 'External',
      category: 'Content',
      version: 1,
      slots: [{ blockId: 'out', editable: 'link', label: 'Outbound' }],
    },
    {
      source: 'git',
      id: 'image-sized-v1',
      name: 'Image',
      category: 'Media',
      version: 1,
      slots: [{ blockId: 'pic', editable: 'image', label: 'Picture' }],
    },
    {
      source: 'git',
      id: 'repeat-cards-v1',
      name: 'Cards',
      category: 'Media',
      version: 1,
      slots: [
        { blockId: 'card-1-image', editable: 'image', label: 'First' },
        { blockId: 'card-2-image', editable: 'image', label: 'Second' },
      ],
    },
    {
      source: 'git',
      id: 'image-styled-v1',
      name: 'Styled',
      category: 'Media',
      version: 1,
      slots: [{ blockId: 'bg', editable: 'image', label: 'Background' }],
    },
    {
      source: 'git',
      id: 'link-utility-v1',
      name: 'Utility',
      category: 'Content',
      version: 1,
      slots: [{ blockId: 'util', editable: 'link', label: 'Utility' }],
    },
    {
      source: 'git',
      id: 'nested-region-v1',
      name: 'Nested',
      category: 'Content',
      version: 1,
      slots: [
        { blockId: 'body', editable: 'richtext', label: 'Body' },
        { blockId: 'inner', editable: 'link', label: 'Inner' },
      ],
    },
  ]

  const admin = path.join(root, 'v1', 'tsa-cms-admin', 'src', 'sections')
  const hni = path.join(root, 'v1', 'tsa-humanneedsindex', 'src', 'cms')
  const census = path.join(root, 'repo', 'docs', 'v1-inventory')
  for (const dir of [admin, hni, census]) mkdirSync(dir, { recursive: true })

  writeFileSync(
    path.join(admin, 'registrySource.generated.js'),
    `export const gitTemplateSources = ${JSON.stringify(sources, null, 2)}\n`,
  )
  writeFileSync(
    path.join(admin, 'registry.generated.js'),
    `export const gitSectionTemplates = ${JSON.stringify(registry, null, 2)}\n`,
  )
  writeFileSync(
    path.join(hni, 'interaction-presets.js'),
    'export const INTERACTION_PRESET_CSS = `\n.fx-lift:hover{transform:translateY(-2px)}\n`\n',
  )
  writeFileSync(
    path.join(census, 'summary.json'),
    `${JSON.stringify(
      {
        divergence: { htmlDivergesAcrossSites: [] },
        crossSectionAnchors: { unresolved: [] },
      },
      null,
      2,
    )}\n`,
  )
}

const root = mkdtempSync(path.join(tmpdir(), 'cms-inventory-'))
writeFixture(root)
const options = { v1Root: path.join(root, 'v1'), repoRoot: path.join(root, 'repo') }

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** One inventory row, by the three things that identify it. */
function row(inventory: FieldAttributeInventory, kind: FieldKind, name: string, shape?: string) {
  return inventory.attributes.find(
    candidate =>
      candidate.fieldKind === kind && candidate.name === name && (shape === undefined || candidate.shape === shape),
  )
}

function definition(inventory: FieldAttributeInventory, id: string) {
  return inventory.definitions.find(candidate => candidate.id === id)!
}

describe('reducing an attribute value to a shape', () => {
  it('counts the tokens in a class list rather than naming any of them', () => {
    expect(valueShape('class', 'one two three')).toBe('class-token-list(3)')
  })

  it('says when a class list is one the schema grammar would refuse', () => {
    expect(valueShape('class', 'px-4 sm:px-6')).toBe('class-token-list(2,non-conforming)')
  })

  it('names an HTML keyword, because a keyword is not V1’s content', () => {
    expect(valueShape('loading', 'lazy')).toBe('enum:lazy')
    expect(valueShape('decoding', 'async')).toBe('enum:async')
    expect(valueShape('target', '_blank')).toBe('enum:_blank')
  })

  it('reports a value outside its attribute’s closed set without quoting it', () => {
    expect(valueShape('loading', 'whenever')).toBe('enum-other')
  })

  it('distinguishes the four kinds of URL a link can hold', () => {
    expect(valueShape('href', '#')).toBe('url-fragment-empty')
    expect(valueShape('href', '#about')).toBe('url-fragment')
    expect(valueShape('href', '/methodology.html')).toBe('url-relative-root')
    expect(valueShape('href', 'https://example.test/')).toBe('url-scheme:https')
  })

  it('counts the declarations in an inline style and reproduces none of them', () => {
    expect(valueShape('style', 'color: red; object-position: center;')).toBe('declaration-list(2)')
  })

  it('reduces prose to the fact that it is prose', () => {
    expect(valueShape('alt', 'A photograph of a volunteer')).toBe('free-text')
    expect(valueShape('alt', '')).toBe('empty')
  })

  it('gives an unrecognised data attribute an opaque shape rather than its value', () => {
    expect(valueShape('data-tone', 'navy')).toBe('opaque-token')
  })
})

describe('what the inventory finds on the field elements', () => {
  const inventory = inventoryFieldAttributes(options)

  it('reads only the elements a link or image field is allowed to be written on', () => {
    // Four anchors and four images, counting the anchor inside the nested
    // region that the converter never descends to.
    expect(inventory.counts.linkFieldElements).toBe(4)
    expect(inventory.counts.imageFieldElements).toBe(4)
  })

  it('treats the URL, the alt text and V1’s region markers as already carried', () => {
    for (const name of ['href', 'data-block-id', 'data-editable']) {
      expect(row(inventory, 'link', name)?.consumedByField, name).toBe(true)
    }
    for (const name of ['src', 'alt', 'data-block-id', 'data-editable']) {
      expect(row(inventory, 'image', name)?.consumedByField, name).toBe(true)
    }
  })

  it('says an intrinsic dimension belongs to the image and not to a wrapper', () => {
    const height = row(inventory, 'image', 'height')!
    expect(height.ownership).toBe('field-element')
    expect(height.effects).toEqual(['layout'])
    expect(height.expressible).toBe(true)
  })

  it('says a loading hint belongs to the image and affects loading alone', () => {
    expect(row(inventory, 'image', 'loading')?.effects).toEqual(['loading'])
    expect(row(inventory, 'image', 'decoding')?.ownership).toBe('field-element')
  })

  it('says target and rel affect navigation and security together', () => {
    expect(row(inventory, 'link', 'target')?.effects).toEqual(['navigation', 'security'])
    expect(row(inventory, 'link', 'rel')?.effects).toEqual(['navigation', 'security'])
  })

  it('notices that a class is one a stylesheet selector depends on', () => {
    const styled = row(inventory, 'link', 'class', 'class-token-list(1)')!
    // Three single-class anchors; two of the three classes are named by their
    // own definition's stylesheet and the third is not.
    expect(styled.occurrences).toBe(3)
    expect(styled.inSelector).toBe(2)
    // Never `wrapper`, however few selectors this importer can see: it reads two
    // stylesheets and the sites render with more.
    expect(styled.wrapperSafe).toBe(false)
  })

  it('marks an in-page href as the source of an anchor relationship', () => {
    expect(row(inventory, 'link', 'href', 'url-fragment')?.anchorRole).toBe('anchor-source')
    expect(row(inventory, 'link', 'href', 'url-scheme:https')?.anchorRole).toBe('none')
  })

  it('refuses an inline style whatever its value, because grammar was never the objection', () => {
    const style = row(inventory, 'image', 'style')!
    expect(style.expressible).toBe(false)
    expect(style.verdict).toBe('quarantine')
  })

  it('reports the attributes it looked for and did not find, so a zero is visible', () => {
    expect(inventory.absent.link).toContain('id')
    expect(inventory.absent.link).toContain('onclick')
    expect(inventory.absent.image).toContain('srcset')
    expect(inventory.absent.image).toContain('aria-label')
  })
})

describe('deciding whether a value depends on which copy it is on', () => {
  const inventory = inventoryFieldAttributes(options)

  it('calls an alt text repeat-indexed when it changes with the index it carries', () => {
    expect(row(inventory, 'image', 'alt', 'free-text')?.bindings).toContain('repeat-indexed')
  })

  it('does not call a utility class repeat-indexed for merely containing a digit', () => {
    // The same value on both copies of the card. An earlier rule looked for the
    // element's own index inside the value and reported `ring-1` on card 1 as a
    // first-of-something; it is a ring width, and it is identical on card 2.
    expect(row(inventory, 'image', 'class', 'class-token-list(1)')?.bindings).toEqual(['static'])
  })

  it('calls V1’s own region markers generated, because a field node re-derives them', () => {
    expect(row(inventory, 'link', 'data-editable')?.bindings).toEqual(['generated'])
    expect(row(inventory, 'image', 'data-block-id')?.bindings).toEqual(['generated'])
  })
})

describe('telling the two attribute reason codes apart', () => {
  const inventory = inventoryFieldAttributes(options)
  const run = runImport(options)

  it('gives field-attributes-lost exactly the definitions the classification run gave it', () => {
    const fromRun = run.records
      .filter(record => record.reasons.some(reason => reason.code === 'field-attributes-lost'))
      .map(record => record.provenance.id)
      .sort()
    const fromInventory = inventory.definitions
      .filter(row => row.fieldAttributesLost)
      .map(row => row.id)
      .sort()
    expect(fromInventory).toEqual(fromRun)
  })

  it('counts the overlap rather than adding the two codes together', () => {
    const counts = inventory.counts
    expect(counts.eitherCode).toBe(counts.fieldAttributesLostCode + counts.unsupportedAttributeCode - counts.bothCodes)
  })

  it('reports a definition whose losses the run never reached, rather than hiding it', () => {
    const nested = definition(inventory, 'nested-region-v1')
    expect(nested.lostOnLink).toEqual(['class'])
    expect(nested.fieldAttributesLost).toBe(false)
    expect(nested.lostButNotCoded).toBe(true)
    expect(nested.reasonCodes).toContain('nested-editable')
  })

  it('separates definitions carrying losses from definitions carrying the code', () => {
    expect(inventory.counts.definitionsWithLoss).toBe(
      inventory.counts.fieldAttributesLostCode + inventory.counts.lostButNotCoded,
    )
  })
})

describe('the allowlist the evidence ranks', () => {
  const inventory = inventoryFieldAttributes(options)

  it('leads with the one attribute that clears the most definitions per attribute', () => {
    const first = inventory.allowlist.link[0]!
    expect(first.added).toEqual(['class'])
    expect(first.newlyCleared).toBe(2)
  })

  it('adds an image’s attributes as the bundle they arrive in, not one at a time', () => {
    // Nothing clears `image-sized-v1` short of all five it carries, so the four
    // remaining after `class` are added in one step. A curve built one name at a
    // time would report four zeroes and then a one, and a reader following it
    // would implement `width` alone and unblock nothing.
    const second = inventory.allowlist.image[1]!
    expect(second.added).toEqual(['decoding', 'height', 'loading', 'width'])
    expect(second.newlyCleared).toBe(1)
  })

  it('never counts a definition whose value the grammar would refuse', () => {
    expect(inventory.allowlist.unclearable).toContain('link-utility-v1')
    expect(inventory.allowlist.unclearable).toContain('image-styled-v1')
    expect(definition(inventory, 'link-utility-v1').clearableByAllowlist).toBe(false)
  })

  it('separates definitions it clears from definitions it unlocks', () => {
    const last = inventory.allowlist.combined[inventory.allowlist.combined.length - 1]!
    expect(last.cumulativeUnlocked).toBeLessThanOrEqual(last.cumulativeCleared)
    // `repeat-cards-v1` is cleared of the attribute problem and still blocked by
    // its hand-flattened repeat, which is the whole shape of the finding.
    expect(definition(inventory, 'repeat-cards-v1').remainingCodes).toEqual(['repeat-family'])
  })

  it('names what one further piece of work would unblock', () => {
    expect(inventory.remainingBlockers).toContainEqual({ code: 'repeat-family', definitions: 1 })
  })
})

describe('running the inventory twice over the same input', () => {
  const first = inventoryFieldAttributes(options)
  const second = inventoryFieldAttributes(options)

  it('produces byte-identical JSON', () => {
    expect(inventoryJson(second)).toBe(inventoryJson(first))
  })

  it('produces byte-identical CSV', () => {
    expect(inventoryCsv(second)).toBe(inventoryCsv(first))
  })

  it('produces a byte-identical Markdown summary', () => {
    expect(inventoryMarkdown(second)).toBe(inventoryMarkdown(first))
  }, 30_000)

  it('names both runs after the same source manifest', () => {
    expect(second.runId).toBe(first.runId)
    expect(second.manifest.sha256).toBe(first.manifest.sha256)
    expect(first.runId).toHaveLength(32)
  })

  it('writes no timestamp into any of the three reports', () => {
    const everything = inventoryJson(first) + inventoryCsv(first) + inventoryMarkdown(first)
    expect(everything).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    expect(everything).not.toMatch(/\b1[6-9]\d{11}\b/)
  })

  it('writes no absolute path into any of the three reports', () => {
    const everything = inventoryJson(first) + inventoryCsv(first) + inventoryMarkdown(first)
    expect(everything).not.toContain(root)
    expect(everything).not.toContain('/Users/')
  })

  it('carries one CSV row per attribute row and one header', () => {
    expect(inventoryCsv(first).trimEnd().split('\n')).toHaveLength(first.attributes.length + 1)
  })
})

// -------------------------------------------------------------- against V1

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// No default path. The V1 checkout is a licensed repository that is not part of
// this one, so this half runs where V1_ROOT says V1 is, skips visibly when no
// V1_ROOT names a path, and fails when one names something that is not a V1
// checkout — the same three routes `catalogue.test.ts` takes, for the same
// reasons, which are written out at the top of that file.
//
// Repeated here rather than shared with it because a test file that imported
// another test file would register that file's suites a second time inside this
// one. The routing is tested there; what is duplicated is the decision, not its
// evidence.
type V1RootProbe = 'catalogue' | 'directory-without-catalogue' | 'nothing'
type V1Source =
  | { kind: 'run'; why: string; v1Root: string }
  | { kind: 'skip'; why: string }
  | { kind: 'fail'; why: string }

function probeV1Root(root: string): V1RootProbe {
  if (existsSync(path.join(root, V1_INPUTS.sources))) return 'catalogue'
  return existsSync(root) ? 'directory-without-catalogue' : 'nothing'
}

function decideV1Source(raw: string | undefined, probe: (root: string) => V1RootProbe): V1Source {
  const given = (raw ?? '').trim()
  if (given === '') {
    return {
      kind: 'skip',
      why: 'V1_ROOT names no path, so the licensed V1 checkout these tests read is not on this machine',
    }
  }
  const found = probe(given)
  if (found === 'catalogue') {
    return { kind: 'run', why: `V1_ROOT names a V1 checkout at ${given}`, v1Root: given }
  }
  return {
    kind: 'fail',
    why:
      found === 'nothing'
        ? `V1_ROOT is set to ${given}, and there is nothing at that path`
        : `V1_ROOT is set to ${given}, which exists but holds no ${V1_INPUTS.sources}`,
  }
}

const source = decideV1Source(process.env['V1_ROOT'], probeV1Root)
const withCatalogue = source.kind === 'run' ? describe : describe.skip

/** The suite name a reader sees. A suite that is not running says why in its own name. */
function about(name: string): string {
  return source.kind === 'run' ? name : `${name} [skipped: ${source.why}]`
}

if (source.kind === 'fail') {
  const { why } = source
  describe('the V1 checkout that V1_ROOT names', () => {
    it('holds the generated catalogue this inventory reads', () => {
      // A failure and not a skip: nobody sets V1_ROOT by accident, so a value
      // naming the wrong place is a mistake to fix rather than an absence to
      // route around.
      throw new Error(
        `${why}. Point V1_ROOT at a V1 checkout, or set V1_ROOT to an empty ` +
          'value to skip these suites and run everything else.',
      )
    })
  })
}

let inventoryMemo: FieldAttributeInventory | undefined
let runMemo: ImportRun | undefined

/**
 * Read the V1 inventory the first time a test asks, and never at collection time.
 *
 * `describe.skip` still evaluates its callback to collect the names of the tests
 * it is skipping, so a describe body that called `inventoryFieldAttributes`
 * would read a licensed checkout that is not there on most machines. Both
 * accessors below throw rather than hand back a placeholder.
 */
function realInventory(): FieldAttributeInventory {
  inventoryMemo ??= freshInventory()
  return inventoryMemo
}

/** An inventory of its own, for the tests that compare one against another. */
function freshInventory(): FieldAttributeInventory {
  return inventoryFieldAttributes(realOptions())
}

/** The classification run over the same catalogue, shared by the tests that check both. */
function realRun(): ImportRun {
  runMemo ??= runImport(realOptions())
  return runMemo
}

function realOptions(): { v1Root: string; repoRoot: string } {
  if (source.kind !== 'run') {
    throw new Error(`a test asked to read the V1 catalogue where there is none: ${source.why}`)
  }
  return { v1Root: source.v1Root, repoRoot: REPO_ROOT }
}

withCatalogue(about('the inventory over all 118 V1 definitions'), () => {
  it('reads the same 118 definitions the classification run reads', () => {
    expect(realInventory().counts.definitions).toBe(118)
    // This first lazy read compiles all 118 definitions and their CSS.
  }, 30_000)

  it('agrees with the classification run about every field-attributes-lost definition', () => {
    const fromRun = realRun()
      .records.filter(record => record.reasons.some(reason => reason.code === 'field-attributes-lost'))
      .map(record => record.provenance.id)
      .sort()
    expect(
      realInventory()
        .definitions.filter(row => row.fieldAttributesLost)
        .map(row => row.id)
        .sort(),
    ).toEqual(fromRun)
    // 77 while a field node had no attributes at all; 17 since schema v2 gave it
    // a governed static set. The inventory still measures the v1 loss — that is
    // the evidence ADR 0008 was argued from — so this is deliberately not 77 and
    // deliberately not equal to the inventory's own loss count either.
    expect(fromRun).toHaveLength(17)
  })

  it('still finds the v1 losses the converter now carries, and calls them uncoded', () => {
    // The gap between the two numbers, stated so that nobody reads the 17 above
    // as "only 17 definitions ever had a field attribute". 87 definitions carry
    // an attribute a v1 field node could not hold; 70 of them are now carried by
    // a v2 one and so no longer coded.
    const counts = realInventory().counts
    expect(counts.definitionsWithLoss).toBe(87)
    expect(counts.lostButNotCoded).toBe(counts.definitionsWithLoss - counts.fieldAttributesLostCode)
    expect(counts.lostButNotCoded).toBe(70)
  })

  it('predicted the unlock the converter delivered, and names the one it over-counted', () => {
    // The Phase I allowlist ranking is a prediction made before the v2 grammar
    // existed, and this is the one place it is held against the run that
    // followed. `remainingBlockers` said what the rest would be left waiting on,
    // and the run's own sole-reason table still says the same.
    //
    // `cumulativeUnlocked` is recomputed from the live converter on every run
    // rather than frozen, so what moved it is a converter rule and not an edit
    // to a fixture: `hni-hero-v1` used to be blocked by `field-attributes-lost`
    // alone, and is now refused by `text-region-markup` instead, which no
    // attribute allowlist reaches.
    //
    // Both halves are asserted because the interesting claim is the second one.
    // An allowlist can only ever predict what a *blocker table* would stop
    // blocking, and "nothing blocks it" is not the same claim as "it converts
    // faithfully" — a browser parity run is what found that definition
    // rendering thirteen elements where V1 renders fifteen, over a `<br>` and an
    // `<em>` inside a plain-text region. Pinning the two named definitions that
    // did convert, and the one that did not with the reason it did not, keeps
    // that distinction visible in the test rather than only in a report.
    const inventory = realInventory()
    const best = inventory.allowlist.combined[inventory.allowlist.combined.length - 1]!
    // Source-owned preset CSS now unblocks urgent-appeal-v1 as well. This is
    // not permission to accept HNI's still-unmapped text-region markup. Since
    // October 5 a comment inside a CSS rule is no longer reported as a dropped
    // rule, which unblocks campaign-progress-v1 and financial-transparency-v1.
    expect(best.cumulativeUnlocked).toBe(5)

    const automatic = new Set(
      realRun()
        .records.filter(record => record.status === 'automatic')
        .map(record => record.provenance.id),
    )
    expect(automatic.has('cta-band-v1')).toBe(true)
    expect(automatic.has('hero-centered-v1')).toBe(true)
    expect(automatic.has('urgent-appeal-v1')).toBe(true)
    expect(automatic.has('campaign-progress-v1')).toBe(true)
    expect(automatic.has('financial-transparency-v1')).toBe(true)
    expect(automatic.has('hni-hero-v1')).toBe(false)
    const overCounted = realRun().records.find(record => record.provenance.id === 'hni-hero-v1')!
    expect(overCounted.reasons.map(reason => reason.code)).toEqual(['text-region-markup'])

    const sole = new Map(realRun().counts.soleReason.map(row => [row.code, row.definitions]))
    // Only the codes the prediction names, and only the definitions the
    // prediction was about: a code can also be somebody else's sole reason for
    // reasons that have nothing to do with attributes, which is why this asks
    // that the predicted number be *reached* rather than exactly matched.
    for (const blocker of inventory.remainingBlockers) {
      expect(sole.get(blocker.code) ?? 0, blocker.code).toBeGreaterThanOrEqual(blocker.definitions)
    }
    expect(sole.get('field-attributes-lost') ?? 0).toBe(0)
  })

  it('shares its run ID with the classification run, because both read one manifest', () => {
    expect(realInventory().runId).toBe(realRun().runId)
  })

  it('reports the two codes with their overlap removed rather than added together', () => {
    const counts = realInventory().counts
    expect(counts.bothCodes).toBeGreaterThan(0)
    expect(counts.eitherCode).toBe(counts.fieldAttributesLostCode + counts.unsupportedAttributeCode - counts.bothCodes)
    expect(counts.eitherCode).toBeLessThan(counts.fieldAttributesLostCode + counts.unsupportedAttributeCode)
  })

  it('finds every link and image field written on the element its type requires', () => {
    expect(realInventory().counts.linkFieldElements).toBe(240)
    expect(realInventory().counts.imageFieldElements).toBe(86)
  })

  it('finds no id, no aria and no event handler on any field element', () => {
    for (const name of ['id', 'onclick', 'aria-label']) {
      expect(realInventory().absent.link, name).toContain(name)
      expect(realInventory().absent.image, name).toContain(name)
    }
  })
})

withCatalogue(about('the inventory reports over the real catalogue'), () => {
  it('are byte-identical across two runs of all 118', () => {
    // Two inventories, not one reported twice: the claim is about a second read
    // of the same input, which the shared memoized one cannot make.
    const first = freshInventory()
    const second = freshInventory()
    expect(inventoryJson(second)).toBe(inventoryJson(first))
    expect(inventoryCsv(second)).toBe(inventoryCsv(first))
    expect(inventoryMarkdown(second)).toBe(inventoryMarkdown(first))
  })

  it('contain no V1 markup, no V1 stylesheet, no V1 class name and no V1 copy', () => {
    const first = realInventory()
    const everything = inventoryJson(first) + inventoryCsv(first) + inventoryMarkdown(first)
    // The same needles `catalogue.test.ts` uses, plus a class name: this module
    // reads class attributes, and a shape that leaked one would be the easiest
    // licensing mistake in the package to make.
    expect(everything).not.toContain('<section')
    expect(everything).not.toContain('cms-section-hero-split')
    expect(everything).not.toContain('cms-cta')
    expect(everything).not.toContain('--section-pad')
    expect(everything).not.toContain('Build a focused page opening')
  })

  it('names an attribute value only when it is a keyword from the HTML specification', () => {
    const shapes = new Set(realInventory().attributes.map(row => row.shape))
    for (const shape of shapes) {
      if (!shape.startsWith('enum:')) continue
      expect([
        'enum:lazy',
        'enum:eager',
        'enum:async',
        'enum:sync',
        'enum:auto',
        'enum:high',
        'enum:low',
        'enum:_blank',
        'enum:_self',
      ]).toContain(shape)
    }
  })
})
