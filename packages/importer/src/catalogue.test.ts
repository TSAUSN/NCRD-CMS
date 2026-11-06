// The importer against the actual V1 catalogue.
//
// Two things are being checked here that no synthetic fixture can check.
//
// The first is *ground truth*. `quote-v1` was converted by hand into
// `packages/seeds`, node for node, before this package existed. If the importer
// disagrees with that conversion, one of the two is wrong and the interesting
// case is that it is this one — so the comparison is exact rather than
// approximate.
//
// The second is *arithmetic*. `docs/v1-inventory/summary.json` counts several of
// the same facts from a completely different direction: it read three site
// checkouts and a generated manifest, where this package reads two generated
// files and a stylesheet. Where the two agree, the count is worth something.
// Where they disagree, one of them has a bug, and the assertions below are
// written to find out which rather than to pass.
//
// The catalogue is licensed source that lives outside this repository, so what
// happens without it is a routing decision with three answers, made once in
// `decideV1Source` and tested like any other function here. No V1_ROOT means the
// checkout is not on this machine, which is the ordinary case everywhere but one
// laptop: the suites skip, carrying the reason in their names. A V1_ROOT that
// names something other than a V1 checkout means somebody asked for these tests
// and got the path wrong: that fails, because skipping it is how a CI job goes
// green having tested nothing. A V1_ROOT that names a checkout runs all of it.
//
// Nothing here reads V1 while suites are being collected. `describe.skip` still
// evaluates its callback — that is how it learns the names of the tests it is
// skipping — so a describe body that called `runImport` would read the catalogue
// on every machine that has none. An earlier attempt guarded that with
// `present ? runImport(…) : (null as never)`, which told the type system a lie
// and then crashed at collection when a body dereferenced the placeholder. The
// run is now reached only through `catalogue()`, from inside a test, or not at
// all.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  STRUCTURED_IMAGE_STATIC_ATTRIBUTES,
  STRUCTURED_LINK_STATIC_ATTRIBUTES,
  STRUCTURED_SCHEMA_VERSION,
  isStructuredStaticAttributeValue,
  structuredFieldNodes,
} from '@cms/schema'
import {
  renderStructuredBody,
  sectionScopeSelector,
  structuredSectionProblems,
  validateCompiledCss,
} from '@cms/renderer'
import { SEED_SECTION_DEFS } from '@cms/seeds'
import { reportCsv, reportJson, reportSummary } from './report.ts'
import { V1_INPUTS } from './source.ts'
import { runImport, type ImportRecord, type ImportRun } from './run.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** What a candidate V1 root turned out to be. */
type V1RootProbe = 'catalogue' | 'directory-without-catalogue' | 'nothing'

/**
 * What this file does about it: exactly one of three things, and never a fourth.
 *
 * Every route carries its reason, including the one that runs, so that the
 * decision can always be quoted — into a suite name, into a failure, or into the
 * error thrown at a test that asks for a catalogue this machine has not got.
 */
type V1Source =
  | { kind: 'run'; why: string; v1Root: string }
  | { kind: 'skip'; why: string }
  | { kind: 'fail'; why: string }

/**
 * The one filesystem question this gate asks, kept apart from the decision it
 * feeds so the decision can be tested on a machine that has no V1 checkout —
 * which is every machine but one.
 */
function probeV1Root(root: string): V1RootProbe {
  // The same generated file the reader opens first, named from `V1_INPUTS` so
  // the gate cannot drift from what `readV1Catalogue` actually needs.
  if (existsSync(path.join(root, V1_INPUTS.sources))) return 'catalogue'
  return existsSync(root) ? 'directory-without-catalogue' : 'nothing'
}

/**
 * Absence, mistake, or catalogue.
 *
 * Absence is a skip: V1 is licensed source that is not part of this repository,
 * and a suite that failed without it would fail everywhere but one laptop. A
 * V1_ROOT that names the wrong place is not absence — somebody set it meaning to
 * run these tests — so it fails rather than skipping, because a skip there is
 * indistinguishable from a pass in a summary line and is exactly how a CI job
 * stays green while testing nothing.
 */
function decideV1Source(raw: string | undefined, probe: (root: string) => V1RootProbe): V1Source {
  // Trimmed because the value normally arrives from a .env line somebody pasted
  // a path into, and the whitespace around it was never part of the path.
  const given = (raw ?? '').trim()
  if (given === '') {
    // An empty value is absence stated out loud rather than a wrong path: it is
    // how a machine says "V1 is not here" when the repository .env — which this
    // package's vitest config loads — names a checkout that this machine or this
    // CI runner does not have.
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
    it('holds the generated catalogue these tests read', () => {
      // Deliberately a failure and not a skip. Nobody sets V1_ROOT by accident,
      // so a value that names the wrong place is a broken machine or a broken
      // CI job, and the run should go red saying which and what to do about it.
      throw new Error(
        `${why}. Point V1_ROOT at a V1 checkout, or set V1_ROOT to an empty ` +
          'value to skip these suites and run everything else.',
      )
    })
  })
}

let memo: ImportRun | undefined

/**
 * The import run the suites below share, made the first time a test asks for it.
 *
 * Lazy because collection must not read V1: see the note at the top of this
 * file. Memoized because four suites want the same run over the same 118
 * definitions and reading them is the expensive part of this file — the two runs
 * that have to be independent to prove anything ask `freshCatalogue` instead.
 */
function catalogue(): ImportRun {
  memo ??= freshCatalogue()
  return memo
}

/** A run of its own, for the two tests that compare one run against another. */
function freshCatalogue(): ImportRun {
  if (source.kind !== 'run') {
    throw new Error(`a test asked to read the V1 catalogue where there is none: ${source.why}`)
  }
  return runImport({ v1Root: source.v1Root, repoRoot: REPO_ROOT })
}

const census = JSON.parse(readFileSync(path.join(REPO_ROOT, 'docs/v1-inventory/summary.json'), 'utf8')) as Record<
  string,
  any
>

/** How many definitions carry this reason code. */
function definitionsWith(run: ImportRun, code: string): number {
  return run.records.filter(record => record.reasons.some(reason => reason.code === code)).length
}

/** Every definition the run converted, which is what one suite below is entirely about. */
function automatic(): ImportRecord[] {
  return catalogue().records.filter(record => record.status === 'automatic')
}

/** The importer's `quote-v1`, against which the hand conversion is held. */
function quoteRecord(): ImportRecord {
  const record = catalogue().records.find(candidate => candidate.provenance.id === 'quote-v1')
  if (record === undefined) throw new Error('quote-v1 is no longer in the V1 catalogue')
  return record
}

/** The hand conversion of that same definition, committed in @cms/seeds. */
function quoteSeed() {
  const seed = SEED_SECTION_DEFS.find(def => def.slug === 'quote')
  if (seed === undefined) throw new Error('the quote seed is no longer in @cms/seeds')
  if (seed.kind !== 'structured') throw new Error('the quote seed is no longer structured')
  return seed
}

// ------------------------------------------------------------- the gate itself

// These run everywhere, including on a machine that has never seen V1: the
// decision takes its filesystem answer as an argument, so all three routes are
// reachable from a test rather than only from the machine that happens to be
// running it.
describe('deciding what a V1_ROOT means before anything opens a file', () => {
  const probeFinding = (found: V1RootProbe) => () => found

  it('skips, saying why, when V1_ROOT is not set at all', () => {
    const decided = decideV1Source(undefined, probeFinding('nothing'))
    expect(decided.kind).toBe('skip')
    expect(decided.why).toContain('V1_ROOT')
    expect(decided.why).toContain('not on this machine')
  })

  it('reads an empty V1_ROOT as absence, which is how a machine overrides a .env that names V1', () => {
    expect(decideV1Source('', probeFinding('nothing')).kind).toBe('skip')
    expect(decideV1Source('   ', probeFinding('nothing')).kind).toBe('skip')
  })

  it('fails rather than skipping when V1_ROOT names a path that is not there', () => {
    const decided = decideV1Source('/nowhere/v1-checkout', probeFinding('nothing'))
    expect(decided.kind).toBe('fail')
    expect(decided.why).toContain('/nowhere/v1-checkout')
    expect(decided.why).toContain('nothing at that path')
  })

  it('fails when the path is there but holds no generated catalogue', () => {
    const decided = decideV1Source('/somewhere/else', probeFinding('directory-without-catalogue'))
    expect(decided.kind).toBe('fail')
    // The message names the file that is missing, because "wrong path" and
    // "right path, wrong checkout" are different mistakes to go and fix.
    expect(decided.why).toContain(V1_INPUTS.sources)
  })

  it('runs against the path it was given once the catalogue is under it', () => {
    expect(decideV1Source('/opt/v1', probeFinding('catalogue'))).toMatchObject({ kind: 'run', v1Root: '/opt/v1' })
  })

  it('ignores the whitespace around a path that was pasted into a .env', () => {
    expect(decideV1Source('  /opt/v1\t', probeFinding('catalogue'))).toMatchObject({ kind: 'run', v1Root: '/opt/v1' })
  })

  it('tells a V1 checkout from a directory and from nothing at all', () => {
    // The probe against a real filesystem rather than against a stand-in, over
    // a directory this test builds into each of the three states in turn. The
    // file it writes is empty: what is being checked is where the gate looks,
    // and nothing here needs — or may hold — a byte of the real catalogue.
    const root = mkdtempSync(path.join(tmpdir(), 'cms-v1-root-'))
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

  it('hands out a run only on the route that has a catalogue to read', () => {
    // Whichever route this machine took. There is no placeholder run to hand
    // back on the other two — the accessor refuses, which is the property the
    // `null as never` this file used to carry was pretending to have.
    if (source.kind === 'run') expect(probeV1Root(source.v1Root)).toBe('catalogue')
    else expect(() => freshCatalogue()).toThrow(/V1 catalogue/)
  })
})

// -------------------------------------------------------------- against V1

withCatalogue(about('the importer over all 118 V1 definitions'), () => {
  it('reads every definition the committed census counted', () => {
    expect(catalogue().records).toHaveLength(census['totals'].dedupedDefinitions)
    expect(catalogue().records).toHaveLength(118)
    // Compiling the entire licensed catalogue and source-owned CSS is a
    // correctness gate, not a five-second benchmark on a shared CI worker.
  }, 30_000)

  it('gives every definition exactly one status', () => {
    const { automatic: converted, quarantined } = catalogue().counts.byStatus
    expect(converted + quarantined + catalogue().counts.byStatus['manual-decision']).toBe(118)
  })

  it('agrees with the census about how many definitions declare an icon slot', () => {
    expect(definitionsWith(catalogue(), 'icon-field')).toBe(32)
  })

  it('agrees with the census about how many have a hand-flattened repeated unit', () => {
    expect(definitionsWith(catalogue(), 'repeat-family')).toBe(56)
  })

  it('agrees with the census about how many borrow from INTERACTION_PRESET_CSS', () => {
    expect(catalogue().records.filter(record => record.conversion.measurements.borrowedClasses.length > 0).length).toBe(
      census['externalStylesheetDependency'].definitionsRelyingOnIt,
    )
  })

  it('agrees with the census about forms, iframes and buttons', () => {
    expect(definitionsWith(catalogue(), 'form-element')).toBe(census['activeContent'].withForm.length)
    expect(definitionsWith(catalogue(), 'embed-element')).toBe(census['activeContent'].withIframe.length)
    expect(definitionsWith(catalogue(), 'button-element')).toBe(census['activeContent'].withButton.length)
  })

  it('agrees with the census about which definitions diverge between sites', () => {
    expect(definitionsWith(catalogue(), 'site-divergence')).toBe(census['divergence'].htmlDivergesAcrossSites.length)
  })

  it('finds no slot that is declared without a region, exactly as the census found none', () => {
    expect(census['slotIntegrity'].slotsDeclaredButMissingFromHtml).toEqual([])
    expect(definitionsWith(catalogue(), 'slot-integrity')).toBe(0)
  })

  it('reads every definition’s markup, with nothing left unparseable', () => {
    expect(definitionsWith(catalogue(), 'html-parse-failed')).toBe(0)
  })

  it('never reports a mapping bug, which is what document-invalid means', () => {
    const invalid = catalogue().records.filter(record =>
      record.reasons.some(reason => reason.code === 'document-invalid'),
    )
    expect(invalid.map(record => record.provenance.id)).toEqual([])
  })

  it('has field-attributes-lost left on the 17 the v2 static set still cannot hold', () => {
    // 77 before schema v2. What survives is the honest remainder rather than a
    // catch-all: 14 definitions whose anchors carry a `data-*` hook V1's own
    // scripts read, and 3 whose images carry an inline style. Both are refused
    // by ADR 0008 on purpose, so neither number moves without a decision.
    expect(definitionsWith(catalogue(), 'field-attributes-lost')).toBe(17)
  })

  it('names, in every one of those, an attribute the governed set genuinely cannot hold', () => {
    // The accuracy claim, checked rather than asserted in prose. A reason that
    // had become a catch-all would be naming a `class` or a `width` the model
    // now carries perfectly well, and this is what would say so.
    const allowed: Record<string, readonly string[]> = {
      a: STRUCTURED_LINK_STATIC_ATTRIBUTES,
      img: STRUCTURED_IMAGE_STATIC_ATTRIBUTES,
    }
    let checked = 0
    for (const record of catalogue().records) {
      for (const reason of record.reasons) {
        if (reason.code !== 'field-attributes-lost') continue
        const [element, names] = reason.detail!.split(': ')
        for (const entry of names!.split(' ')) {
          checked += 1
          // Either the model has no such name at all, or it has the name and
          // the entry says which of its two value rules refused: `(value)` for
          // the grammar, `(unpaired)` for a lone intrinsic dimension.
          const bare = !entry.includes('(')
          if (bare) expect(allowed[element!], `${record.provenance.id} ${entry}`).not.toContain(entry)
          else expect(entry, record.provenance.id).toMatch(/^[a-z-]+\((value|unpaired)\)$/)
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

withCatalogue(about('every definition the importer calls automatic'), () => {
  it('converted at least one, or this package has proved nothing', () => {
    expect(automatic().length).toBeGreaterThan(0)
  })

  it('converted the twelve whose markup and source styling have a governed mapping', () => {
    // Named rather than counted. A count that moved would be a count somebody
    // updates; a list that moved says which definition changed status and is the
    // first thing to go and look at.
    //
    // Two of the three schema-v2 unlocked — cta-band-v1 and hero-centered-v1 —
    // were blocked by `field-attributes-lost` alone until link and image field
    // nodes could carry a class list and an image's intrinsic dimensions. The
    // third, hni-hero-v1, is deliberately *not* here: the browser parity harness
    // found it rendering thirteen elements where V1 renders fifteen, because its
    // subtitle region is declared `text` and holds a `<br>` and an `<em>`, and
    // the converter now refuses that shape rather than claiming it.
    //
    // The five dividers turn on `data-cms-section` alone — V1 authoring
    // metadata that v2 re-derives, consumed rather than refused (ADR 0009).
    //
    // campaign-progress-v1 and financial-transparency-v1 joined on October 5:
    // their only obstacle was a comment inside a CSS rule, which the section
    // CSS compiler had reported as a dropped nested rule.
    expect(automatic().map(record => record.provenance.id)).toEqual([
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
    ])
  })

  it('produces a document the renderer’s own validator accepts', () => {
    for (const record of automatic()) {
      expect(
        structuredSectionProblems({
          definition_kind: 'structured',
          structured_doc: record.conversion.document,
          structured_schema_version: STRUCTURED_SCHEMA_VERSION,
        }),
        record.provenance.id,
      ).toEqual([])
    }
  })

  it('writes only static attributes the schema’s own predicate accepts, entry by entry', () => {
    // The document validator above already refuses a bad one, so this is the
    // narrower claim underneath it: every key that reached a field node was
    // accepted by the function the database and the renderer both ask, rather
    // than by this package's reading of it. At least one definition has to carry
    // some, or the loop proves nothing by iterating over nothing.
    let carried = 0
    for (const record of automatic()) {
      for (const node of structuredFieldNodes(record.conversion.document!.nodes)) {
        if (node.type !== 'link' && node.type !== 'image') continue
        const staticAttributes = node.staticAttributes
        if (staticAttributes === undefined) continue
        for (const [name, value] of Object.entries(staticAttributes)) {
          expect(
            isStructuredStaticAttributeValue(node.type, name, value),
            `${record.provenance.id} ${node.type} ${name}`,
          ).toBe(true)
          carried += 1
        }
      }
    }
    expect(carried).toBeGreaterThan(0)
  })

  it('produces CSS that validateCompiledCss accepts under that definition’s own scope', () => {
    for (const record of automatic()) {
      const scope = sectionScopeSelector(record.provenance.id)!
      expect(validateCompiledCss(record.conversion.compiledCss!, scope), record.provenance.id).toEqual([])
    }
  })

  it('renders to markup rather than to the null that means "this renders nothing"', () => {
    for (const record of automatic()) {
      const html = renderStructuredBody(
        {
          definition_kind: 'structured',
          structured_doc: record.conversion.document,
          structured_schema_version: STRUCTURED_SCHEMA_VERSION,
        },
        {},
      )
      expect(html, record.provenance.id).not.toBeNull()
      expect(html!.startsWith('<'), record.provenance.id).toBe(true)
    }
  })

  it('carries a render hash, which a quarantined definition never does', () => {
    for (const record of automatic()) expect(record.conversion.renderHash).toMatch(/^[0-9a-f]{32}$/)
    for (const record of catalogue().records.filter(r => r.status !== 'automatic')) {
      expect(record.conversion.renderHash, record.provenance.id).toBeNull()
    }
  })
})

withCatalogue(about('quote-v1, against the conversion that was done by hand'), () => {
  it('converts it, rather than quarantining what somebody already converted', () => {
    expect(quoteRecord().reasons.map(reason => reason.code)).toEqual([])
    expect(quoteRecord().status).toBe('automatic')
  })

  it('produces the same node tree the seed was written with, node for node', () => {
    expect(quoteRecord().conversion.document?.nodes).toEqual(quoteSeed().nodes)
  })

  it('declares the same field names and types the seed declares', () => {
    expect(quoteRecord().conversion.document?.fields.map(field => ({ name: field.name, type: field.type }))).toEqual(
      quoteSeed().fields.map(field => ({ name: field.name, type: field.type })),
    )
  })
})

withCatalogue(about('the reports over the real catalogue'), () => {
  it('are byte-identical across two runs of all 118', () => {
    // Two runs of the importer, not one run reported twice: the claim is that a
    // second read of the same input produces the same bytes, and comparing the
    // shared memoized run against itself would assert only that `toBe` works.
    const first = freshCatalogue()
    const second = freshCatalogue()
    expect(reportJson(second)).toBe(reportJson(first))
    expect(reportCsv(second)).toBe(reportCsv(first))
    expect(reportSummary(second)).toBe(reportSummary(first))
  }, 30_000)

  it('carry one CSV row per definition and one header', () => {
    expect(reportCsv(catalogue()).trimEnd().split('\n')).toHaveLength(119)
  })

  it('contain no V1 markup, no V1 stylesheet and no V1 copy', () => {
    const run = catalogue()
    const everything = reportJson(run) + reportCsv(run) + reportSummary(run)
    // A tag, a declaration block, a CSS custom property, and the first line of
    // the catalogue's own copy. Any of them appearing means a refusal or a
    // measurement started quoting the source it was measuring.
    expect(everything).not.toContain('<section')
    expect(everything).not.toContain('cms-section-hero-split')
    expect(everything).not.toContain('--section-pad')
    expect(everything).not.toContain('Build a focused page opening')
  })
})

withCatalogue(about('destination-specific source variants'), () => {
  it('retains 118 parent identities and accounts separately for all 72 site variants', () => {
    const run = catalogue()
    expect(run.records).toHaveLength(118)
    expect(run.counts.siteVariants).toEqual({
      definitions: 24,
      variants: 72,
      byStatus: { automatic: 32, quarantined: 40, 'manual-decision': 0 },
    })
    for (const parent of run.records.filter(record => record.variants.length)) {
      expect(parent.variants.map(variant => variant.sourceSite)).toEqual([
        'echelonsymposium',
        'humanneedsindex',
        'site-host',
      ])
      expect(parent.conversion.document).toBeNull()
      for (const variant of parent.variants) {
        expect(variant.provenance.sourceFile).toMatch(
          new RegExp(`^tsa-${variant.sourceSite}/src/cms/(section-templates|library-sections)\\.js$`),
        )
        expect(variant.provenance.sourceLine).toBeGreaterThan(0)
        expect(variant.provenance.htmlSha256).toMatch(/^[a-f0-9]{64}$/)
        expect(variant.reasons.map(reason => reason.code)).not.toContain('site-divergence')
      }
    }
  })
  it('distinguishes conversion readiness from source DOM parity', () => {
    const variants = catalogue().records.flatMap(record => record.variants)
    expect(variants.filter(variant => variant.parity.status === 'pass')).toHaveLength(8)
    expect(variants.filter(variant => variant.parity.status === 'different')).toHaveLength(24)
    expect(variants.filter(variant => variant.parity.status === 'not-convertible')).toHaveLength(40)
    for (const variant of variants.filter(variant => variant.status === 'automatic')) {
      const rendered = renderStructuredBody(
        {
          definition_kind: 'structured',
          structured_doc: variant.conversion.document,
          structured_schema_version: STRUCTURED_SCHEMA_VERSION,
        },
        {},
      )
      expect(rendered, `${variant.sourceSite}/${variant.provenance.id}`).not.toBeNull()
      expect(
        validateCompiledCss(variant.conversion.compiledCss!, sectionScopeSelector(variant.provenance.id)!),
      ).toEqual([])
    }
  })
})
