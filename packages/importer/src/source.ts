// What this importer reads, and how a run gets its name.
//
// Reading only. Nothing in this package opens a V1 path for writing, there is no
// mode that does. Source reads resolve contained regular files before reading;
// reports are written separately to caller-selected output directories.
//
// The other job here is the run ID. A run that cannot be named by its inputs
// cannot be compared to the run before it: "the counts changed" is either a
// finding about the catalogue or an artefact of a different input set, and
// without a manifest there is no way to tell which. So every byte this importer
// reads is hashed, the hashes are listed in a fixed order, and the run ID is a
// hash of that list plus the importer's own version.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { containedFile } from './backup.ts'
import { readSiteVariants, type V1SiteVariant, type VariantCensus } from './site-variants.ts'
import { IMPORTER_VERSION } from './version.ts'

/** The V1 registry files this importer reads, relative to the V1 root. */
export const V1_INPUTS = {
  /** Canonical html + css per definition id, deduped across the three sites. */
  sources: 'tsa-cms-admin/src/sections/registrySource.generated.js',
  /** Metadata and declared slots per definition id. No markup. */
  registry: 'tsa-cms-admin/src/sections/registry.generated.js',
  /** The stylesheet V1 injects once per page and no definition carries. */
  presets: 'tsa-humanneedsindex/src/cms/interaction-presets.js',
} as const

/**
 * The committed census, read from this repository rather than from V1.
 *
 * The census records divergent source-site markup and unresolved anchors.
 * Divergent declarations are now read from each original site module as literal
 * data and checked against its census hash, preserving every site variant.
 * Both the census and the exact source modules enter the run manifest.
 */
export const CENSUS_INPUT = 'docs/v1-inventory/summary.json'

export type SourceFile = {
  /** Relative to its root. Absolute paths never enter a report or a run ID. */
  path: string
  sha256: string
  bytes: number
  /** How many lines the file has, so a provenance line can be sanity-checked. */
  lines: number
}

export type V1Definition = {
  id: string
  name: string
  category: string
  family: string | null
  /** The three-site classification the registry records via its `sites` field. */
  sites: string[] | null
  slots: V1Slot[]
  html: string
  css: string
  /** Where the canonical html for this id sits, relative to the V1 root. */
  sourcePath: string
  /** 1-based line of this id's entry in that file. */
  sourceLine: number
  htmlSha256: string
  cssSha256: string
}

export type V1Slot = { blockId: string; editable: string; label: string; role: string | null }

export type SourceManifest = {
  /** Every file read, sorted by path, so the list itself has no ordering slack. */
  files: SourceFile[]
  /** sha256 over the file list. Names the inputs and nothing else. */
  sha256: string
}

export type V1Catalogue = {
  definitions: V1Definition[]
  /** Explicit destination-specific declarations; parent registry identities stay stable. */
  siteVariants: V1SiteVariant[]
  manifest: SourceManifest
  runId: string
  /** Class names INTERACTION_PRESET_CSS defines, sorted. */
  presetClasses: string[]
  /** Source-owned constant, never evaluated as JavaScript. Hashed in manifest. */
  presetCss: string
  /** Definition ids whose markup differs between the sites declaring it. */
  divergingIds: string[]
  /** Definition id → the anchors it links to that nothing in the catalogue provides. */
  unresolvedAnchors: Map<string, string[]>
}

export type ReadOptions = {
  /** The V1 checkout. Read-only; this package never writes below it. */
  v1Root: string
  /** This repository, for the committed census. */
  repoRoot: string
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function describe(root: string, relative: string, text: string): SourceFile {
  return {
    path: relative,
    sha256: sha256(text),
    bytes: Buffer.byteLength(text),
    // Counted, not guessed. A file with no trailing newline has one more line
    // than it has newlines, and a provenance line pointing past the end of a
    // file is worse than no provenance at all.
    lines: text.length === 0 ? 0 : text.split('\n').length,
  }
}

/**
 * The JSON payload a generated V1 module exports.
 *
 * These two files are generated, and generated in a shape that is a JSON literal
 * with an `export const` bolted on the front. Slicing that prefix off and
 * handing the rest to `JSON.parse` is the whole reader — which is the point:
 * evaluating the module instead would run V1 code to read V1 data, and "we only
 * read it" would stop being true in the way that matters.
 */
function readGeneratedJson(text: string, declaration: string, where: string): unknown {
  const marker = `export const ${declaration} = `
  const at = text.indexOf(marker)
  if (at === -1) throw new Error(`${where} does not export ${declaration} in the generated shape`)
  const body = text.slice(at + marker.length).trim()
  try {
    return JSON.parse(body)
  } catch (error) {
    throw new Error(`${where} does not hold a JSON literal after ${declaration}: ${(error as Error).message}`)
  }
}

/**
 * The 1-based line each definition's entry starts on, in the generated sources
 * file.
 *
 * Found by scanning for the quoted key at the start of a line, which is the
 * shape the generator emits and the only shape this looks for. A key that is not
 * found produces line 0 rather than a guess — provenance that points at the
 * wrong line is a worse artefact than provenance that admits it has none.
 */
function lineIndex(text: string, ids: readonly string[]): Map<string, number> {
  const lines = text.split('\n')
  const wanted = new Map(ids.map(id => [`"${id}": {`, id]))
  const found = new Map<string, number>()
  for (let i = 0; i < lines.length; i += 1) {
    const key = lines[i]!.trim()
    const id = wanted.get(key)
    if (id !== undefined && !found.has(id)) found.set(id, i + 1)
  }
  for (const id of ids) if (!found.has(id)) found.set(id, 0)
  return found
}

/**
 * Every class name INTERACTION_PRESET_CSS defines, found in selector position.
 *
 * Selector position specifically. Scanning the whole stylesheet for `.name`
 * finds `transition: color .2s` and reports `color` as a preset class, which
 * would then make every definition that sets a colour look like a dependant of a
 * stylesheet it has never heard of.
 */
export function presetClassNames(source: string, parseCss: (css: string) => string[]): string[] {
  return [...new Set(parseCss(presetStylesheet(source)))].sort()
}

export function presetStylesheet(source: string): string {
  const marker = 'export const INTERACTION_PRESET_CSS = `'
  const at = source.indexOf(marker)
  if (at === -1) throw new Error('interaction-presets.js does not export INTERACTION_PRESET_CSS')
  const from = at + marker.length
  // The template literal ends at the first unescaped backtick. V1's stylesheet
  // contains neither an escaped backtick nor a `${}` substitution, and a
  // substitution would mean the stylesheet is not a constant — so finding one is
  // a reason to stop rather than to interpolate something.
  const to = source.indexOf('`', from)
  if (to === -1) throw new Error('INTERACTION_PRESET_CSS is never closed')
  const css = source.slice(from, to)
  if (css.includes('${')) throw new Error('INTERACTION_PRESET_CSS is not a constant stylesheet')
  // A JavaScript escape and its literal source bytes are different CSS. This
  // reader does not evaluate source modules or guess at template semantics.
  if (css.includes('\\')) throw new Error('INTERACTION_PRESET_CSS contains an unsupported JavaScript escape')
  // The source-owned export is the terminal statement in this module. A
  // concatenation or later mutation would make these bytes only a prefix of
  // the runtime stylesheet. Refuse an unfamiliar module shape rather than
  // executing it or claiming that prefix is the complete dependency.
  if (!/^\s*;?\s*$/.test(source.slice(to + 1))) {
    throw new Error('INTERACTION_PRESET_CSS is not a terminal constant stylesheet')
  }
  return css
}

/**
 * Read the catalogue.
 *
 * `parseCss` is passed in rather than imported so this module stays the one that
 * only reads files; it is the selector reader from `presets.ts` in every real
 * call.
 */
export function readV1Catalogue(options: ReadOptions, parseCss: (css: string) => string[]): V1Catalogue {
  const files: SourceFile[] = []

  const read = (root: string, relative: string): string => {
    const text = readFileSync(containedFile(root, relative), 'utf8')
    files.push(describe(root, relative, text))
    return text
  }

  const sourcesText = read(options.v1Root, V1_INPUTS.sources)
  const registryText = read(options.v1Root, V1_INPUTS.registry)
  const presetsText = read(options.v1Root, V1_INPUTS.presets)
  const censusText = read(options.repoRoot, CENSUS_INPUT)

  const sources = readGeneratedJson(sourcesText, 'gitTemplateSources', V1_INPUTS.sources) as Record<
    string,
    { html?: unknown; css?: unknown }
  >
  const registry = readGeneratedJson(registryText, 'gitSectionTemplates', V1_INPUTS.registry) as Record<
    string,
    unknown
  >[]
  const census = JSON.parse(censusText) as {
    divergence?: { htmlDivergesAcrossSites?: VariantCensus[] }
    crossSectionAnchors?: { unresolved?: { from?: unknown; anchor?: unknown }[] }
  }

  const ids = registry.map(entry => String(entry['id'] ?? '')).filter(id => id !== '')
  if (ids.length !== registry.length) throw new Error('a registry entry has no id')
  const lines = lineIndex(sourcesText, ids)

  const definitions: V1Definition[] = registry.map(entry => {
    const id = String(entry['id'])
    const source = sources[id]
    if (source === undefined) throw new Error(`${id} is in the registry but has no markup in the sources file`)
    const html = String(source.html ?? '')
    const css = String(source.css ?? '')
    const slots = (Array.isArray(entry['slots']) ? entry['slots'] : []).map((raw): V1Slot => {
      const slot = raw as Record<string, unknown>
      return {
        blockId: String(slot['blockId'] ?? ''),
        editable: String(slot['editable'] ?? ''),
        label: String(slot['label'] ?? ''),
        role: typeof slot['role'] === 'string' ? slot['role'] : null,
      }
    })
    return {
      id,
      name: String(entry['name'] ?? ''),
      category: String(entry['category'] ?? ''),
      family: typeof entry['family'] === 'string' ? entry['family'] : null,
      sites: Array.isArray(entry['sites']) ? entry['sites'].map(String) : null,
      slots,
      html,
      css,
      sourcePath: V1_INPUTS.sources,
      sourceLine: lines.get(id) ?? 0,
      htmlSha256: sha256(html),
      cssSha256: sha256(css),
    }
  })
  // The registry's own order is a generator's output and this importer should
  // not inherit it. Sorted by id, once, so every downstream list — the report,
  // the CSV, the summary — is in the same order without each of them having to
  // remember to sort.
  definitions.sort((a, b) => a.id.localeCompare(b.id, 'en'))

  const divergingIds = [...new Set((census.divergence?.htmlDivergesAcrossSites ?? []).map(row => String(row.id ?? '')))]
    .filter(id => id !== '')
    .sort((a, b) => a.localeCompare(b, 'en'))

  const unresolvedAnchors = new Map<string, string[]>()
  for (const edge of census.crossSectionAnchors?.unresolved ?? []) {
    const from = String(edge.from ?? '')
    const anchor = String(edge.anchor ?? '')
    if (from === '' || anchor === '') continue
    const list = unresolvedAnchors.get(from) ?? []
    if (!list.includes(anchor)) list.push(anchor)
    unresolvedAnchors.set(from, list)
  }
  for (const [, list] of unresolvedAnchors) list.sort((a, b) => a.localeCompare(b, 'en'))

  const siteVariants = readSiteVariants(census.divergence?.htmlDivergesAcrossSites ?? [], definitions, relative =>
    read(options.v1Root, relative),
  )

  files.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  const manifest: SourceManifest = {
    files,
    // Over the descriptions rather than over the contents, so the manifest and
    // the hash it produces are checkable against each other by reading them.
    sha256: sha256(JSON.stringify(files)),
  }

  return {
    definitions,
    siteVariants,
    manifest,
    runId: sha256(`${manifest.sha256}:${IMPORTER_VERSION}`).slice(0, 32),
    presetClasses: presetClassNames(presetsText, parseCss),
    presetCss: presetStylesheet(presetsText),
    divergingIds,
    unresolvedAnchors,
  }
}
