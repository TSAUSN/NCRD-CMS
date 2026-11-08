import { z } from 'zod'
import { StoryTagFilter } from './stories.ts'
import { TableauEmbed } from './provider-embed.ts'
import { SLOT_ID } from './sections.ts'
import {
  STRUCTURED_TAGS,
  STRUCTURED_LINK_TARGETS,
  STRUCTURED_IMAGE_DECODINGS,
  STRUCTURED_IMAGE_LOADINGS,
  STRUCTURED_IMAGE_FETCH_PRIORITIES,
  isStructuredAttribute,
  isStructuredAttributeValue,
  isStructuredStaticAttributeValue,
  isStructuredVoidTag,
  structuredImageDimensionsAgree,
  type StructuredTag,
  type StructuredLinkStaticAttributes,
  type StructuredImageStaticAttributes,
} from './structured-markup.ts'

/**
 * Which model a stored section definition is written in.
 *
 * An explicit column rather than "it has a structured document, so it must be
 * structured": a row carrying both artifacts is a row two code paths disagree
 * about, and the disagreement is silent. The row says, and anything that cannot
 * read what it says renders nothing.
 */
export const SECTION_DEFINITION_KINDS = ['legacy', 'structured'] as const
export type SectionDefinitionKind = (typeof SECTION_DEFINITION_KINDS)[number]

export function isSectionDefinitionKind(value: unknown): value is SectionDefinitionKind {
  return typeof value === 'string' && (SECTION_DEFINITION_KINDS as readonly string[]).includes(value)
}

/**
 * The version of the node vocabulary below.
 *
 * Checked the way `SANITIZER_POLICY_VERSION` and `CSS_POLICY_VERSION` already
 * are, and for the same reason: the difference between one version of a document
 * schema and the next is what the nodes *mean*, so a document naming a version
 * this build does not implement is not "mostly readable". It is refused — at the
 * storage gate, and again in the renderer, so neither depends on the other
 * having remembered.
 *
 * Version 2 adds `staticAttributes` to the `link` and `image` field nodes and
 * changes nothing else (ADR 0008). It is a version rather than an optional key
 * because the *persisted* contract changed: a v2 document stored where a v1
 * reader can reach it would have that reader emit an anchor without the class
 * that styles it or an image without the box that reserves its space — markup
 * that parses, renders, and is wrong, which is the failure this whole model is
 * built to refuse.
 *
 * ADR 0009 adds a name to `STRUCTURED_ATTRIBUTES` and deliberately does *not*
 * move this number, which is the harder half of that decision and so is written
 * down here rather than only in the ADR. The test is not "did anything change",
 * it is "can a build read a document and put the wrong thing on the page". A new
 * key on a node passes that test the wrong way, because a reader that does not
 * know the key has to choose between ignoring it and refusing, and ignoring it
 * renders markup that parses and is wrong. A new *name* in a closed allowlist
 * does not: every reader checks the name against its own list, and one that has
 * never heard of it refuses the whole document — at the storage gate and again
 * in the renderer — so the section is visibly absent rather than quietly
 * misshapen. Both directions are safe: an older document is read identically by
 * a newer build, and a newer document renders nothing at all on an older one.
 *
 * The cost of moving it is what settles it. This number is checked against
 * `app.current_structured_schema_version()`, against every stored row's
 * `structured_schema_version`, and against the version inside every document.
 * TypeScript and SQL land in separate commits, so between them the two disagree
 * — and a bumped version makes that disagreement catalogue-wide: every
 * structured definition fails to save and every structured section on every page
 * renders nothing, including the ones nobody touched. Widening the allowlist
 * confines the disagreement to the documents that actually use the new name.
 * A version is for a change in what nodes *mean*; this is a change in what one
 * of them may *say*.
 */
export const STRUCTURED_SCHEMA_VERSION = 3

/**
 * The versions `upgradeStructuredDocument` can carry forward to the current one.
 *
 * One entry, and it will stay short: an upgrade is only writable while somebody
 * still remembers what the older vocabulary meant. A version not listed here is
 * refused rather than read optimistically — the same rule the renderer and the
 * database apply to a document that names a version they do not implement.
 */
export const STRUCTURED_UPGRADABLE_SCHEMA_VERSIONS = [1, 2] as const

/**
 * How deep a document may nest, counted in *node levels*.
 *
 * The convention, written out because "depth 16" has three plausible readings
 * and the wrong one is off by one in the direction that accepts too much:
 *
 * - The document envelope — the object carrying `schemaVersion`, `fields` and
 *   `nodes` — is not a level. It is not a node.
 * - Every entry of the document's `nodes` array is at level 1. There is no
 *   level 0, and the length of that array is a width rather than a depth.
 *   Fifty sibling nodes are all at level 1.
 * - A child is one level below its parent, so a `div` inside a `section` is at
 *   level 2.
 * - A *field node is a node*, and occupies a level exactly like an element
 *   does. This is the reading that is easy to get wrong: the field is the
 *   payload rather than the container, so it looks like it should be free, and
 *   it is not.
 *
 * So sixteen means: at most sixteen nodes on any path from a top-level node to
 * a leaf. To an author it is "the tags you nest, plus the field itself" — a
 * `section > h1 > text-field` is three, and fifteen nested elements around one
 * field is the deepest document this model will accept. To a stored document it
 * is `structuredDepth(doc.nodes) <= 16`, which is the same sentence and the one
 * every layer actually evaluates. The database says it the same way: migration
 * 0021's walk seeds `depth = 1` from `nodes` and refuses `max_depth > 16`.
 *
 * The number is a bound on work, not a design budget. Both walkers downstream
 * are recursive — the renderer's serializer and the database's
 * `app.structured_node_defect` — and a document is a stored value, so its depth
 * is an attacker's choice rather than an author's. Sixteen is more than any of
 * the 118 V1 definitions needs (the deepest nests 9) and far less than either
 * stack minds.
 */
export const STRUCTURED_MAX_DEPTH = 16

/** Field declarations describe values. Icon nodes use a compiled icon choice. */
export const STRUCTURED_FIELD_TYPES = ['text', 'richtext', 'link', 'image', 'repeat'] as const
export type StructuredFieldType = (typeof STRUCTURED_FIELD_TYPES)[number]

/** One repeat can never expand a page manifest without a fixed upper bound. */
export const STRUCTURED_REPEAT_MAX_ENTRIES = 200

const RepeatAutomaticSelection = z.strictObject({
  mode: z.literal('automatic'),
  storyTags: StoryTagFilter.optional(),
  order: z.literal('newest').optional(),
  dateField: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .optional(),
  maxAgeMonths: z.number().int().min(1).max(120).optional(),
  excludeStableKey: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80)
    .optional(),
  filter: z
    .strictObject({ field: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), value: z.string().trim().min(1).max(120) })
    .optional(),
  limit: z.number().int().min(1).max(STRUCTURED_REPEAT_MAX_ENTRIES),
})
const RepeatManualSelection = z
  .strictObject({
    mode: z.literal('manual'),
    stableKeys: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(80),
      )
      .max(STRUCTURED_REPEAT_MAX_ENTRIES),
  })
  .check(ctx => {
    if (new Set(ctx.value.stableKeys).size !== ctx.value.stableKeys.length) {
      ctx.issues.push({ code: 'custom', input: ctx.value.stableKeys, message: 'manual repeat keys must be unique' })
    }
  })

export const StructuredRepeatBinding = z
  .strictObject({
    readerKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    selection: z.discriminatedUnion('mode', [RepeatAutomaticSelection, RepeatManualSelection]),
  })
  .refine(
    value => !(value.selection.mode === 'automatic' && value.selection.storyTags && value.readerKey !== 'stories'),
    'Choose these tag groups on a Stories section.',
  )
  .refine(
    value =>
      !(
        value.readerKey === 'stories' &&
        value.selection.mode === 'automatic' &&
        ((value.selection.dateField !== undefined && value.selection.dateField !== 'published_date') ||
          (value.selection.maxAgeMonths !== undefined && value.selection.maxAgeMonths !== 13))
      ),
    'Stories use the story date and a 13-month feed limit.',
  )
export type StructuredRepeatBinding = z.infer<typeof StructuredRepeatBinding>

export type StructuredElementNode = {
  type: 'element'
  tag: StructuredTag
  attributes?: Record<string, string>
  children?: StructuredNode[]
}

export type StructuredTextFieldNode = { type: 'text' | 'richtext' | 'icon'; field: string }
export type StructuredLinkFieldNode = {
  type: 'link'
  field: string
  staticAttributes?: StructuredLinkStaticAttributes
}
export type StructuredImageFieldNode = {
  type: 'image'
  field: string
  staticAttributes?: StructuredImageStaticAttributes
}
export type StructuredRepeatFieldNode = {
  type: 'repeat'
  field: string
  item: StructuredNode[]
  empty: { behavior: 'hide' } | { behavior: 'message'; text: string }
}

export type StructuredFieldNode =
  | StructuredTextFieldNode
  | StructuredLinkFieldNode
  | StructuredImageFieldNode
  | StructuredRepeatFieldNode

export type StructuredNode = StructuredElementNode | StructuredFieldNode | TableauEmbed

const AttributeMap = z.record(z.string(), z.string()).check(ctx => {
  for (const [name, value] of Object.entries(ctx.value)) {
    if (!isStructuredAttribute(name)) {
      ctx.issues.push({ code: 'custom', input: name, message: `${name} is not an attribute an element node may carry` })
    } else if (!isStructuredAttributeValue(name, value)) {
      ctx.issues.push({ code: 'custom', input: value, message: `${JSON.stringify(value)} is not a usable ${name}` })
    }
  }
})

// `strictObject` everywhere below, deliberately. A key this build does not
// recognise is not a harmless extra: it is the part of the document that was
// written for a reader that is not this one, and continuing without it renders a
// section that is missing whatever that key was for. Refusing is how an unknown
// schema version gets noticed even when somebody forgot to bump it.
const StructuredElement = z
  .strictObject({
    type: z.literal('element'),
    tag: z.enum(STRUCTURED_TAGS),
    attributes: AttributeMap.optional(),
    children: z.array(z.lazy(() => StructuredNode)).optional(),
  })
  .check(ctx => {
    if (isStructuredVoidTag(ctx.value.tag) && (ctx.value.children?.length ?? 0) > 0) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        message: `<${ctx.value.tag}> has no end tag, so it cannot have children`,
      })
    }
  })

const FieldName = z
  .string()
  .regex(SLOT_ID, 'a field name must be a letter followed by letters, digits, _ or -, up to 64 characters')

/**
 * A field whose value is characters, which is every field that is not its own
 * element.
 *
 * `strictObject` with no `staticAttributes`, so writing one on a `text` node is
 * refused rather than ignored. There is nothing for it to attach to — the
 * element around a text field is an element node the author already wrote — and
 * a key that is silently dropped is the half of a document somebody believes is
 * doing something.
 */
const StructuredTextField = z.strictObject({ type: z.literal('text'), field: FieldName })
const StructuredRichTextField = z.strictObject({ type: z.literal('richtext'), field: FieldName })

const LinkStaticAttributeSchema = z
  .strictObject({
    class: z.array(z.string()).optional(),
    rel: z.array(z.string()).optional(),
    target: z.enum(STRUCTURED_LINK_TARGETS).optional(),
  })
  .check(ctx => {
    // Deferred to the shared predicate rather than expressed as Zod combinators,
    // for the reason `AttributeMap` above defers: the database enforces the
    // identical rules from SQL, and a grammar written twice in one language is
    // already two grammars. One function is what the renderer re-checks at the
    // point of emission, so "it was validated upstream" never becomes
    // load-bearing.
    for (const [name, value] of Object.entries(ctx.value)) {
      if (value === undefined) continue
      if (!isStructuredStaticAttributeValue('link', name, value)) {
        ctx.issues.push({
          code: 'custom',
          input: value,
          message: `${JSON.stringify(value)} is not a usable ${name} for a link field`,
        })
      }
    }
  })

const ImageStaticAttributeSchema = z
  .strictObject({
    class: z.array(z.string()).optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    decoding: z.enum(STRUCTURED_IMAGE_DECODINGS).optional(),
    loading: z.enum(STRUCTURED_IMAGE_LOADINGS).optional(),
    fetchpriority: z.enum(STRUCTURED_IMAGE_FETCH_PRIORITIES).optional(),
  })
  .check(ctx => {
    for (const [name, value] of Object.entries(ctx.value)) {
      if (value === undefined) continue
      if (!isStructuredStaticAttributeValue('image', name, value)) {
        ctx.issues.push({
          code: 'custom',
          input: value,
          message: `${JSON.stringify(value)} is not a usable ${name} for an image field`,
        })
      }
    }
    if (!structuredImageDimensionsAgree(ctx.value)) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        message:
          'an image field declares width and height together or neither, ' +
          'because one alone reserves the wrong box and still lets the page jump',
      })
    }
  })

const StructuredLinkField = z.strictObject({
  type: z.literal('link'),
  field: FieldName,
  staticAttributes: LinkStaticAttributeSchema.optional(),
})

const StructuredImageField = z.strictObject({
  type: z.literal('image'),
  field: FieldName,
  staticAttributes: ImageStaticAttributeSchema.optional(),
})

const StructuredRepeatEmpty = z.discriminatedUnion('behavior', [
  z.strictObject({ behavior: z.literal('hide') }),
  z.strictObject({ behavior: z.literal('message'), text: z.string().min(1).max(200) }),
])

const StructuredRepeatField = z.strictObject({
  type: z.literal('repeat'),
  field: FieldName,
  item: z
    .array(z.lazy(() => StructuredNode))
    .min(1)
    .max(512),
  empty: StructuredRepeatEmpty,
})

export const StructuredNode: z.ZodType<StructuredNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    StructuredElement,
    StructuredTextField,
    StructuredRichTextField,
    StructuredLinkField,
    StructuredImageField,
    StructuredRepeatField,
    TableauEmbed,
    z.strictObject({ type: z.literal('icon'), field: z.string().regex(SLOT_ID) }),
  ]),
)

/**
 * What an editor is offered for one field, declared once at the top of the
 * document.
 *
 * The node already carries its own type, so this is not what the renderer reads.
 * It is what keeps the editor and the renderer describing the same thing: a
 * field declared `text` and used by a `richtext` node means the editor shows a
 * plain box for a value the renderer will sanitize as markup, or the reverse —
 * an author typing HTML into a field that escapes it, and nobody able to say
 * which of the two is wrong. The mismatch is refused instead.
 */
export const StructuredFieldDef = z.strictObject({
  name: z
    .string()
    .regex(SLOT_ID, 'a field name must be a letter followed by letters, digits, _ or -, up to 64 characters'),
  type: z.enum(STRUCTURED_FIELD_TYPES),
  label: z.string().min(1),
})
export type StructuredFieldDef = z.infer<typeof StructuredFieldDef>

export const StructuredDocument = z
  .strictObject({
    // The document repeats the version its row's column carries. Both are checked,
    // and against each other: the column is what the database vouched for and the
    // document is what the compiler wrote, and a row where those two disagree is
    // one where somebody rewrote half of it.
    schemaVersion: z.number().int(),
    fields: z.array(StructuredFieldDef),
    nodes: z.array(StructuredNode),
  })
  .check(ctx => {
    const seen = new Set<string>()
    for (const field of ctx.value.fields) {
      if (seen.has(field.name)) {
        ctx.issues.push({
          code: 'custom',
          input: field.name,
          message: `field ${field.name} is declared twice, so nothing can say what type it is`,
        })
      }
      seen.add(field.name)
    }
  })
export type StructuredDocument = z.infer<typeof StructuredDocument>

/**
 * Every field node in the document, in document order.
 *
 * Used to check the nodes against the declarations, which cannot be done inside
 * the node schema itself: a node has no way to see the document it is part of.
 */
export function structuredFieldNodes(nodes: readonly StructuredNode[]): StructuredFieldNode[] {
  // Iterative for the same reason structuredDepth is: this is asked about
  // documents that may be hostile, and a walker that overflows on a deep one
  // answers by crashing. The stack is reversed on push so the result stays in
  // document order, which the editor's field list depends on.
  const out: StructuredFieldNode[] = []
  const stack: StructuredNode[] = [...nodes].reverse()
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === 'provider-embed') continue
    if (node.type !== 'element') {
      out.push(node)
      continue
    }
    const children = node.children ?? []
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]!)
  }
  return out
}

/** Field nodes belonging to a repeat's collection item rather than its page instance. */
export function structuredRepeatItemFieldNodes(node: StructuredRepeatFieldNode): StructuredFieldNode[] {
  const out: StructuredFieldNode[] = []
  const stack: StructuredNode[] = [...node.item].reverse()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current.type === 'element') {
      const children = current.children ?? []
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]!)
      continue
    }
    if (current.type === 'provider-embed') continue
    out.push(current)
    if (current.type === 'repeat') {
      for (let index = current.item.length - 1; index >= 0; index -= 1) stack.push(current.item[index]!)
    }
  }
  return out
}

/**
 * How deeply this node list nests, in the node levels `STRUCTURED_MAX_DEPTH`
 * counts: every entry of `nodes` is at level 1, a child is one level below its
 * parent, and a field node occupies a level exactly like an element does. An
 * empty list is 0, which is the only answer that is not a level.
 *
 * Iterative, with an explicit stack. The recursive version read better and
 * overflowed the call stack somewhere between 100 and 1000 levels — and the
 * whole reason this function exists is to answer a question about documents
 * that might be hostile, so "it crashes on a deep one" means the check is not a
 * check. Run `structuredShapeProblems` first: this still assumes the shape is a
 * node tree, and only that preflight can promise it.
 */
export function structuredDepth(nodes: readonly StructuredNode[]): number {
  let deepest = 0
  const stack: { node: StructuredNode; depth: number }[] = nodes.map(node => ({ node, depth: 1 }))
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!
    if (depth > deepest) deepest = depth
    if (node.type === 'element') {
      for (const child of node.children ?? []) stack.push({ node: child, depth: depth + 1 })
    } else if (node.type === 'repeat') {
      for (const child of node.item) stack.push({ node: child, depth: depth + 1 })
    }
  }
  return deepest
}
