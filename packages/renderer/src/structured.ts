import { StoryCatalog } from '@cms/schema'
import { imageFocusPosition } from '@cms/schema'
// The structured renderer (ADR 0007), beside the frozen interpolation one.
//
// This file serializes a tree. It never concatenates fragments of markup and it
// never reads a stored value as syntax, which is the whole difference from
// render.ts's `renderSlot`: there, a value's sink is a property of a template
// that has to be re-derived by an HTML tokenizer on every render, because the
// template is a string and the value is spliced into it. Here the sink is the
// node. A `text` field is element text because it is a `text` node, and there
// is no arrangement of stored bytes that makes it an attribute name, a tag, or
// a URL — those positions do not accept values at all.
//
// Everything a value passes through on the way out is a policy that already
// existed: `escapeText`, `escapeAttribute`, `sanitizeRichText`, `safeUrl`, and
// `scopeCss`/`validateCompiledCss` for the stylesheet. A second escaper is a
// second thing to get wrong, and ADR 0005 spent four amendments on the first.
import {
  CollectionFields,
  STRUCTURED_LINK_RELS,
  STRUCTURED_MAX_DEPTH,
  STRUCTURED_REPEAT_MAX_ENTRIES,
  STORY_WIDGET_SOURCE_LIMIT,
  STRUCTURED_SCHEMA_VERSION,
  STRUCTURED_SHAPE_CODES,
  StructuredDocument,
  isSectionDefinitionKind,
  isStructuredAttribute,
  isStructuredAttributeValue,
  isStructuredStaticAttributeValue,
  isStructuredVoidTag,
  structuredDepth,
  structuredProblemMessages,
  structuredShapeDefects,
  structuredFieldNodes,
  structuredRepeatItemFieldNodes,
  parseCollectionEntryValues,
  type SectionDefinitionKind,
  type StructuredImageFieldNode,
  type StructuredLinkFieldNode,
  type StructuredLinkRel,
  type StructuredProblem,
  type StructuredFieldNode,
  type StructuredNode,
  type StructuredRepeatFieldNode,
} from '@cms/schema'
import { renderProviderEmbed } from './provider-embed.ts'
import { buttonAppearanceClasses } from './button-appearance.ts'
import { renderCmsIcon } from './icons.ts'
import { sha256Hex } from './sha256.ts'
import { sectionScopeSelector } from './compile.ts'
import { CSS_POLICY_VERSION, scopeCss } from './css.ts'
import { escapeAttribute, escapeText, safeUrl } from './escape.ts'
import { sanitizeRichText } from './richtext.ts'

/** The columns a stored definition carries about which model it is written in. */
export type StructuredDefView = {
  definition_kind?: unknown
  structured_doc?: unknown
  structured_schema_version?: unknown
}

/**
 * Which model this definition is written in, or null when nothing here can say.
 *
 * A missing discriminator reads as `legacy`, and that is not a guess: migration
 * 0019 added the column `NOT NULL DEFAULT 'legacy'` precisely because every row
 * that predates it is one, so absence and `'legacy'` are the same statement made
 * by the same schema. A discriminator that is *present and unrecognised* is the
 * opposite case — a row written by a build that knew something this one does
 * not — and it renders nothing rather than being read by the nearest path that
 * happens to accept it.
 */
export function sectionDefinitionKind(def: StructuredDefView): SectionDefinitionKind | null {
  const kind = def.definition_kind
  if (kind === undefined || kind === null) return 'legacy'
  return isSectionDefinitionKind(kind) ? kind : null
}

/**
 * The stable names for what a stored structured definition can be wrong about.
 *
 * The shape codes plus the ones only a whole row can be guilty of: the shape
 * check is asked about a document, and a document has no row to disagree with
 * and no field declarations to be measured against.
 */
export const STRUCTURED_SECTION_CODES = [
  ...STRUCTURED_SHAPE_CODES,
  'schema-version-unsupported',
  'schema-version-disagrees',
  'node-refused',
  'undeclared-field',
  'field-type-mismatch',
] as const
export type StructuredSectionCode = (typeof STRUCTURED_SECTION_CODES)[number]

/**
 * Everything wrong with a stored structured definition, or an empty list.
 *
 * Two versions are checked, not one. `structured_schema_version` is the column
 * the database vouched for; `schemaVersion` inside the document is what the
 * compiler wrote. Checking only the column trusts a document that could have
 * been swapped underneath it; checking only the document lets a row claim
 * whatever it likes about itself. A row where the two disagree is one somebody
 * rewrote half of, and half a rewrite is the interesting half.
 */
export function structuredSectionDefects(def: StructuredDefView): StructuredProblem<StructuredSectionCode>[] {
  const defect = (code: StructuredSectionCode, message: string) => ({ code, message })
  const version = def.structured_schema_version
  if (version !== STRUCTURED_SCHEMA_VERSION) {
    return [
      defect(
        'schema-version-unsupported',
        `is at structured schema version ${String(version ?? 'unknown')}, ` +
          `but this renderer reads version ${STRUCTURED_SCHEMA_VERSION}`,
      ),
    ]
  }

  // Before Zod, not after. `StructuredDocument` is a recursive schema, so
  // parsing a deeply nested node list overflows the call stack *inside the
  // parse* — and every check that was supposed to catch an oversized document
  // lived after it. The declared maximum depth protected nothing, because
  // reaching it meant surviving the parse it was there to make survivable.
  const shape = structuredShapeDefects(def.structured_doc)
  if (shape.length > 0) return shape

  const parsed = StructuredDocument.safeParse(def.structured_doc)
  if (!parsed.success) {
    return parsed.error.issues.map(issue =>
      defect('node-refused', `${issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}${issue.message}`),
    )
  }
  const document = parsed.data
  if (document.schemaVersion !== version) {
    return [
      defect(
        'schema-version-disagrees',
        `says it is at structured schema version ${document.schemaVersion} ` + `while its row says ${version}`,
      ),
    ]
  }

  const problems: StructuredProblem<StructuredSectionCode>[] = []
  // The preflight already bounded the depth on the raw input. This asks the
  // same question of the parsed tree, because the two are different objects and
  // "the other one was checked" is exactly the assumption this file spent a
  // crash learning not to make. Same convention, same number: node levels, the
  // outermost node at level 1, a field node counting as a level of its own.
  if (structuredDepth(document.nodes) > STRUCTURED_MAX_DEPTH) {
    problems.push(defect('too-deep', `nests deeper than ${STRUCTURED_MAX_DEPTH} levels`))
  }

  // Every field node against the declaration list. The node carries its own type
  // and the renderer needs nothing else, so this is not about rendering: it is
  // about the editor and the renderer describing the same value. A field
  // declared `text` and used by a `richtext` node offers an author a plain box
  // for something that will be sanitized as markup, and neither half is wrong
  // enough to be the one that gets fixed.
  const declared = new Map(document.fields.map(field => [field.name, field.type]))
  for (const node of structuredFieldNodes(document.nodes)) {
    const type = declared.get(node.field)
    if (type === undefined) {
      problems.push(defect('undeclared-field', `uses field ${node.field}, which it never declares`))
    } else if (type !== (node.type === 'icon' ? 'text' : node.type)) {
      problems.push(
        defect('field-type-mismatch', `uses field ${node.field} as ${node.type} but declares it as ${type}`),
      )
    }
    if (node.type === 'repeat') {
      for (const itemNode of structuredRepeatItemFieldNodes(node)) {
        if (itemNode.type === 'repeat') {
          problems.push(defect('node-refused', `repeat field ${node.field} contains a nested repeat`))
          break
        }
      }
    }
  }
  return problems
}

/**
 * The same answer as `structuredSectionDefects`, as the sentences alone.
 *
 * What the compiler, the importer and the editor have always wanted: a list of
 * things to show somebody. The codes are for tests and for anything that has to
 * branch on *which* refusal this is, and a second implementation of the checks
 * would be a second thing to keep in step.
 */
export function structuredSectionProblems(def: StructuredDefView): string[] {
  return structuredProblemMessages(structuredSectionDefects(def))
}

export type StructuredRenderOptions = {
  /** Definition-owned grouping; values still pass collection parsing. */
  groupRepeatsBy?: Readonly<Record<string, string>>
  filterRepeatsBy?: Readonly<Record<string, string>>
  /** Adds the editor's selection instrumentation. Never true for public output. */
  preview?: boolean
  providerEmbeds?: boolean
}

/**
 * The markup for one structured definition's nodes, or null when there is none
 * this renderer will emit.
 *
 * Null rather than an empty string, so the caller can tell "this definition
 * renders nothing" from "this definition renders nothing *visible*". The first
 * has to drop the whole section, wrapper and stylesheet included; the second is
 * an ordinary empty page region.
 */
export function renderStructuredBody(
  def: StructuredDefView,
  values: Record<string, unknown>,
  options: StructuredRenderOptions = {},
): string | null {
  if (structuredSectionProblems(def).length > 0) return null
  // Parsed a second time rather than threaded out of the check above, because
  // the check is the thing that decides whether this is a document at all, and a
  // renderer that accepts a pre-validated object accepts whatever its caller
  // says was validated.
  const parsed = StructuredDocument.safeParse(def.structured_doc)
  if (!parsed.success) return null
  // Level 1, not 0. The serializer used to start counting at zero while
  // `STRUCTURED_MAX_DEPTH` counts the outermost node as level 1, so its own
  // guard sat one level looser than the bound the document was checked against
  // — a defence that would have let through exactly one level more than
  // anything else in the system agrees is allowed. Nothing reached it, because
  // the preflight refuses first; a defence nothing reaches is still worth
  // having, and worth having say the same number.
  return serializeNodes(parsed.data.nodes, values, options, 1)
}

function serializeNodes(
  nodes: readonly StructuredNode[],
  values: Record<string, unknown>,
  options: StructuredRenderOptions,
  depth: number,
): string | null {
  // The depth guard is here as well as in the problem list, because this
  // function recurses and a guard that only runs somewhere else is a guard that
  // one refactor removes. `depth` is the level of the nodes about to be
  // serialized, in the one convention: the document's own `nodes` are level 1.
  if (depth > STRUCTURED_MAX_DEPTH) return null

  let out = ''
  for (const node of nodes) {
    const rendered = serializeNode(node, values, options, depth)
    if (rendered === null) return null
    out += rendered
  }
  return out
}

function serializeNode(
  node: StructuredNode,
  values: Record<string, unknown>,
  options: StructuredRenderOptions,
  depth: number,
): string | null {
  if (node.type === 'provider-embed') return renderProviderEmbed(node, options)
  if (node.type === 'element') {
    let attributes = ''
    for (const [name, value] of Object.entries(node.attributes ?? {})) {
      // Both halves, again, at the point of emission. The document was already
      // validated, and this is what keeps that fact from being load-bearing: an
      // attribute is emitted because it is allowlisted *here*, not because
      // something upstream said so.
      if (!isStructuredAttribute(name) || !isStructuredAttributeValue(name, value)) continue
      attributes += ` ${name}="${escapeAttribute(value)}"`
    }
    if (isStructuredVoidTag(node.tag)) return `<${node.tag}${attributes}>`
    const children = serializeNodes(node.children ?? [], values, options, depth + 1)
    if (children === null) return null
    return `<${node.tag}${attributes}>${children}</${node.tag}>`
  }

  if (node.type === 'repeat') {
    const rendered = renderStructuredRepeat(node, values[node.field], depth, options)
    if (rendered === null) return null
    if (!options.preview) return rendered
    return (
      `<cms-slot class="cms-repeat-preview" data-cms-slot="${escapeAttribute(node.field)}"` +
      ` data-cms-kind="repeat"${resolvedCollection(values[node.field]) ? ` data-cms-list="${escapeAttribute(resolvedCollection(values[node.field])!.collectionId)}" data-cms-reader="${escapeAttribute(resolvedCollection(values[node.field])!.readerKey)}"` : ''}>${rendered}</cms-slot>`
    )
  }

  const rendered = renderStructuredField(node, values)
  if (rendered === null) return null
  if (!options.preview) return rendered
  // `data-cms-slot`, the same attribute the interpolation renderer uses, and
  // deliberately not a second name for the same idea. The editor's selection
  // contract — the canvas runtime, the inspector, the structure tree — is about
  // "a region somebody can edit", which is a fact about the page rather than
  // about which compiler produced it. Giving structured fields their own
  // attribute would make every one of those surfaces ask which model a section
  // came from, which is exactly the coupling the discriminator exists to remove.
  //
  // A field is also always in element position, because attributes are static
  // and no field can be inside one. The interpolation renderer has to exclude
  // attribute-position slots from its equivalent, since wrapping one emitted a
  // literal `<span …>` inside a quoted value; that case cannot arise here.
  // Keep instrumentation outside ordinary tag selectors such as `h1 span`.
  return (
    `<cms-slot data-cms-slot="${escapeAttribute(node.field)}"` +
    ` data-cms-kind="${escapeAttribute(node.type)}">${rendered}</cms-slot>`
  )
}

type ResolvedCollectionSchema = {
  id: string
  revision: string
  fields: unknown
}
type ResolvedCollectionEntry = {
  id: string
  stableKey: string
  schemaVersionId: string
  values: unknown
}
type ResolvedCollection = {
  kind: 'collection'
  collectionId: string
  readerKey: string
  publishedSchemaVersionId: string
  publishedSchemaRevision: string
  publishedEntryRevision: string
  schemas: ResolvedCollectionSchema[]
  entries: ResolvedCollectionEntry[]
  storyCatalog?: StoryCatalog
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STABLE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function recordWithExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every(key => keys.includes(key))
}

export function resolvedCollection(value: unknown): ResolvedCollection | null {
  const keys = [
    'kind',
    'collectionId',
    'readerKey',
    'publishedSchemaVersionId',
    'publishedSchemaRevision',
    'publishedEntryRevision',
    'schemas',
    'entries',
    ...(value && typeof value === 'object' && Object.hasOwn(value, 'storyCatalog') ? ['storyCatalog'] : []),
  ]
  if (
    !recordWithExactKeys(value, keys) ||
    value['kind'] !== 'collection' ||
    typeof value['collectionId'] !== 'string' ||
    !UUID.test(value['collectionId']) ||
    typeof value['readerKey'] !== 'string' ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(value['readerKey']) ||
    typeof value['publishedSchemaVersionId'] !== 'string' ||
    !UUID.test(value['publishedSchemaVersionId']) ||
    typeof value['publishedSchemaRevision'] !== 'string' ||
    !/^\d+$/.test(value['publishedSchemaRevision']) ||
    typeof value['publishedEntryRevision'] !== 'string' ||
    !/^\d+$/.test(value['publishedEntryRevision']) ||
    !Array.isArray(value['schemas']) ||
    !Array.isArray(value['entries']) ||
    value['schemas'].length >
      (value['readerKey'] === 'stories' ? STORY_WIDGET_SOURCE_LIMIT : STRUCTURED_REPEAT_MAX_ENTRIES) ||
    value['entries'].length >
      (value['readerKey'] === 'stories' ? STORY_WIDGET_SOURCE_LIMIT : STRUCTURED_REPEAT_MAX_ENTRIES)
  )
    return null

  if (
    Object.hasOwn(value, 'storyCatalog') &&
    (value['readerKey'] !== 'stories' || !StoryCatalog.safeParse(value['storyCatalog']).success)
  )
    return null

  const schemaIds = new Set<string>()
  for (const schema of value['schemas']) {
    if (
      !recordWithExactKeys(schema, ['id', 'revision', 'fields']) ||
      typeof schema['id'] !== 'string' ||
      !UUID.test(schema['id']) ||
      typeof schema['revision'] !== 'string' ||
      !/^\d+$/.test(schema['revision']) ||
      !CollectionFields.safeParse(schema['fields']).success ||
      schemaIds.has(schema['id'])
    )
      return null
    schemaIds.add(schema['id'])
  }
  const entryIds = new Set<string>()
  const stableKeys = new Set<string>()
  for (const entry of value['entries']) {
    if (
      !recordWithExactKeys(entry, ['id', 'stableKey', 'schemaVersionId', 'values']) ||
      typeof entry['id'] !== 'string' ||
      !UUID.test(entry['id']) ||
      typeof entry['stableKey'] !== 'string' ||
      !STABLE_KEY.test(entry['stableKey']) ||
      entry['stableKey'].length > 80 ||
      typeof entry['schemaVersionId'] !== 'string' ||
      !schemaIds.has(entry['schemaVersionId']) ||
      entryIds.has(entry['id']) ||
      stableKeys.has(entry['stableKey'])
    )
      return null
    entryIds.add(entry['id'])
    stableKeys.add(entry['stableKey'])
  }
  return value as unknown as ResolvedCollection
}

export function repeatFieldCompatible(nodeType: string, collectionType: string): boolean {
  if (nodeType === 'icon') return collectionType === 'text' || collectionType === 'select'
  if (nodeType === 'text') return ['text', 'number', 'date', 'boolean', 'select'].includes(collectionType)
  if (nodeType === 'richtext') return collectionType === 'richtext'
  if (nodeType === 'image') return collectionType === 'image'
  if (nodeType === 'link') return collectionType === 'url'
  return false
}

/** A resolved manifest is still untrusted input; validate it again at emission. */
function renderStructuredRepeat(
  node: StructuredRepeatFieldNode,
  raw: unknown,
  depth: number,
  options: StructuredRenderOptions,
): string | null {
  const collection = resolvedCollection(raw)
  if (collection === null) return null
  // The authenticated draft resolver uses this empty envelope for an
  // incomplete selection. The strict publication resolver never emits it.
  if (
    collection.collectionId === '00000000-0000-4000-8000-000000000000' &&
    collection.readerKey === 'cms_unconfigured' &&
    collection.entries.length === 0
  ) {
    return '<p class="cms-repeat-empty cms-repeat-unconfigured" role="status">Choose a list in Content to finish this section.</p>'
  }
  if (collection.entries.length === 0) {
    return node.empty.behavior === 'hide' ? '' : `<p class="cms-repeat-empty">${escapeText(node.empty.text)}</p>`
  }

  const schemas = new Map<string, ReturnType<typeof CollectionFields.parse>>()
  for (const schema of collection.schemas) schemas.set(schema.id, CollectionFields.parse(schema.fields))
  const itemFields = structuredRepeatItemFieldNodes(node)
  if (itemFields.some(field => field.type === 'repeat')) return null

  let out = ''
  const groupField = options.groupRepeatsBy?.[node.field]
  const filterField = options.filterRepeatsBy?.[node.field]
  const tracks = new Set<string>()
  const groups = new Map<string, string[]>()
  for (const entry of collection.entries) {
    const fields = schemas.get(entry.schemaVersionId)
    if (fields === undefined) return null
    const byKey = new Map(fields.map(field => [field.key, field.type]))
    for (const itemField of itemFields) {
      const collectionType = byKey.get(itemField.field)
      if (collectionType === undefined || !repeatFieldCompatible(itemField.type, collectionType)) return null
    }
    const parsed = parseCollectionEntryValues(fields, entry.values)
    if (!parsed.ok) return null
    // Item fields stay out of page-slot edits. Preview-only attributes on the
    // root open the shared list drawer; no wrapper changes the site's layout.
    // Collection URLs stay plain strings in storage/CSV. Adapt only at the
    // link sink, with the schema-owned label rather than exposing a raw URL as
    // visible copy. Empty optional URLs produce no anchor. Page link values
    // retain their existing {url,label} contract.
    const itemValues = { ...parsed.values }
    for (const itemField of itemFields) {
      if (itemField.type !== 'link') continue
      const value = parsed.values[itemField.field]
      itemValues[itemField.field] =
        value === ''
          ? null
          : {
              url: value,
              label: fields.find(field => field.key === itemField.field)!.label,
            }
    }
    let item = serializeNodes(node.item, itemValues, { ...options, preview: false }, depth + 1)
    if (item === null) return null
    if (options.preview)
      item = item.replace(
        /^<([a-z][a-z0-9-]*)(?=[\s>])/,
        `<$1 data-cms-entry="${escapeAttribute(entry.stableKey)}" data-cms-reader="${escapeAttribute(collection.readerKey)}" data-cms-list-field="${escapeAttribute(node.field)}"`,
      )
    if (filterField) {
      const track = String(parsed.values[filterField] || 'General')
      tracks.add(track)
      item = `<div data-cms-session-track="${escapeAttribute(track)}">${item}</div>`
    }
    if (groupField) {
      const label = String(parsed.values[groupField] ?? 'More sessions')
      groups.set(label, [...(groups.get(label) ?? []), item])
    } else out += item
  }
  if (groupField)
    out = [...groups]
      .map(
        ([label, items]) =>
          `<section class="cms-list-day"><h3>${escapeText(label)}</h3><div class="cms-list-day-items">${items.join('')}</div></section>`,
      )
      .join('')
  if (filterField && tracks.size > 1)
    out = `<div class="cms-schedule"><div data-cms-track-filter hidden role="group" aria-label="Filter sessions by track"><button type="button" data-cms-track-value="" aria-pressed="true" disabled>All tracks</button>${[...tracks].map(track => `<button type="button" data-cms-track-value="${escapeAttribute(track)}" aria-pressed="false" disabled>${escapeText(track)}</button>`).join('')}</div>${out}</div>`
  return out
}

/**
 * The `rel` a link actually ships with: what the definition asked for, plus what
 * this renderer guarantees, with duplicates collapsed and in one order.
 *
 * The guarantee is the point (ADR 0008). `target="_blank"` hands the opened
 * document a live `window.opener` back to this page, which it can navigate; the
 * fix is `rel="noopener"`, and every version of this that has ever gone wrong
 * went wrong by trusting somebody else to have asked for it. So it is added
 * here, from the fact that the link is `_blank` or off-site, rather than being a
 * rule the definition author is expected to remember. Recent browsers imply
 * `noopener` for `_blank` themselves — but "recent" is a property of the reader
 * rather than of the page, and the page is what this function is responsible
 * for.
 *
 * Order comes from filtering `STRUCTURED_LINK_RELS` rather than from sorting,
 * so the emitted order is the declared order of the allowlist by construction
 * and cannot drift from it. Deduplication comes from the set: a definition that
 * already asked for `noopener` on a `_blank` link must not ship
 * `rel="noopener noopener"`, which is the one duplicate this design creates and
 * therefore the one it has to answer for.
 */
export function structuredLinkRel(
  declared: readonly string[] | undefined,
  context: { offSite: boolean; blank: boolean },
): StructuredLinkRel[] {
  const wanted = new Set<string>()
  for (const token of declared ?? []) {
    if ((STRUCTURED_LINK_RELS as readonly string[]).includes(token)) wanted.add(token)
  }
  if (context.offSite || context.blank) wanted.add('noopener')
  return STRUCTURED_LINK_RELS.filter(rel => wanted.has(rel))
}

/**
 * The definition-owned attributes of a link field node, ready to concatenate
 * into the start tag.
 *
 * Every value is re-checked here, at the point of emission, exactly as an
 * element node's attributes are. The document was already validated and this is
 * what keeps that fact from being load-bearing: an attribute appears on the page
 * because it is allowlisted *here*, not because something upstream said it was.
 */
function linkStaticMarkup(
  node: StructuredLinkFieldNode,
  offSite: boolean,
  buttonClasses = '',
  chosen: { newTab: boolean; nofollow: boolean } = { newTab: false, nofollow: false },
): string {
  const declared = node.staticAttributes ?? {}
  // A target the definition declares wins; otherwise the editor's per-link
  // choice of a new tab applies. `nofollow` joins whatever the definition set.
  const target = isStructuredStaticAttributeValue('link', 'target', declared.target)
    ? declared.target
    : chosen.newTab
      ? '_blank'
      : undefined
  const declaredRel = isStructuredStaticAttributeValue('link', 'rel', declared.rel) ? declared.rel : undefined
  const rel = structuredLinkRel(chosen.nofollow ? [...(declaredRel ?? []), 'nofollow'] : declaredRel, {
    offSite,
    blank: target === '_blank',
  })

  let out = ''
  const classes = declared.class
  if (buttonClasses || (classes !== undefined && isStructuredStaticAttributeValue('link', 'class', classes))) {
    // Joined here, from tokens that were each validated as a token. The
    // separator is the renderer's rather than the author's, so there is no
    // stored string for anything downstream to split and disagree about.
    const definitionClasses =
      classes !== undefined && isStructuredStaticAttributeValue('link', 'class', classes) ? classes.join(' ') : ''
    out += ` class="${escapeAttribute([definitionClasses, buttonClasses].filter(Boolean).join(' '))}"`
  }
  if (rel.length > 0) out += ` rel="${escapeAttribute(rel.join(' '))}"`
  if (target !== undefined) out += ` target="${escapeAttribute(target)}"`
  return out
}

/** The definition-owned attributes of an image field node. */
function imageStaticMarkup(node: StructuredImageFieldNode): string {
  const declared = node.staticAttributes ?? {}
  let out = ''
  const classes = declared.class
  if (classes !== undefined && isStructuredStaticAttributeValue('image', 'class', classes)) {
    out += ` class="${escapeAttribute(classes.join(' '))}"`
  }
  // The pair, or neither of them. The schema and the database both refuse a
  // document carrying one alone, so this can only fire if a value was refused
  // here and its partner was not — and shipping the survivor would be shipping
  // the case both gates exist to prevent.
  const { width, height } = declared
  if (
    isStructuredStaticAttributeValue('image', 'width', width) &&
    isStructuredStaticAttributeValue('image', 'height', height)
  ) {
    out += ` width="${escapeAttribute(String(width))}" height="${escapeAttribute(String(height))}"`
  }
  for (const name of ['decoding', 'loading', 'fetchpriority'] as const) {
    const value = declared[name]
    if (value !== undefined && isStructuredStaticAttributeValue('image', name, value)) {
      out += ` ${name}="${escapeAttribute(value)}"`
    }
  }
  return out
}

/**
 * One stored value, through the policy its field type names.
 *
 * Returns '' for a value that is absent or unusable and null only for a field
 * type this function does not implement. The distinction matters: an empty
 * required region is an editorial problem the readiness policy reports, whereas
 * a field type nobody here can render means the document was written for a
 * different renderer, and rendering the rest of it would publish a section with
 * a hole in it that nothing announces.
 *
 * A `link` and an `image` also emit the definition's static attributes (ADR
 * 0008). The author's values come first in the start tag and the definition's
 * come after, which is a convention rather than a requirement — but it is the
 * convention that keeps every schema v1 document byte-identical, since a v1
 * node contributes nothing to the second half.
 */
export function renderStructuredField(node: StructuredFieldNode, values: Record<string, unknown>): string | null {
  const raw = values[node.field]
  if (
    node.type === 'image' &&
    node.staticAttributes?.class?.includes('cms-avatar-fallback') &&
    (!raw || typeof raw !== 'object' || !String((raw as Record<string, unknown>)['src'] ?? '').trim())
  ) {
    const name = String(values['name'] ?? 'Person').trim() || 'Person'
    const initials = name
      .split(/\s+/)
      .slice(0, 2)
      .map(word => [...word][0])
      .join('')
      .toUpperCase()
    return `<span class="cms-initials-avatar" role="img" aria-label="${escapeAttribute(`No picture for ${name}`)}">${escapeText(initials)}</span>`
  }
  if (raw === undefined || raw === null) return ''

  switch (node.type) {
    case 'icon':
      return renderCmsIcon(values[node.field])
    case 'text':
      return escapeText(String(raw))
    case 'richtext':
      return sanitizeRichText(String(raw))
    case 'link': {
      // A link is two values. The interpolation renderer accepts a bare string
      // and uses it as both the URL and the label, which puts a raw href on the
      // page as visible text whenever an editor pastes one — a guess about
      // intent that ships. Here the shape is the shape, and anything else is an
      // empty region somebody can see is empty.
      if (typeof raw !== 'object') return ''
      const value = raw as Record<string, unknown>
      const url = safeUrl(String(value['url'] ?? ''))
      const label = String(value['label'] ?? '')
      if (label === '') return ''
      // `rel="noopener"` on anything leaving the site, matching the
      // interpolation path exactly rather than inventing a second convention.
      // Since schema v2 that decision is one input to `structuredLinkRel` rather
      // than the whole of it, because a same-site `_blank` link hands over a
      // `window.opener` too.
      const markup = linkStaticMarkup(node, /^https?:/i.test(url), buttonAppearanceClasses(value['buttonAppearance']), {
        newTab: value['newTab'] === true,
        nofollow: value['nofollow'] === true,
      })
      return `<a href="${escapeAttribute(url)}"${markup}>${escapeText(label)}</a>`
    }
    case 'image': {
      if (typeof raw !== 'object') return ''
      const value = raw as Record<string, unknown>
      const src = safeUrl(String(value['src'] ?? ''))
      // `safeUrl` degrades a refused URL to '#', which is a dead link and a
      // perfectly good outcome for an anchor. For an image it is not: `src="#"`
      // makes the browser re-request the current document and render the result
      // as a broken image. A refused source means no image element at all.
      if (src === '#') return ''
      const alt = typeof value['alt'] === 'string' ? value['alt'] : ''
      const focus = imageFocusPosition(value['focal'])
      const markup = imageStaticMarkup(node) + (focus ? ` style="object-position:${focus}"` : '')
      // Described or explicitly decorative, and no third case. The
      // interpolation path treats an empty alt as a declaration of decorative
      // intent, which means every image whose alt text somebody forgot is
      // silently announced to a screen reader as nothing at all. Here the
      // intent has to be stated.
      if (value['decorative'] === true) {
        return `<img src="${escapeAttribute(src)}" alt="" role="presentation"${markup}>`
      }
      if (alt === '') return ''
      return `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}"${markup}>`
    }
    default:
      return null
  }
}

// ------------------------------------------------------------- authoring

export type StructuredCompileResult = {
  document: StructuredDocument
  /** Compiled, scoped CSS. Never the authored form. */
  css: string
  renderHash: string
  problems: string[]
  /** Problems that make the definition unsafe rather than merely wrong. */
  blocking: string[]
}

const EMPTY_DOCUMENT: StructuredDocument = {
  schemaVersion: STRUCTURED_SCHEMA_VERSION,
  fields: [],
  nodes: [],
}

/**
 * Check a structured document and compile its stylesheet, at authoring time.
 *
 * The CSS half is deliberately identical to `compileSection`'s: the authored
 * source goes through `scopeCss` under the scope `sectionScopeSelector` derives
 * from this definition's slug, and the compiled artifact is re-checked by
 * `validateCompiledCss` before anything can store it. Structured markup does not
 * make a stylesheet safer, and giving the new model its own CSS path would have
 * produced a second policy to keep in step with the first.
 */
export function compileStructuredSection(input: {
  slug: string
  document: unknown
  sourceCss?: string
}): StructuredCompileResult {
  const problems: string[] = []
  const blocking: string[] = []

  const scope = sectionScopeSelector(input.slug)
  if (scope === null) {
    blocking.push(`slug ${JSON.stringify(input.slug)} cannot be a section scope`)
  }

  // Checked with exactly the function the renderer uses on a stored row, by
  // handing it a view shaped like one. Two spellings of "is this document
  // valid" is how the compiler comes to accept what storage will later refuse.
  const asStored: StructuredDefView = {
    definition_kind: 'structured',
    structured_doc: input.document,
    structured_schema_version: STRUCTURED_SCHEMA_VERSION,
  }
  const found = structuredSectionProblems(asStored)
  blocking.push(...found)

  const scoped = scopeCss(input.sourceCss ?? '', scope ?? '.cms-section')
  problems.push(...scoped.violations)
  blocking.push(...scoped.blocking)

  const parsed = StructuredDocument.safeParse(input.document)
  const document = parsed.success && found.length === 0 ? parsed.data : EMPTY_DOCUMENT
  const css = scope === null ? '' : scoped.css

  return {
    document,
    css,
    // The same identity the interpolation compiler produces, over the artifacts
    // this model actually has, so a definition change is never invisible to the
    // golden tests.
    renderHash: sha256Hex(JSON.stringify({ document, css, cssPolicyVersion: CSS_POLICY_VERSION })).slice(0, 32),
    problems: [...problems, ...blocking],
    blocking,
  }
}
