import { MAX_ATTRIBUTE_LENGTH, MAX_ATTRIBUTE_TOKENS } from './structured-markup.ts'
import {
  STRUCTURED_MAX_DEPTH,
  STRUCTURED_SCHEMA_VERSION,
  STRUCTURED_UPGRADABLE_SCHEMA_VERSIONS,
  StructuredDocument,
  structuredFieldNodes,
} from './structured-nodes.ts'

/**
 * Bounds every structured document is held to, in one place because two layers
 * enforce them and a limit that differs between them is a document one layer
 * stores and the other refuses to render.
 *
 * The numbers are deliberately far above anything the V1 catalogue contains —
 * its deepest definition nests 9 levels and its largest has 41 nodes — because
 * these are not a design budget. They are the point past which a document stops
 * being a section and starts being a way to spend the renderer's stack.
 */
export const STRUCTURED_LIMITS = {
  /** Node levels on the deepest path, in the sense `STRUCTURED_MAX_DEPTH` defines. */
  depth: STRUCTURED_MAX_DEPTH,
  /** Nodes in the whole document, at every level together. */
  nodes: 2_000,
  /** Entries in the document's `fields` array. */
  fields: 256,
  /** Entries in one element's `children` array. Siblings, not descendants. */
  childrenPerElement: 512,
  /** Keys in one node's `attributes` or `staticAttributes` object. */
  attributes: 64,
  /** One attribute's name and value added together, in characters. */
  attributeLength: MAX_ATTRIBUTE_LENGTH,
  /** Entries in one token-list attribute: a field node's `class` or `rel`. */
  attributeTokens: MAX_ATTRIBUTE_TOKENS,
  /** One field declaration's label, in characters. */
  labelLength: 256,
} as const

/**
 * The stable names for what `structuredShapeDefects` can find.
 *
 * A code as well as a sentence, because the sentences are written for an author
 * and a test that asserts one is asserting the wording. Every bound below was
 * reached by a document that returned "a problem" from a suite that could not
 * say *which* problem — so a fixture carrying an unrelated defect passed the
 * boundary test it was supposed to fail, and the boundary was never checked at
 * all. The code is what a test asserts; the message is what a person reads.
 */
export const STRUCTURED_SHAPE_CODES = [
  'not-a-document',
  'no-node-list',
  'too-many-fields',
  'field-label-too-long',
  'too-many-nodes',
  'too-deep',
  'too-many-children',
  'too-many-attributes',
  'attribute-too-long',
  'too-many-attribute-tokens',
  'node-container-conflict',
  'node-is-its-own-ancestor',
  'node-used-twice',
] as const
export type StructuredShapeCode = (typeof STRUCTURED_SHAPE_CODES)[number]

/** One thing wrong with a document: a name for a test, a sentence for a person. */
export type StructuredProblem<Code extends string = string> = {
  readonly code: Code
  readonly message: string
}

/** The sentences, for callers that only ever showed the sentences. */
export function structuredProblemMessages(problems: readonly StructuredProblem[]): string[] {
  return problems.map(problem => problem.message)
}

/**
 * How many characters a static attribute value would occupy on the page.
 *
 * The *rendered* length rather than the stored one, so the bound means the same
 * thing for a token list as it does for a string: a `class` of four tokens costs
 * the four tokens and the three spaces between them, which is exactly what
 * `class="…"` will contain. Measuring the JSON instead would count the quotes
 * and commas, and the number in the message would be about a serialization
 * nobody sees.
 */
function staticAttributeLength(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (typeof value === 'number') return String(value).length
  if (!Array.isArray(value)) return 0
  let total = 0
  for (const token of value) total += (typeof token === 'string' ? token.length : 0) + 1
  return total === 0 ? 0 : total - 1
}

/**
 * Everything structurally wrong with an *unvalidated* document, found without
 * recursing once.
 *
 * This runs before Zod, and that order is the whole point. `StructuredDocument`
 * is a recursive schema: parsing a 1,000-deep node list overflows the call
 * stack inside Zod, so a limit expressed as a check performed *after* parsing
 * is a limit that never gets to run. The declared maximum depth of 16 did not
 * protect anything, because reaching the code that enforced it required
 * surviving the parse that the depth was supposed to make safe.
 *
 * It is also the only layer that can see a cycle. A document read from JSON or
 * from the database cannot contain one, but this module is exported and an
 * in-memory caller can hand it an object graph that points at itself — which is
 * an infinite descent for every recursive consumer downstream. A repeated
 * reference that is *not* a cycle is refused too, and named separately; see the
 * walk below for why the two are worth telling apart.
 *
 * Deliberately shape-tolerant: it walks whatever it is given and reports what is
 * too big or self-referential. Saying what is *wrong* with a node is Zod's job,
 * and this exists so that job can be done at all.
 */
export function structuredShapeDefects(document: unknown): StructuredProblem<StructuredShapeCode>[] {
  const defect = (code: StructuredShapeCode, message: string) => ({ code, message })
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return [defect('not-a-document', 'is not a structured document')]
  }
  const problems: StructuredProblem<StructuredShapeCode>[] = []
  const doc = document as { nodes?: unknown; fields?: unknown }

  if (Array.isArray(doc.fields) && doc.fields.length > STRUCTURED_LIMITS.fields) {
    problems.push(
      defect(
        'too-many-fields',
        `declares ${doc.fields.length} fields, more than the ${STRUCTURED_LIMITS.fields} a section may have`,
      ),
    )
  }
  for (const field of Array.isArray(doc.fields) ? doc.fields : []) {
    const label: unknown = (field as { label?: unknown })?.label
    if (typeof label === 'string' && label.length > STRUCTURED_LIMITS.labelLength) {
      problems.push(
        defect('field-label-too-long', `has a field label longer than ${STRUCTURED_LIMITS.labelLength} characters`),
      )
      break
    }
  }

  if (!Array.isArray(doc.nodes)) return [...problems, defect('no-node-list', 'has no node list')]

  // Answered before anything is walked, because the widest hostile document is
  // one flat array and walking it to count it is the whole attack. Every entry
  // of `nodes` is a node at level 1, so a list longer than the budget is over
  // the budget whatever the entries turn out to be, and this costs one read of
  // a length rather than a traversal of five million objects.
  if (doc.nodes.length > STRUCTURED_LIMITS.nodes) {
    return [...problems, defect('too-many-nodes', `has more than ${STRUCTURED_LIMITS.nodes} nodes`)]
  }

  // A depth-first walk with an explicit stack, carrying a `leave` frame under
  // each node's children so `onPath` is exactly the ancestors of the node being
  // entered. That is what separates the two ways one object can turn up twice:
  //
  //   - on the current path, which is a *cycle* — following the children again
  //     leads back here, and every recursive consumer downstream descends
  //     forever;
  //   - already finished, which is a repeated reference — the same child object
  //     used in two places, a directed acyclic graph rather than a loop, which
  //     terminates but is not a tree.
  //
  // Both are refused, because a document that arrived as JSON or out of a
  // database column can be neither, so either one means an in-memory caller
  // built something this model cannot store. They are refused with different
  // sentences because they are different mistakes, and telling somebody their
  // document contains a cycle when it contains a shared node sends them looking
  // for a loop that is not there.
  const seen = new Set<object>()
  const onPath = new Set<object>()
  type Frame =
    | { readonly leave: object }
    | { readonly leave?: undefined; readonly node: unknown; readonly depth: number }
  const stack: Frame[] = []
  for (let i = doc.nodes.length - 1; i >= 0; i -= 1) stack.push({ node: doc.nodes[i], depth: 1 })
  let count = 0

  while (stack.length > 0) {
    const frame = stack.pop()!
    if (frame.leave !== undefined) {
      onPath.delete(frame.leave)
      continue
    }
    const { node, depth } = frame
    if (node === null || typeof node !== 'object') continue

    if (onPath.has(node)) {
      return [
        ...problems,
        defect('node-is-its-own-ancestor', 'contains a node that is its own ancestor, so reading it never finishes'),
      ]
    }
    if (seen.has(node)) {
      return [
        ...problems,
        defect('node-used-twice', 'uses one node object in two places, which no stored document can do'),
      ]
    }
    seen.add(node)
    onPath.add(node)
    stack.push({ leave: node })

    count += 1
    if (count > STRUCTURED_LIMITS.nodes) {
      return [...problems, defect('too-many-nodes', `has more than ${STRUCTURED_LIMITS.nodes} nodes`)]
    }
    if (depth > STRUCTURED_LIMITS.depth) {
      return [...problems, defect('too-deep', `nests deeper than ${STRUCTURED_LIMITS.depth} levels`)]
    }

    const attributes = (node as { attributes?: unknown }).attributes
    if (attributes !== null && typeof attributes === 'object') {
      const entries = Object.entries(attributes as Record<string, unknown>)
      if (entries.length > STRUCTURED_LIMITS.attributes) {
        return [
          ...problems,
          defect('too-many-attributes', `has an element carrying more than ${STRUCTURED_LIMITS.attributes} attributes`),
        ]
      }
      for (const [name, value] of entries) {
        if (name.length + (typeof value === 'string' ? value.length : 0) > STRUCTURED_LIMITS.attributeLength) {
          return [
            ...problems,
            defect(
              'attribute-too-long',
              `has an attribute longer than ${STRUCTURED_LIMITS.attributeLength} characters`,
            ),
          ]
        }
      }
    }

    // The same three questions of a field node's `staticAttributes`, and asked
    // separately because the shape is different: its values are token lists and
    // numbers rather than strings, so the length above would have measured a
    // thousand-token class list as nothing at all. A separate key name rather
    // than a second shape under `attributes` is what makes that difference
    // visible to every reader — this one, the Zod schemas, and the SQL — instead
    // of being a thing each of them has to remember.
    const staticAttributes = (node as { staticAttributes?: unknown }).staticAttributes
    if (staticAttributes !== null && typeof staticAttributes === 'object') {
      const entries = Object.entries(staticAttributes as Record<string, unknown>)
      if (entries.length > STRUCTURED_LIMITS.attributes) {
        return [
          ...problems,
          defect('too-many-attributes', `has an element carrying more than ${STRUCTURED_LIMITS.attributes} attributes`),
        ]
      }
      for (const [name, value] of entries) {
        if (Array.isArray(value) && value.length > STRUCTURED_LIMITS.attributeTokens) {
          return [
            ...problems,
            defect(
              'too-many-attribute-tokens',
              `has an attribute of more than ${STRUCTURED_LIMITS.attributeTokens} tokens`,
            ),
          ]
        }
        if (name.length + staticAttributeLength(value) > STRUCTURED_LIMITS.attributeLength) {
          return [
            ...problems,
            defect(
              'attribute-too-long',
              `has an attribute longer than ${STRUCTURED_LIMITS.attributeLength} characters`,
            ),
          ]
        }
      }
    }

    const rawNode = node as { type?: unknown; children?: unknown; item?: unknown }
    const isRepeat = rawNode.type === 'repeat'
    if ((isRepeat && Object.hasOwn(rawNode, 'children')) || (!isRepeat && Object.hasOwn(rawNode, 'item'))) {
      return [
        ...problems,
        defect('node-container-conflict', 'has a node carrying the child container of a different node type'),
      ]
    }
    // Select by discriminator, never by whichever key happens to be first.
    // Otherwise a hostile repeat can carry a shallow `children` decoy and put
    // its real, deep item tree in `item`, overflowing recursive Zod before the
    // preflight reaches it.
    const children = isRepeat ? rawNode.item : rawNode.children
    if (!Array.isArray(children)) continue
    if (children.length > STRUCTURED_LIMITS.childrenPerElement) {
      return [
        ...problems,
        defect('too-many-children', `has an element with more than ${STRUCTURED_LIMITS.childrenPerElement} children`),
      ]
    }
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push({ node: children[i], depth: depth + 1 })
    }
  }

  return problems
}

/**
 * The same answer as `structuredShapeDefects`, as the sentences alone.
 *
 * Kept because every caller that predates the codes wants exactly this, and a
 * second walk with a second set of rules is how the two spellings of "is this
 * document valid" come to disagree.
 */
export function structuredShapeProblems(document: unknown): string[] {
  return structuredProblemMessages(structuredShapeDefects(document))
}

/**
 * A document written against an older schema version, at the current one — or
 * null when there is no such document.
 *
 * The whole upgrade is the version number. Schema v2 differs from v1 only by
 * what a `link` or `image` field node *may* carry, and a v1 node carries none of
 * it, so an upgraded v1 node has no `staticAttributes` key at all — not an empty
 * object, which would be a v2 node claiming a definition author had considered
 * the question and answered "nothing". That distinction is the point of the
 * function existing rather than being a `jsonb_set` in a migration and a
 * sentence in a changelog: an upgrade that *inferred* attributes would be
 * reading V1's intent out of a document that never expressed it, and would do it
 * for 118 definitions at once with nobody watching.
 *
 * It is total and it never throws. The preflight runs first, so a hostile
 * document is refused rather than parsed, and everything else is decided by the
 * same schema the renderer and the database use. Idempotent: a document already
 * at the current version comes back unchanged, so running the upgrade twice is
 * running it once.
 */
export function upgradeStructuredDocument(document: unknown): StructuredDocument | null {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) return null
  if (structuredShapeDefects(document).length > 0) return null

  const version = (document as { schemaVersion?: unknown }).schemaVersion
  const upgradable = (STRUCTURED_UPGRADABLE_SCHEMA_VERSIONS as readonly unknown[]).includes(version)
  if (version !== STRUCTURED_SCHEMA_VERSION && !upgradable) return null

  const parsed = StructuredDocument.safeParse({ ...document, schemaVersion: STRUCTURED_SCHEMA_VERSION })
  if (!parsed.success) return null

  // The check that makes "a v1 node has no attributes" true rather than merely
  // intended. Re-stamping the version and re-parsing would happily accept a
  // hand-built v1 document whose field nodes already carried `staticAttributes`
  // — a key v1 refused — and call the result an upgrade. It is not: it is a v2
  // document that has never been through a v2 gate, arriving with the
  // provenance of one that was.
  if (version === 1) {
    for (const node of structuredFieldNodes(parsed.data.nodes)) {
      if ('staticAttributes' in node && node.staticAttributes !== undefined) return null
    }
  }
  return parsed.data
}
