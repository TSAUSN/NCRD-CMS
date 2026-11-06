// A structured document arrives from a database row, and a row can say
// anything. These are the bounds that make "fails closed" true for documents
// whose shape is the attack rather than their content.
//
// The reproduction that motivated the file: about 5,000 nested element nodes
// ending in one text field, which crashed `structuredSectionProblems` with
// RangeError: Maximum call stack size exceeded. The declared maximum depth of
// 16 protected nothing, because `StructuredDocument` is a recursive Zod schema
// and the parse that overflowed ran *before* the check that would have refused
// the document.
//
// Two rules this file follows, both learned from the version of it that did
// not. Every fixture varies exactly one thing, because a depth fixture that is
// also missing a field declaration passes a depth test for the wrong reason and
// would pass it at any depth at all. And every refusal is asserted by code
// rather than by sentence: `toContain('a problem')` is satisfied by any problem,
// which is how a boundary comes to be tested by a document that was never near
// it.
import { describe, expect, it } from 'vitest'
import {
  STRUCTURED_LIMITS,
  STRUCTURED_SCHEMA_VERSION,
  structuredDepth,
  structuredFieldNodes,
  structuredShapeDefects,
  structuredShapeProblems,
} from '@cms/schema'
import {
  STRUCTURED_SECTION_CODES,
  renderStructuredBody,
  structuredSectionDefects,
  structuredSectionProblems,
} from './structured.ts'
import { renderSection, type ManifestSection } from './render.ts'

/**
 * A valid document whose deepest path holds exactly `levels` nodes.
 *
 * `levels - 1` elements wrapping one text field, because the field node is a
 * node and occupies a level of its own — the counting convention every layer
 * shares, spelled out at `STRUCTURED_MAX_DEPTH`. Nothing else about the
 * document changes with the argument: the same field, the same declaration, the
 * same tag all the way down.
 */
function atDepth(levels: number): unknown {
  let node: unknown = { type: 'text', field: 'a' }
  for (let i = 1; i < levels; i += 1) node = { type: 'element', tag: 'div', children: [node] }
  return { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [{ name: 'a', type: 'text', label: 'A' }], nodes: [node] }
}

const definition = (doc: unknown) =>
  ({
    section_def_id: 'd',
    version: 1,
    slug: 'd',
    definition_kind: 'structured',
    structured_doc: doc,
    structured_schema_version: STRUCTURED_SCHEMA_VERSION,
    css: '',
    slots: [],
    render_hash: 'h',
    css_policy_version: 6,
  }) as never

/** The codes alone, which is what a boundary test is actually asserting. */
const codesOf = (doc: unknown) => structuredSectionDefects(definition(doc)).map(p => p.code)

const section = (doc: unknown): ManifestSection =>
  ({
    def: {
      section_def_id: 'd',
      version: 1,
      slug: 'd',
      definition_kind: 'structured',
      structured_doc: doc,
      structured_schema_version: STRUCTURED_SCHEMA_VERSION,
      compiled_ast: { nodes: [], policyVersion: 4, cssPolicyVersion: 6 },
      css: '',
      slots: [],
      render_hash: 'h',
      sanitizer_policy_version: 4,
      css_policy_version: 6,
    },
    instance: { label: 'S', hidden: false, hidden_at: [], values: { a: 'visible' } },
  }) as unknown as ManifestSection

// --------------------------------------------------------- the depth boundary

describe('the numbers themselves, because the other half of the system cannot see them', () => {
  it('is sixteen levels, two thousand nodes, and the rest exactly as migration 0021 spells them', () => {
    // Written as literals on purpose. Every test below is parameterised by
    // `STRUCTURED_LIMITS`, so it follows the constant wherever the constant
    // goes — which means raising the limit would break nothing here, while the
    // database went on refusing at the old number. That is the failure this
    // schema has already met three times: a definition accepted by one layer,
    // refused by the other, and visible nowhere. `app.structured_shape_defect`
    // hard-codes these numbers in SQL and no TypeScript test can read it, so
    // this is the line that has to be edited in the same commit as the
    // migration, and the reason to go and edit it.
    expect(STRUCTURED_LIMITS).toEqual({
      depth: 16,
      nodes: 2_000,
      fields: 256,
      childrenPerElement: 512,
      attributes: 64,
      attributeLength: 512,
      attributeTokens: 32,
      labelLength: 256,
    })
  })

  it('accepts sixteen node levels and refuses seventeen, in literals', () => {
    // The boundary stated without reference to the constant, so a change to
    // the constant fails here rather than quietly redefining what the tests
    // below are testing.
    expect(codesOf(atDepth(16))).toEqual([])
    expect(codesOf(atDepth(17))).toEqual(['too-deep'])
  })
})

describe('the depth limit counts node levels, and the field node is one of them', () => {
  it('agrees with the fixture about what a level is, so the tests below mean what they say', () => {
    // The convention, asserted rather than described: three nodes on the path,
    // of which the innermost is the field. If this ever drifts, every boundary
    // below drifts with it silently, so it is checked first and separately.
    const three = atDepth(3) as { nodes: never[] }
    expect(structuredDepth(three.nodes)).toBe(3)
    expect(three).toEqual({
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      fields: [{ name: 'a', type: 'text', label: 'A' }],
      nodes: [
        {
          type: 'element',
          tag: 'div',
          children: [{ type: 'element', tag: 'div', children: [{ type: 'text', field: 'a' }] }],
        },
      ],
    })
  })

  it.each([1, 2, STRUCTURED_LIMITS.depth - 1, STRUCTURED_LIMITS.depth])(
    'accepts a document of %i levels with nothing else wrong with it',
    levels => {
      const doc = atDepth(levels)
      expect(structuredDepth((doc as { nodes: never[] }).nodes)).toBe(levels)
      // Zero problems, not "no depth problem". A fixture carrying an unrelated
      // defect would satisfy the weaker claim while proving nothing about the
      // bound, which is exactly how the accepted side of a boundary goes
      // unchecked.
      expect(codesOf(doc)).toEqual([])
    },
  )

  it('accepts the literal sixteen, which is what the limit says out loud', () => {
    // Fifteen elements around one field. An author reading "16" should be able
    // to nest fifteen tags and put a field inside them, and this is the test
    // that says so in the shape an author would write.
    expect(codesOf(atDepth(16))).toEqual([])
    expect(renderStructuredBody(definition(atDepth(16)), { a: 'x' }, {})).toBe(
      `${'<div>'.repeat(15)}x${'</div>'.repeat(15)}`,
    )
  })

  it.each([STRUCTURED_LIMITS.depth + 1, 100, 1_000, 5_000, 50_000])(
    'refuses a document of %i levels, and says that is what is wrong with it',
    levels => {
      const doc = atDepth(levels)
      expect(structuredDepth((doc as { nodes: never[] }).nodes)).toBe(levels)
      expect(codesOf(doc)).toEqual(['too-deep'])
      expect(structuredSectionProblems(definition(doc))).toEqual([
        `nests deeper than ${STRUCTURED_LIMITS.depth} levels`,
      ])
    },
  )

  it('answers about the deepest document quickly, because refusing slowly is its own denial of service', () => {
    const doc = atDepth(50_000)
    const started = performance.now()
    structuredSectionProblems(definition(doc))
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})

// ----------------------------------------------- one object reached two ways

describe('a node object that turns up twice', () => {
  /** A node that is its own child: the shortest cycle there is. */
  const selfCycle = () => {
    const node: Record<string, unknown> = { type: 'element', tag: 'div', children: [] }
    ;(node['children'] as unknown[]).push(node)
    return { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [], nodes: [node] }
  }

  /** A cycle two hops around, so detection cannot be a same-object shortcut. */
  const longCycle = () => {
    const outer: Record<string, unknown> = { type: 'element', tag: 'div', children: [] }
    const inner: Record<string, unknown> = { type: 'element', tag: 'span', children: [outer] }
    ;(outer['children'] as unknown[]).push(inner)
    return { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [], nodes: [outer] }
  }

  /**
   * The same child object used twice as a sibling: a directed acyclic graph,
   * not a loop.
   *
   * This terminates. Every recursive consumer downstream reads it happily and
   * renders the shared subtree twice, and the node count is wrong by however
   * many times it is shared. It is still refused — no document that arrived as
   * JSON or out of a jsonb column can contain one, so an in-memory caller built
   * something this model cannot store — but it is not a cycle and is not
   * described as one.
   */
  const sharedSibling = () => {
    const child = { type: 'text', field: 'a' }
    return {
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      fields: [{ name: 'a', type: 'text', label: 'A' }],
      nodes: [{ type: 'element', tag: 'div', children: [child, child] }],
    }
  }

  /** The same subtree hung under two different parents, one level apart. */
  const sharedCousin = () => {
    const shared = { type: 'element', tag: 'span', children: [{ type: 'text', field: 'a' }] }
    return {
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      fields: [{ name: 'a', type: 'text', label: 'A' }],
      nodes: [
        { type: 'element', tag: 'div', children: [shared] },
        { type: 'element', tag: 'p', children: [shared] },
      ],
    }
  }

  it.each([
    ['its own child', selfCycle],
    ['two hops around', longCycle],
  ])('is a cycle when it is %s, and is refused as one', (_label, build) => {
    expect(codesOf(build())).toEqual(['node-is-its-own-ancestor'])
    expect(structuredSectionProblems(definition(build()))).toEqual([
      'contains a node that is its own ancestor, so reading it never finishes',
    ])
  })

  it.each([
    ['as a sibling', sharedSibling],
    ['under two parents', sharedCousin],
  ])('is a repeated reference when the same object is used %s, and is refused as that', (_label, build) => {
    expect(codesOf(build())).toEqual(['node-used-twice'])
  })

  it('never calls a repeated reference a cycle, because the author would go looking for a loop', () => {
    // The distinction is the point. Both documents are refused; only one of
    // them contains something that never finishes, and the sentence has to be
    // true of the document it is about.
    const shared = structuredSectionProblems(definition(sharedSibling())).join(' ')
    expect(shared).toBe('uses one node object in two places, which no stored document can do')
    expect(shared).not.toContain('ancestor')
    expect(structuredSectionProblems(definition(selfCycle())).join(' ')).toContain('ancestor')
  })

  it('tells a legal document that merely repeats a field apart from a repeated object', () => {
    // Two distinct objects that happen to be equal are an ordinary document —
    // the same field rendered in two places is a thing sections do. Refusing
    // that would refuse the catalogue.
    const doc = {
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      fields: [{ name: 'a', type: 'text', label: 'A' }],
      nodes: [
        {
          type: 'element',
          tag: 'div',
          children: [
            { type: 'text', field: 'a' },
            { type: 'text', field: 'a' },
          ],
        },
      ],
    }
    expect(codesOf(doc)).toEqual([])
  })
})

// ------------------------------------------------------- wide but shallow

/**
 * `parents` elements each carrying `children` leaf children, plus `extra` leaves
 * at the top. Two levels deep whatever the counts, so nothing here is ever
 * refused for depth by accident.
 */
function wide(parents: number, children: number, extra = 0): unknown {
  const leaf = () => ({ type: 'element', tag: 'span' })
  return {
    schemaVersion: STRUCTURED_SCHEMA_VERSION,
    fields: [],
    nodes: [
      ...Array.from({ length: parents }, () => ({
        type: 'element',
        tag: 'div',
        children: Array.from({ length: children }, leaf),
      })),
      ...Array.from({ length: extra }, leaf),
    ],
  }
}

const withAttributes = (attributes: Record<string, string>) => ({
  schemaVersion: STRUCTURED_SCHEMA_VERSION,
  fields: [],
  nodes: [{ type: 'element', tag: 'div', attributes }],
})

const withFields = (count: number, label = 'F') => ({
  schemaVersion: STRUCTURED_SCHEMA_VERSION,
  nodes: [],
  fields: Array.from({ length: count }, (_, i) => ({ name: `f${i}`, type: 'text', label })),
})

/**
 * One link field node carrying the given definition-owned attributes.
 *
 * A link rather than an element, because `staticAttributes` is the schema v2
 * key that only a link or an image field node has — and the preflight measures
 * it separately from an element's `attributes`, whose values are strings rather
 * than token lists.
 */
const withStaticAttributes = (staticAttributes: Record<string, unknown>) => ({
  schemaVersion: STRUCTURED_SCHEMA_VERSION,
  fields: [{ name: 'a', type: 'link', label: 'A' }],
  nodes: [{ type: 'link', field: 'a', staticAttributes }],
})

/**
 * A class list whose rendered `class="…"` value is exactly `length` characters:
 * the tokens plus the single space between each pair, which is what the
 * attribute will actually contain.
 *
 * Built from the token count up rather than greedily from the front, because a
 * greedy fill of 64-character tokens cannot express every length — 65 needs two
 * tokens of 1 and 63, not one of 64 — and a helper that is wrong for some
 * argument is a boundary test that silently checks a different boundary. Every
 * token gets a different first letter for the same reason: a class list refuses
 * a repeated token, so a fixture of identical ones would be refused for that
 * and never reach the length being tested.
 */
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEF'

function classTokens(length: number): string[] {
  const count = Math.max(1, Math.ceil((length + 1) / 65))
  let characters = length - (count - 1)
  return Array.from({ length: count }, (_, i) => {
    const size = Math.min(64, characters - (count - 1 - i))
    characters -= size
    return LETTERS[i % LETTERS.length]! + 'c'.repeat(size - 1)
  })
}

const renderedLength = (tokens: string[]) => tokens.join(' ').length

describe('a document that is wide rather than deep is bounded too', () => {
  it('counts every node in the document, not only the top-level ones', () => {
    // 4 parents of 499 children is 2,000 nodes exactly, and the fixture would
    // be nowhere near the limit if only the four top-level entries counted.
    expect(structuredDepth((wide(4, 499) as { nodes: never[] }).nodes)).toBe(2)
    expect(codesOf(wide(4, 499))).toEqual([])
    expect(codesOf(wide(4, 499, 1))).toEqual(['too-many-nodes'])
  })

  it.each([
    [STRUCTURED_LIMITS.nodes - 1, []],
    [STRUCTURED_LIMITS.nodes, []],
    [STRUCTURED_LIMITS.nodes + 1, ['too-many-nodes']],
  ])('has %i sibling nodes and answers %j', (count, expected) => {
    const doc = {
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      fields: [],
      nodes: Array.from({ length: count }, () => ({ type: 'element', tag: 'span' })),
    }
    expect(codesOf(doc)).toEqual(expected)
  })

  it.each([
    [STRUCTURED_LIMITS.childrenPerElement - 1, []],
    [STRUCTURED_LIMITS.childrenPerElement, []],
    [STRUCTURED_LIMITS.childrenPerElement + 1, ['too-many-children']],
  ])('gives one element %i children and answers %j', (count, expected) => {
    expect(codesOf(wide(1, count))).toEqual(expected)
  })

  it.each([
    [STRUCTURED_LIMITS.fields - 1, []],
    [STRUCTURED_LIMITS.fields, []],
    [STRUCTURED_LIMITS.fields + 1, ['too-many-fields']],
  ])('declares %i fields and answers %j', (count, expected) => {
    expect(codesOf(withFields(count))).toEqual(expected)
  })

  it.each([
    [STRUCTURED_LIMITS.labelLength - 1, []],
    [STRUCTURED_LIMITS.labelLength, []],
    [STRUCTURED_LIMITS.labelLength + 1, ['field-label-too-long']],
  ])('gives a field a label of %i characters and answers %j', (length, expected) => {
    expect(codesOf(withFields(1, 'L'.repeat(length)))).toEqual(expected)
  })

  it.each([
    [STRUCTURED_LIMITS.attributeLength - 1, []],
    [STRUCTURED_LIMITS.attributeLength, []],
    [STRUCTURED_LIMITS.attributeLength + 1, ['attribute-too-long']],
  ])('carries an attribute of %i characters, name and value together, and answers %j', (length, expected) => {
    // `aria-label` because it is the one attribute whose value has no grammar
    // beyond being non-empty: any other allowlisted name would fail its own
    // pattern long before the length mattered, and the fixture would be testing
    // that instead. Name and value are counted together, which is why the value
    // is ten characters shorter than the number in the test's name.
    expect(codesOf(withAttributes({ 'aria-label': 'x'.repeat(length - 'aria-label'.length) }))).toEqual(expected)
  })

  it.each([
    [STRUCTURED_LIMITS.attributes - 1, []],
    [STRUCTURED_LIMITS.attributes, []],
    [STRUCTURED_LIMITS.attributes + 1, ['too-many-attributes']],
  ])('carries %i attributes on one element and answers %j from the preflight', (count, expected) => {
    // The preflight alone, because there are only nine attribute names an
    // element may carry: a document with sixty-four of them cannot also be a
    // valid one, so the whole-definition check would refuse it for its names
    // and this bound would never be the reason. The preflight's contract is
    // size, and size is what is asserted here.
    const doc = withAttributes(Object.fromEntries(Array.from({ length: count }, (_, i) => [`data-a${i}`, 'v'])))
    expect(structuredShapeDefects(doc).map(p => p.code)).toEqual(expected)
  })

  it('still refuses sixty-four unlisted attributes as a whole definition, for their names', () => {
    // The counterpart to the test above, so "the preflight is clean" is never
    // mistaken for "this document is acceptable".
    const doc = withAttributes(
      Object.fromEntries(Array.from({ length: STRUCTURED_LIMITS.attributes }, (_, i) => [`data-a${i}`, 'v'])),
    )
    expect(new Set(codesOf(doc))).toEqual(new Set(['node-refused']))
  })

  it('refuses a huge attribute value even when its name is one an element may carry', () => {
    const huge = withAttributes({ 'aria-label': 'x'.repeat(50_000) })
    expect(codesOf(huge)).toEqual(['attribute-too-long'])
  })

  it.each([
    [STRUCTURED_LIMITS.attributeTokens - 1, []],
    [STRUCTURED_LIMITS.attributeTokens, []],
    [STRUCTURED_LIMITS.attributeTokens + 1, ['too-many-attribute-tokens']],
  ])('gives a field node a class list of %i tokens and answers %j', (count, expected) => {
    const doc = withStaticAttributes({ class: Array.from({ length: count }, (_, i) => `c${i}`) })
    expect(codesOf(doc)).toEqual(expected)
  })

  it.each([
    [STRUCTURED_LIMITS.attributeLength - 1, []],
    [STRUCTURED_LIMITS.attributeLength, []],
    [STRUCTURED_LIMITS.attributeLength + 1, ['attribute-too-long']],
  ])('renders a class list of %i characters, name and value together, and answers %j', (length, expected) => {
    // The rendered length rather than the stored one: a token list costs its
    // tokens and the spaces between them, which is what `class="…"` contains.
    // Measuring the JSON would count quotes and commas nobody ever sees, and the
    // bound would be about a serialization rather than about the page.
    const tokens = classTokens(length - 'class'.length)
    expect(renderedLength(tokens)).toBe(length - 'class'.length)
    expect(codesOf(withStaticAttributes({ class: tokens }))).toEqual(expected)
  })

  it('refuses a class list of a hundred thousand tokens without adding them up', () => {
    // The token count is read before the characters are summed, so the widest
    // hostile token list costs one length comparison rather than a hundred
    // thousand string reads. Same reasoning as the flat node list above.
    const doc = withStaticAttributes({ class: Array.from({ length: 100_000 }, (_, i) => `c${i}`) })
    const started = performance.now()
    expect(structuredShapeDefects(doc).map(p => p.code)).toEqual(['too-many-attribute-tokens'])
    expect(performance.now() - started).toBeLessThan(500)
  })

  it.each([
    [STRUCTURED_LIMITS.attributes, []],
    [STRUCTURED_LIMITS.attributes + 1, ['too-many-attributes']],
  ])('carries %i static attributes on one field node and answers %j from the preflight', (count, expected) => {
    // The preflight alone, for the reason the element case above gives: a link
    // field node may carry three static attributes, so a document with
    // sixty-five of them cannot also be a valid one and the whole-definition
    // check would refuse it for their names.
    const doc = withStaticAttributes(Object.fromEntries(Array.from({ length: count }, (_, i) => [`data-a${i}`, 'v'])))
    expect(structuredShapeDefects(doc).map(p => p.code)).toEqual(expected)
  })

  it('refuses a huge label even when the document declares only one field', () => {
    expect(codesOf(withFields(1, 'L'.repeat(50_000)))).toEqual(['field-label-too-long'])
  })

  it('answers about the widest hostile document without walking it', () => {
    // A flat list of a million nodes is the cheapest hostile document there is
    // to write and the most expensive to count. The length of the node list is
    // read before anything is walked, so this is a length comparison rather
    // than a million pops.
    const doc = {
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      fields: [],
      nodes: Array.from({ length: 1_000_000 }, () => ({})),
    }
    const started = performance.now()
    expect(structuredShapeDefects(doc).map(p => p.code)).toEqual(['too-many-nodes'])
    expect(performance.now() - started).toBeLessThan(500)
  })
})

// ------------------------------------------------------- documents that are not

describe('a value that is not a document at all', () => {
  it.each([
    ['null', null],
    ['a string', 'nodes'],
    ['a number', 7],
    ['an array', []],
    ['a boolean', true],
    ['undefined', undefined],
  ])('refuses %s', (_label, input) => {
    expect(structuredShapeDefects(input).map(p => p.code)).toEqual(['not-a-document'])
  })

  it('refuses a document with no node list', () => {
    expect(structuredShapeDefects({ schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [] }).map(p => p.code)).toEqual([
      'no-node-list',
    ])
  })

  it('reports the field problems it already found alongside the missing node list', () => {
    // The field checks accumulate and the node walk returns on the first
    // structural refusal, so a document that is wrong in both ways says both.
    // Anything else would have an author fix one problem to be told about the
    // next.
    const doc = {
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      fields: Array.from({ length: 300 }, (_, i) => ({ name: `f${i}`, type: 'text', label: 'F' })),
    }
    expect(structuredShapeDefects(doc).map(p => p.code)).toEqual(['too-many-fields', 'no-node-list'])
  })
})

// --------------------------------------------------------------- never throws

/** Every hostile shape in this file, by the name a failure should print. */
const HOSTILE: [string, unknown][] = [
  ['seventeen levels', atDepth(STRUCTURED_LIMITS.depth + 1)],
  ['one hundred levels', atDepth(100)],
  ['one thousand levels', atDepth(1_000)],
  ['five thousand levels', atDepth(5_000)],
  ['fifty thousand levels', atDepth(50_000)],
  [
    'a node that is its own child',
    (() => {
      const node: Record<string, unknown> = { type: 'element', tag: 'div', children: [] }
      ;(node['children'] as unknown[]).push(node)
      return { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [], nodes: [node] }
    })(),
  ],
  [
    'a cycle two hops around',
    (() => {
      const outer: Record<string, unknown> = { type: 'element', tag: 'div', children: [] }
      ;(outer['children'] as unknown[]).push({ type: 'element', tag: 'span', children: [outer] })
      return { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [], nodes: [outer] }
    })(),
  ],
  [
    'one node object used twice',
    (() => {
      const child = { type: 'text', field: 'a' }
      return {
        schemaVersion: STRUCTURED_SCHEMA_VERSION,
        fields: [{ name: 'a', type: 'text', label: 'A' }],
        nodes: [{ type: 'element', tag: 'div', children: [child, child] }],
      }
    })(),
  ],
  ['too many sibling nodes', wide(0, 0, STRUCTURED_LIMITS.nodes + 1)],
  ['too many children on one element', wide(1, STRUCTURED_LIMITS.childrenPerElement + 1)],
  ['too many declared fields', withFields(STRUCTURED_LIMITS.fields + 1)],
  ['a label of fifty thousand characters', withFields(1, 'L'.repeat(50_000))],
  ['an attribute of fifty thousand characters', withAttributes({ 'aria-label': 'x'.repeat(50_000) })],
  [
    'too many attributes on one element',
    withAttributes(
      Object.fromEntries(Array.from({ length: STRUCTURED_LIMITS.attributes + 1 }, (_, i) => [`data-a${i}`, 'v'])),
    ),
  ],
  [
    'a class list of a hundred thousand tokens on a field node',
    withStaticAttributes({ class: Array.from({ length: 100_000 }, (_, i) => `c${i}`) }),
  ],
  ['a class token of fifty thousand characters on a field node', withStaticAttributes({ class: ['c'.repeat(50_000)] })],
  [
    'too many static attributes on one field node',
    withStaticAttributes(
      Object.fromEntries(Array.from({ length: STRUCTURED_LIMITS.attributes + 1 }, (_, i) => [`data-a${i}`, 'v'])),
    ),
  ],
  ['a value that is not a document', 'nodes'],
  ['a document with no node list', { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [] }],
]

describe('every hostile document returns a value rather than throwing', () => {
  // The failure this whole file exists for was a throw, not a bad answer. In a
  // request handler a RangeError is a 500 — one stored row taking the page down
  // instead of losing the one section nobody can render.
  it.each(HOSTILE)('%s: the problem list is a list', (_label, doc) => {
    let problems: string[] | undefined
    expect(() => {
      problems = structuredSectionProblems(definition(doc))
    }).not.toThrow()
    expect(problems!.length).toBeGreaterThan(0)
  })

  it.each(HOSTILE)('%s: the body renderer returns null', (_label, doc) => {
    let body: string | null | undefined
    expect(() => {
      body = renderStructuredBody(definition(doc), { a: 'x' }, {})
    }).not.toThrow()
    expect(body).toBeNull()
  })

  it.each(HOSTILE)('%s: the preview body renderer returns null too', (_label, doc) => {
    // Preview runs the same checks and then adds instrumentation, and the
    // editor is where a hostile document is most likely to be looked at.
    let body: string | null | undefined
    expect(() => {
      body = renderStructuredBody(definition(doc), { a: 'x' }, { preview: true })
    }).not.toThrow()
    expect(body).toBeNull()
  })

  it.each(HOSTILE)('%s: public section rendering yields an empty string', (_label, doc) => {
    let html: string | undefined
    expect(() => {
      html = renderSection(section(doc), 0)
    }).not.toThrow()
    expect(html).toBe('')
  })

  it.each(HOSTILE)('%s: preview section rendering yields an empty string', (_label, doc) => {
    let html: string | undefined
    expect(() => {
      html = renderSection(section(doc), 0, { preview: true })
    }).not.toThrow()
    expect(html).toBe('')
    // And nothing of the section survives: no wrapper, so no instrumentation
    // attribute for the editor to bind a selection to.
    expect(html).not.toContain('data-cms-section')
  })
})

describe('the section that is inside the bounds still renders on both paths', () => {
  // The counterpart every refusal test needs: a suite that refused everything
  // would pass all of the above.
  const doc = atDepth(STRUCTURED_LIMITS.depth)

  it('renders the deepest legal document publicly', () => {
    expect(renderSection(section(doc), 0)).toContain('visible')
    expect(renderSection(section(doc), 0)).not.toContain('data-cms-slot')
  })

  it('renders it in preview with the editor instrumentation the editor needs', () => {
    const html = renderSection(section(doc), 0, { preview: true })
    expect(html).toContain('data-cms-slot="a"')
    expect(html).toContain('data-cms-section="0"')
  })
})

// ------------------------------------------------------------ the walkers

describe('the preflight does not recurse, and neither do the walkers', () => {
  // Asserted structurally rather than behaviourally: the depth tests above pass
  // if and only if this holds, but a future edit could reintroduce recursion
  // and only fail on a machine with a larger stack.
  it.each([
    ['structuredShapeDefects', structuredShapeDefects],
    ['structuredDepth', structuredDepth],
    ['structuredFieldNodes', structuredFieldNodes],
  ])('%s calls no function by its own name', (name, fn) => {
    expect(fn.toString().slice(fn.toString().indexOf('{'))).not.toContain(`${name}(`)
  })

  it('still reports depth and field order correctly', () => {
    const doc = {
      type: 'element',
      tag: 'div',
      children: [
        { type: 'text', field: 'one' },
        { type: 'element', tag: 'p', children: [{ type: 'text', field: 'two' }] },
      ],
    } as never
    expect(structuredDepth([doc])).toBe(3)
    expect(structuredFieldNodes([doc]).map(n => n.field)).toEqual(['one', 'two'])
  })

  it('emits no code that is not in the declared vocabulary', () => {
    // The list is what anything downstream would branch on, so a code invented
    // at a callsite and never added to it is a refusal nobody can handle by
    // name. Checked against every hostile document in this file at once.
    for (const [label, doc] of HOSTILE) {
      for (const problem of structuredSectionDefects(definition(doc))) {
        expect(STRUCTURED_SECTION_CODES, label).toContain(problem.code)
      }
    }
  })

  it('keeps the sentence-only spelling in step with the coded one', () => {
    // Two exported answers to one question, and the second is the first with
    // the codes dropped. A separate implementation is how they would come to
    // disagree about a boundary while both looking correct.
    for (const [, doc] of HOSTILE) {
      expect(structuredShapeProblems(doc)).toEqual(structuredShapeDefects(doc).map(p => p.message))
    }
  })
})
