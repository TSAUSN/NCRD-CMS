import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  STRUCTURED_SCHEMA_VERSION,
  StructuredDocument,
  structuredShapeDefects,
  upgradeStructuredDocument,
} from '../src/index.ts'
import { expectSqlState } from './harness.ts'
import { createStructuredSectionFixture, FIELDS, structuredDocument as document } from './structured-section-fixture.ts'

type Fixture = Awaited<ReturnType<typeof createStructuredSectionFixture>>
let db: Fixture['db']
let save: Fixture['save']

beforeAll(async () => {
  const fixture = await createStructuredSectionFixture()
  db = fixture.db
  save = fixture.save
})
afterAll(async () => {
  await db?.close()
})

// PostgreSQL and TypeScript must accept and reject the same documents, node for node.
// A mismatch would let an author publish a section the renderer cannot show.

/** `depth` node levels: `depth - 1` elements around one text field. */
const nestedJson = (depth: number) => {
  const open = '{"type":"element","tag":"div","children":['
  const doc = { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: FIELDS, nodes: [] as unknown[] }
  const nodes = open.repeat(depth - 1) + '{"type":"text","field":"heading"}' + ']}'.repeat(depth - 1)
  return JSON.stringify(doc).replace('"nodes":[]', `"nodes":[${nodes}]`)
}

const LEAF = '{"type":"element","tag":"span"}'
const siblingsJson = (count: number) =>
  `{"schemaVersion":${STRUCTURED_SCHEMA_VERSION},"fields":[],"nodes":[${Array(count).fill(LEAF).join(',')}]}`
const childrenJson = (count: number) =>
  `{"schemaVersion":${STRUCTURED_SCHEMA_VERSION},"fields":[],"nodes":` +
  `[{"type":"element","tag":"div","children":[${Array(count).fill(LEAF).join(',')}]}]}`
const fieldsJson = (count: number, label = 'F') =>
  JSON.stringify({
    schemaVersion: STRUCTURED_SCHEMA_VERSION,
    nodes: [],
    fields: Array.from({ length: count }, (_, i) => ({ name: `f${i}`, type: 'text', label })),
  })
/** One `aria-label` whose name and value add up to `total` characters. */
const attributeJson = (total: number) =>
  JSON.stringify({
    schemaVersion: STRUCTURED_SCHEMA_VERSION,
    fields: [],
    nodes: [
      {
        type: 'element',
        tag: 'div',
        attributes: { 'aria-label': 'x'.repeat(total - 'aria-label'.length) },
      },
    ],
  })
const attributeCountJson = (count: number) =>
  JSON.stringify({
    schemaVersion: STRUCTURED_SCHEMA_VERSION,
    fields: [],
    nodes: [
      {
        type: 'element',
        tag: 'div',
        attributes: Object.fromEntries(Array.from({ length: count }, (_, i) => [`data-a${i}`, 'v'])),
      },
    ],
  })

const sectionDefect = async (json: string): Promise<string | null> => {
  const { rows } = await db.as('owner', c =>
    c.query<{ defect: string | null }>('SELECT app.structured_section_defect($1,$2::jsonb,$3) AS defect', [
      'structured',
      json,
      STRUCTURED_SCHEMA_VERSION,
    ]),
  )
  return rows[0]!.defect
}

/** The same gate, asked about a kind and a version the caller chooses. */
const defectFor = async (kind: string, doc: unknown, version: number | null): Promise<string | null> => {
  const { rows } = await db.as('owner', c =>
    c.query<{ defect: string | null }>('SELECT app.structured_section_defect($1,$2::jsonb,$3) AS defect', [
      kind,
      doc === undefined ? null : JSON.stringify(doc),
      version,
    ]),
  )
  return rows[0]!.defect
}

const shapeDefect = async (json: string): Promise<string | null> => {
  const { rows } = await db.as('owner', c =>
    c.query<{ defect: string | null }>('SELECT app.structured_shape_defect($1::jsonb) AS defect', [json]),
  )
  return rows[0]!.defect
}

/**
 * What TypeScript makes of the same document, from this package alone.
 *
 * The preflight and the schema, which is where every bound in `STRUCTURED_LIMITS`
 * is decided. It is deliberately not the renderer's `structuredSectionProblems`
 * — the renderer depends on this package, so importing it back would be a cycle
 * — and the renderer's extra checks (a field used but never declared, a row and
 * a document disagreeing about their version) are asserted in its own suite.
 * None of the fixtures below turn on any of them: they vary one size and
 * nothing else, so this is the whole TypeScript answer for them.
 */
function typescriptVerdict(json: string): 'accepted' | 'refused' {
  const doc: unknown = JSON.parse(json)
  if (structuredShapeDefects(doc).length > 0) return 'refused'
  return StructuredDocument.safeParse(doc).success ? 'accepted' : 'refused'
}

/**
 * Every bound, at the last value it accepts and the first it refuses.
 *
 * One size changes per row and nothing else. The version of this suite that
 * checked "a document nested 17 deep is refused" against a fixture that was
 * also missing a field declaration was checking the field declaration, and
 * would have passed at any depth at all.
 */
const BOUNDARY: { limit: string; at: number; json: (n: number) => string; defect: (n: number) => string }[] = [
  {
    limit: 'node levels',
    at: 16,
    json: nestedJson,
    defect: () => 'nests deeper than 16 levels',
  },
  {
    limit: 'nodes in the document',
    at: 2_000,
    json: siblingsJson,
    defect: () => 'has more than 2000 nodes',
  },
  {
    limit: 'children on one element',
    at: 512,
    json: childrenJson,
    defect: n => `has an element with ${n} children, more than the 512 one element may have`,
  },
  {
    limit: 'declared fields',
    at: 256,
    json: fieldsJson,
    defect: n => `declares ${n} fields, more than the 256 a section may have`,
  },
  {
    limit: 'characters in a field label',
    at: 256,
    json: n => fieldsJson(1, 'L'.repeat(n)),
    defect: () => 'has a field label longer than 256 characters',
  },
  {
    limit: 'characters in an attribute',
    at: 512,
    json: attributeJson,
    defect: () => 'has an attribute longer than 512 characters',
  },
]

describe('PostgreSQL draws every bound in the same place TypeScript does', () => {
  for (const { limit, at, json, defect } of BOUNDARY) {
    it(`accepts ${at - 1} ${limit}, one inside the limit`, async () => {
      expect(typescriptVerdict(json(at - 1))).toBe('accepted')
      expect(await sectionDefect(json(at - 1))).toBeNull()
      await expect(save({ docJson: json(at - 1) })).resolves.toBeDefined()
    })

    it(`accepts ${at} ${limit}, exactly the limit`, async () => {
      // The value the constant names, accepted. A bound that refused its own
      // number would make every refusal test below pass while the limit
      // everybody quotes was off by one.
      expect(typescriptVerdict(json(at))).toBe('accepted')
      expect(await sectionDefect(json(at))).toBeNull()
      await expect(save({ docJson: json(at) })).resolves.toBeDefined()
    })

    it(`refuses ${at + 1} ${limit}, one past the limit, and says so`, async () => {
      expect(typescriptVerdict(json(at + 1))).toBe('refused')
      expect(await sectionDefect(json(at + 1))).toBe(defect(at + 1))
      await expectSqlState(save({ docJson: json(at + 1) }), 'CMS04')
    })
  }

  it.each([63, 64])('lets the shape check pass %i attributes on one element', async count => {
    // The attribute *count* is asked of the shape check alone, because there
    // are only nine attribute names an element may carry: a document with
    // sixty-four of them cannot also be a valid one, so the section gate would
    // always refuse it for its names and this bound would never be the reason.
    expect(structuredShapeDefects(JSON.parse(attributeCountJson(count))).length).toBe(0)
    expect(await shapeDefect(attributeCountJson(count))).toBeNull()
  })

  it('refuses 65 attributes on one element from the shape check, before their names are read', async () => {
    expect(structuredShapeDefects(JSON.parse(attributeCountJson(65))).map(p => p.code)).toEqual(['too-many-attributes'])
    expect(await shapeDefect(attributeCountJson(65))).toBe(
      'has an element carrying 65 attributes, more than the 64 one element may carry',
    )
  })

  it.each([63, 64, 65])('refuses %i unlisted attributes as a whole definition either way', async count => {
    // The counterpart, so "the shape check is clean" is never mistaken for
    // "this document is acceptable".
    expect(typescriptVerdict(attributeCountJson(count))).toBe('refused')
    expect(await sectionDefect(attributeCountJson(count))).not.toBeNull()
    await expectSqlState(save({ docJson: attributeCountJson(count) }), 'CMS04')
  })
})

describe('the depth convention is the same sentence in both languages', () => {
  it('counts the field node as a level, so fifteen elements around one field is sixteen', async () => {
    // The convention, asserted rather than assumed: `nestedJson(16)` is fifteen
    // `<div>`s and the text field inside them. If the database counted only the
    // elements it would accept sixteen of them, TypeScript would refuse the
    // same document, and the disagreement would be one level wide and
    // completely silent.
    expect(nestedJson(16).split('"type":"element"').length - 1).toBe(15)
    expect(nestedJson(16)).toContain('{"type":"text","field":"heading"}')
    expect(await sectionDefect(nestedJson(16))).toBeNull()
    expect(await sectionDefect(nestedJson(17))).toBe('nests deeper than 16 levels')
  })

  it('starts counting at the document’s own node list rather than at the document', async () => {
    // One field node and nothing around it is one level, not two: the object
    // carrying `schemaVersion`, `fields` and `nodes` is not a node.
    expect(await sectionDefect(nestedJson(1))).toBeNull()
    expect(typescriptVerdict(nestedJson(1))).toBe('accepted')
  })

  it.each([17, 100, 1_000])('refuses a document of %i levels', async depth => {
    expect(typescriptVerdict(nestedJson(depth))).toBe('refused')
    expect(await sectionDefect(nestedJson(depth))).toBe('nests deeper than 16 levels')
    await expectSqlState(save({ docJson: nestedJson(depth) }), 'CMS04')
  })

  it('refuses one of 5,000 levels, sent as text because JSON.parse recurses too', async () => {
    // Not parsed on the way in. `JSON.parse` of a 5,000-deep document overflows
    // the stack in the test process, which is the very failure this file is
    // about, so the fixture goes to the database as the string it already is.
    expect(await sectionDefect(nestedJson(5_000))).toBe('nests deeper than 16 levels')
    await expectSqlState(save({ docJson: nestedJson(5_000) }), 'CMS04')
  })

  it('refuses one of 50,000 levels in PostgreSQL’s own voice, before the gate is reached', async () => {
    // The one place the two layers describe the same document differently, and
    // it is not a disagreement about whether to refuse it.
    //
    // `jsonb`'s input parser is recursive, and `max_stack_depth` (2 MB by
    // default) bounds it: on this machine a document nests about 8,000 levels
    // before the cast itself raises SQLSTATE 54001, "stack depth limit
    // exceeded". That happens on the way in, so `app.structured_section_defect`
    // never runs and cannot answer "nests deeper than 16 levels" the way it
    // does at 5,000. TypeScript, whose preflight is iterative, answers with the
    // sentence at any depth.
    //
    // It still fails closed — the statement errors, the transaction aborts, and
    // nothing is stored — so the accept/refuse boundary is identical. What
    // differs is the diagnosis, and no migration can fix it: the limit belongs
    // to the server's JSON parser rather than to anything this schema wrote.
    // Both codes are named because the exact depth at which the parser gives up
    // depends on the stack a given server was started with, and a test that
    // pinned one machine's threshold would be testing the machine.
    const before = await db.as('owner', c => c.query<{ n: string }>('SELECT count(*) AS n FROM section_def_versions'))
    await expectSqlState(save({ docJson: nestedJson(50_000) }), 'CMS04', '54001')
    const after = await db.as('owner', c => c.query<{ n: string }>('SELECT count(*) AS n FROM section_def_versions'))
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n)
  })

  it('answers with the gate’s own sentence for every depth the parser can read', async () => {
    // The counterpart: below the parser's ceiling the database says what is
    // wrong, rather than that it could not look.
    for (const depth of [17, 1_000, 5_000]) {
      expect(await sectionDefect(nestedJson(depth)), `depth ${depth}`).toBe('nests deeper than 16 levels')
    }
  })
})

// ---------------------------------------- definition-owned static attributes

// Structured schema v2 (ADR 0008). A link or image field node may carry the
// attributes its definition chose, and the grammars are written twice — once in
// `packages/schema/src/content/structured.ts` and once in SQL, because the
// database cannot import TypeScript and a gate that trusts its caller's
// allowlist is not a gate.
//
// So what is asserted below is not "PostgreSQL also refuses bad attributes". It
// is that the two layers accept and refuse the same documents, value for value.
// A grammar that differs between them is a definition one layer stores and the
// other will not render, which is the shape this schema has met three times and
// which is invisible until somebody looks at a live page.

/** One link or image field node carrying the given static attributes. */
const staticJson = (type: 'link' | 'image', staticAttributes: unknown) =>
  JSON.stringify({
    schemaVersion: STRUCTURED_SCHEMA_VERSION,
    fields: [{ name: 'thing', type, label: 'Thing' }],
    nodes: [{ type, field: 'thing', staticAttributes }],
  })

/**
 * The same, with the attributes written as raw JSON text.
 *
 * For the numbers `JSON.stringify` cannot produce. `12.0` is the integer 12 to
 * `JSON.parse` and the text `12.0` out of a `jsonb` column, and that difference
 * is exactly where a spelling-based dimension check would have made the two
 * layers disagree — so the fixture has to be able to say `12.0`.
 */
const rawStaticJson = (type: 'link' | 'image', attributes: string) =>
  `{"schemaVersion":${STRUCTURED_SCHEMA_VERSION},` +
  `"fields":[{"name":"thing","type":"${type}","label":"Thing"}],` +
  `"nodes":[{"type":"${type}","field":"thing","staticAttributes":${attributes}}]}`

/** A class list of `count` distinct tokens. */
const classList = (count: number) => Array.from({ length: count }, (_, i) => `c${i}`)

const ACCEPTED: [string, string][] = [
  ['a link carrying no static attributes at all', staticJson('link', undefined)],
  ['a link with one class token', staticJson('link', { class: ['btn'] })],
  ['a link with several class tokens', staticJson('link', { class: ['btn', 'btn-primary', 'is_large'] })],
  ['a class token of exactly sixty-four characters', staticJson('link', { class: [`c${'x'.repeat(63)}`] })],
  ['a class list of exactly thirty-two tokens', staticJson('link', { class: classList(32) })],
  [
    'every link relationship at once',
    staticJson('link', {
      rel: [
        'alternate',
        'author',
        'bookmark',
        'external',
        'help',
        'license',
        'next',
        'nofollow',
        'noopener',
        'noreferrer',
        'prev',
        'search',
        'tag',
      ],
    }),
  ],
  [
    'a rel the definition asked for twice, which the renderer collapses',
    staticJson('link', { rel: ['nofollow', 'nofollow'] }),
  ],
  ['a link opened in a new tab', staticJson('link', { target: '_blank' })],
  ['a link opened in this one', staticJson('link', { target: '_self' })],
  ['an image with the smallest dimensions there are', staticJson('image', { width: 1, height: 1 })],
  ['an image with the largest', staticJson('image', { width: 8192, height: 8192 })],
  [
    'a dimension written with a trailing zero, which JavaScript parses as an integer',
    rawStaticJson('image', '{"width":12.0,"height":8.0}'),
  ],
  ['a dimension written in exponent notation', rawStaticJson('image', '{"width":1e2,"height":1e2}')],
  [
    'every image hint at once',
    staticJson('image', {
      class: ['media'],
      width: 640,
      height: 360,
      decoding: 'async',
      loading: 'lazy',
      fetchpriority: 'high',
    }),
  ],
]

const REFUSED: [string, string][] = [
  ['a class list that is empty', staticJson('link', { class: [] })],
  ['a class list with a repeated token', staticJson('link', { class: ['btn', 'btn'] })],
  ['a class token of sixty-five characters', staticJson('link', { class: [`c${'x'.repeat(64)}`] })],
  ['a class list of thirty-three tokens', staticJson('link', { class: classList(33) })],
  ['a class token with a space in it', staticJson('link', { class: ['btn primary'] })],
  ['a class token in the framework-utility grammar', staticJson('link', { class: ['sm:hidden'] })],
  ['a class token with an arbitrary bracketed value', staticJson('link', { class: ['w-[32px]'] })],
  ['a class token that would close its own attribute', staticJson('link', { class: ['a" onclick="alert(1)'] })],
  ['a class token shaped like markup', staticJson('link', { class: ['<script>'] })],
  ['a class written as a string, which is the schema v1 spelling', staticJson('link', { class: 'btn' })],
  ['a class token that is a number', rawStaticJson('link', '{"class":[1]}')],
  ['a class token that is null', rawStaticJson('link', '{"class":[null]}')],
  ['a rel keyword nobody listed', staticJson('link', { rel: ['opener'] })],
  ['a rel keyword that would make the anchor fetch', staticJson('link', { rel: ['preload'] })],
  ['a rel keyword in the wrong case', staticJson('link', { rel: ['NOFOLLOW'] })],
  ['a whole rel value written as one token', staticJson('link', { rel: ['noopener noreferrer'] })],
  ['a target naming a context the section does not own', staticJson('link', { target: '_top' })],
  ['a target naming a browsing context by name', staticJson('link', { target: 'results' })],
  ['a style declaration list', staticJson('link', { style: 'background:url(//evil.test/x)' })],
  ['an event handler', staticJson('link', { onclick: 'alert(1)' })],
  ['an href, which is the author’s value', staticJson('link', { href: 'https://evil.test/' })],
  ['a src, which is the author’s value', staticJson('image', { src: 'https://evil.test/pixel.gif' })],
  ['an alt, which is the author’s value', staticJson('image', { alt: 'not what the author wrote' })],
  [
    'a srcset, which is a candidate grammar rather than a URL',
    staticJson('image', { srcset: '/a.png 1x, //evil.test/x 2x' }),
  ],
  ['an id, which is a name shared with the whole page', staticJson('link', { id: 'cta' })],
  ['an arbitrary data hook', staticJson('link', { 'data-tone': 'brand' })],
  ['a width on a link, which has no intrinsic size', staticJson('link', { width: 320 })],
  ['a rel on an image, which navigates nowhere', staticJson('image', { rel: ['nofollow'] })],
  ['a target on an image', staticJson('image', { target: '_blank' })],
  ['a width with no height', staticJson('image', { width: 640 })],
  ['a height with no width', staticJson('image', { height: 360 })],
  ['a dimension of zero, which is conforming HTML and reserves no box', staticJson('image', { width: 0, height: 0 })],
  ['a negative dimension', staticJson('image', { width: -1, height: 360 })],
  ['a dimension one past the upper bound', staticJson('image', { width: 8193, height: 360 })],
  ['a dimension with a fraction', rawStaticJson('image', '{"width":12.5,"height":360}')],
  ['a dimension written as a string of digits', staticJson('image', { width: '640', height: '360' })],
  ['a dimension with a unit', staticJson('image', { width: '640px', height: '360px' })],
  [
    'a dimension that overflows what a double can distinguish',
    rawStaticJson('image', '{"width":9007199254740993,"height":360}'),
  ],
  ['a dimension larger than any number a double holds', rawStaticJson('image', '{"width":1e400,"height":360}')],
  ['a decoding value that is not one', staticJson('image', { decoding: 'fast' })],
  ['loading=auto, which loading does not have', staticJson('image', { loading: 'auto' })],
  ['a fetchpriority that is not one', staticJson('image', { fetchpriority: 'urgent' })],
  ['a hint with surrounding space', staticJson('image', { loading: ' lazy' })],
  ['static attributes that are a list rather than an object', staticJson('link', [])],
  ['static attributes that are a string', staticJson('link', 'class')],
  ['static attributes that are a number', staticJson('link', 7)],
]

describe('PostgreSQL and TypeScript accept the same static attributes, value for value', () => {
  it.each(ACCEPTED)('accepts %s', async (_label, json) => {
    expect(typescriptVerdict(json)).toBe('accepted')
    expect(await sectionDefect(json)).toBeNull()
    await expect(save({ docJson: json })).resolves.toBeDefined()
  })

  it.each(REFUSED)('refuses %s', async (_label, json) => {
    expect(typescriptVerdict(json)).toBe('refused')
    expect(await sectionDefect(json)).not.toBeNull()
    await expectSqlState(save({ docJson: json }), 'CMS04')
  })

  it('refuses static attributes on a text field, which has no element of its own', async () => {
    const json = JSON.stringify({
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      fields: FIELDS,
      nodes: [{ type: 'text', field: 'heading', staticAttributes: { class: ['a'] } }],
    })
    expect(typescriptVerdict(json)).toBe('refused')
    expect(await sectionDefect(json)).toContain('which this schema version does not define')
    await expectSqlState(save({ docJson: json }), 'CMS04')
  })

  it('refuses static attributes on an element node, which has its own attribute map', async () => {
    const json = JSON.stringify({
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      fields: [],
      nodes: [{ type: 'element', tag: 'div', staticAttributes: { class: ['a'] } }],
    })
    expect(typescriptVerdict(json)).toBe('refused')
    expect(await sectionDefect(json)).toContain('which this schema version does not define')
  })

  it('says what is wrong, so the author is told rather than shown an anchor with no class', async () => {
    expect(await sectionDefect(staticJson('link', { style: 'color:red' }))).toBe(
      'has a link field carrying style, which is not a static attribute a link field may carry',
    )
    expect(await sectionDefect(staticJson('link', { class: ['sm:hidden'] }))).toBe(
      'has a link field whose class is not a usable value',
    )
    expect(await sectionDefect(staticJson('image', { width: 640 }))).toBe(
      'has an image field carrying only one of width and height, so the box it reserves is the wrong one',
    )
  })

  it('agrees about the token-count and length bounds a class list is held to', async () => {
    // The shape check rather than the section gate, because a token list is
    // where a hostile document is cheapest to write: 100,000 tokens is one
    // attribute by every measure that existed before, and summing it to prove it
    // too long is the work the attacker wanted done.
    const tokens = (count: number) => staticJson('link', { class: classList(count) })
    expect(await shapeDefect(tokens(32))).toBeNull()
    expect(await shapeDefect(tokens(33))).toBe('has an attribute of more than 32 tokens')
    expect(structuredShapeDefects(JSON.parse(tokens(33))).map(p => p.message)).toEqual([
      'has an attribute of more than 32 tokens',
    ])

    // Name and value together, and the value measured as it will be rendered:
    // the tokens plus the single spaces between them.
    const sized = (length: number) => {
      const count = Math.max(1, Math.ceil((length + 1) / 65))
      let characters = length - (count - 1)
      const letters = 'abcdefghijklmnopqrstuvwxyzABCDEF'
      return Array.from({ length: count }, (_, i) => {
        const size = Math.min(64, characters - (count - 1 - i))
        characters -= size
        return letters[i % letters.length]! + 'c'.repeat(size - 1)
      })
    }
    expect(sized(512 - 'class'.length).join(' ').length).toBe(512 - 'class'.length)
    expect(await shapeDefect(staticJson('link', { class: sized(512 - 'class'.length) }))).toBeNull()
    expect(await shapeDefect(staticJson('link', { class: sized(513 - 'class'.length) }))).toBe(
      'has an attribute longer than 512 characters',
    )
  })
})

// ------------------------------------- definition-owned element attributes

// ADR 0009. The element-node allowlist gained `aria-current` and nothing else,
// and the grammar is written twice for the reason every grammar here is: the
// database cannot import TypeScript, and a gate that trusts its caller's
// allowlist is not a gate.
//
// The SQL half of this lands in migration 0026, which the lead owns. Until it
// does, every `sectionDefect` and `save` assertion below fails and every
// `typescriptVerdict` one passes — which is exactly the disagreement these tests
// exist to make loud, so they are written against the SQL rather than around it.

/** One element node carrying the given attribute map. */
const elementJson = (attributes: unknown, tag = 'span') =>
  JSON.stringify({
    schemaVersion: STRUCTURED_SCHEMA_VERSION,
    fields: [{ name: 'thing', type: 'text', label: 'Thing' }],
    nodes: [{ type: 'element', tag, attributes, children: [{ type: 'text', field: 'thing' }] }],
  })

const ARIA_CURRENT_STATES = ['page', 'step', 'location', 'date', 'time', 'true', 'false']

const ELEMENT_ACCEPTED: [string, string][] = [
  ['an element carrying no attributes at all', elementJson(undefined)],
  ['an element carrying an empty attribute map', elementJson({})],
  ...ARIA_CURRENT_STATES.map((state): [string, string] => [
    `aria-current="${state}"`,
    elementJson({ 'aria-current': state }),
  ]),
  [
    'aria-current beside the attributes an element already carried',
    elementJson({ class: 'crumb', 'aria-current': 'page' }),
  ],
  [
    'aria-current written before the class, because nothing here sorts them',
    elementJson({ 'aria-current': 'page', class: 'crumb' }),
  ],
]

const ELEMENT_REFUSED: [string, string][] = [
  ['a state the attribute does not have', elementJson({ 'aria-current': 'section' })],
  ['an empty aria-current, which is not the default said out loud', elementJson({ 'aria-current': '' })],
  ['a state in the wrong case, because ARIA keywords are lowercase', elementJson({ 'aria-current': 'Page' })],
  ['a state with a leading space, which nothing here trims', elementJson({ 'aria-current': ' page' })],
  ['two states, because this attribute holds one', elementJson({ 'aria-current': 'page step' })],
  ['a state carrying an HTML escape', elementJson({ 'aria-current': '&#112;age' })],
  ['a value shaped like markup', elementJson({ 'aria-current': '<script>alert(1)</script>' })],
  ['a value that closes the attribute it is in', elementJson({ 'aria-current': 'page" onclick="alert(1)' })],
  ['a value carrying a single quote', elementJson({ 'aria-current': "page' onclick='alert(1)" })],
  ['a value carrying an angle bracket', elementJson({ 'aria-current': 'page><img src=x onerror=alert(1)' })],
  ['a value carrying punctuation a selector would read', elementJson({ 'aria-current': 'page.step#one' })],
  ['a value carrying a control character', elementJson({ 'aria-current': 'pa\tge' })],
  ['a value carrying a newline', elementJson({ 'aria-current': 'page\nstep' })],
  ['a value longer than any attribute may be', elementJson({ 'aria-current': 'p'.repeat(513) })],
  ['a number where a keyword should be', elementJson({ 'aria-current': 1 })],
  ['a boolean where a keyword should be', elementJson({ 'aria-current': true })],
  ['a null where a keyword should be', elementJson({ 'aria-current': null })],
  ['a list of the right keyword', elementJson({ 'aria-current': ['page'] })],
  ['an object where a keyword should be', elementJson({ 'aria-current': { state: 'page' } })],
  // The names ADR 0009 measured on elements this model keeps, and refused. Each
  // one is a definition that stays quarantined on purpose, so each one is a row.
  [
    'the V1 CMS section marker, which is an identity rather than an attribute',
    elementJson({ 'data-cms-section': 'home-divider' }),
  ],
  ['a V1 slot marker on an element that is not an editable region', elementJson({ 'data-block-id': 'crumb-1' })],
  ['a V1 editor label, whose v2 spelling is a field declaration', elementJson({ 'data-cms-label': 'Programme name' })],
  ['a V1 behaviour hook with an empty value', elementJson({ 'data-visually-hidden': '' })],
  ['a V1 build marker', elementJson({ 'data-fe-block': 'hero' })],
  ['an inline declaration list, which is the second CSS sink', elementJson({ style: 'background:url(//evil.test/x)' })],
  ['an event handler', elementJson({ onclick: 'alert(1)' })],
  ['an animation handler, which needs no interaction at all', elementJson({ onanimationstart: 'alert(1)' })],
  ['srcdoc, which is a whole document in an attribute', elementJson({ srcdoc: '<script>alert(1)</script>' })],
  ['an href, because an element node is never a link', elementJson({ href: 'https://evil.test/' })],
  ['a src, because an element node never fetches', elementJson({ src: 'https://evil.test/pixel.gif' })],
  ['an ARIA state this build does not implement', elementJson({ 'aria-pressed': 'true' })],
  [
    'a name that differs only in case, because attribute names here are literal',
    elementJson({ 'ARIA-CURRENT': 'page' }),
  ],
  ['a name with a space in it', elementJson({ 'aria-current x': 'page' })],
  ['an empty name', elementJson({ '': 'page' })],
]

describe('PostgreSQL and TypeScript accept the same element attributes, value for value', () => {
  it.each(ELEMENT_ACCEPTED)('accepts %s', async (_label, json) => {
    expect(typescriptVerdict(json)).toBe('accepted')
    expect(await sectionDefect(json)).toBeNull()
    await expect(save({ docJson: json })).resolves.toBeDefined()
  })

  it.each(ELEMENT_REFUSED)('refuses %s', async (_label, json) => {
    expect(typescriptVerdict(json)).toBe('refused')
    expect(await sectionDefect(json)).not.toBeNull()
    await expectSqlState(save({ docJson: json }), 'CMS04')
  })

  it('agrees value for value about every state, asked of the predicate directly', async () => {
    // The section gate walks a whole document to reach this question, so a
    // disagreement about one keyword could hide behind an unrelated defect. This
    // asks `app.is_structured_attribute_value` the same question TypeScript's
    // `isStructuredAttributeValue` answers, one value at a time.
    const candidates = [
      ...ARIA_CURRENT_STATES,
      'section',
      '',
      'PAGE',
      ' page',
      'page ',
      'page step',
      'pages',
      'true false',
      'p'.repeat(512),
      'p'.repeat(513),
      '<page',
      'pa\tge',
    ]
    for (const value of candidates) {
      const { rows } = await db.as('owner', c =>
        c.query<{ ok: boolean }>('SELECT app.is_structured_attribute_value($1,$2) AS ok', ['aria-current', value]),
      )
      expect(rows[0]!.ok, JSON.stringify(value)).toBe(ARIA_CURRENT_STATES.includes(value))
    }
  })

  it('agrees that aria-current is a name an element node may carry', async () => {
    const { rows } = await db.as('owner', c =>
      c.query<{ ok: boolean }>('SELECT app.is_structured_attribute($1) AS ok', ['aria-current']),
    )
    expect(rows[0]!.ok).toBe(true)
  })

  it.each(['data-cms-section', 'data-block-id', 'data-cms-label', 'style', 'onclick', 'aria-pressed'])(
    'agrees that %s is not',
    async name => {
      const { rows } = await db.as('owner', c =>
        c.query<{ ok: boolean }>('SELECT app.is_structured_attribute($1) AS ok', [name]),
      )
      expect(rows[0]!.ok).toBe(false)
    },
  )

  it('says what is wrong, so the author is told rather than shown an element with no state', async () => {
    // The sentences migration 0025 already produces, unchanged. A migration that
    // reworded them while adding the name would make every test that asserts one
    // fail for a reason that has nothing to do with what it is checking.
    expect(await sectionDefect(elementJson({ 'aria-current': 'section' }))).toBe(
      'has an element node whose aria-current is not a usable value',
    )
    expect(await sectionDefect(elementJson({ 'data-cms-section': 'home-divider' }))).toBe(
      'has an element node carrying the attribute data-cms-section, which is not one it may carry',
    )
  })

  it('refuses aria-current as a field node’s static attribute, which has its own closed list', async () => {
    // The two allowlists are separate and stay separate. A name on one is not a
    // name on the other, because a field node's attributes are typed values and
    // an element node's are strings — and one key holding two shapes is the
    // mistake migration 0021 exists because of.
    const json = staticJson('link', { 'aria-current': 'page' })
    expect(typescriptVerdict(json)).toBe('refused')
    expect(await sectionDefect(json)).not.toBeNull()
    await expectSqlState(save({ docJson: json }), 'CMS04')
  })

  it('leaves the document a version older than this addition untouched', async () => {
    // The reason ADR 0009 does not move the schema version: a document that does
    // not use the new name is the same document, stored the same way, read the
    // same way. Asserted by storing one and reading its bytes back.
    const json = elementJson({ class: 'crumb', id: 'crumbs', 'aria-hidden': 'true' })
    expect(typescriptVerdict(json)).toBe('accepted')
    expect(await sectionDefect(json)).toBeNull()
    const { rows } = await db.as('owner', c =>
      c.query<{ doc: unknown; v: number }>('SELECT $1::jsonb AS doc, app.current_structured_schema_version() AS v', [
        json,
      ]),
    )
    expect(rows[0]!.doc).toEqual(JSON.parse(json))
    expect(rows[0]!.v).toBe(STRUCTURED_SCHEMA_VERSION)
  })
})

describe('the structured schema version this database accepts', () => {
  it('is the one the TypeScript schema is written against', async () => {
    const { rows } = await db.as('owner', c =>
      c.query<{ v: number }>('SELECT app.current_structured_schema_version() AS v'),
    )
    expect(rows[0]!.v).toBe(STRUCTURED_SCHEMA_VERSION)
  })

  it('refuses a document written against schema v1 until it is carried forward', async () => {
    // Not "reads it anyway because v2 is a superset". What changes between
    // versions is what the nodes *mean*, and a reader that guesses is always the
    // permissive one.
    const v1 = { ...document(), schemaVersion: 1 }
    await expectSqlState(save({ doc: v1, schemaVersion: 1 }), 'CMS04')
    expect(await defectFor('structured', v1, 1)).toBe(
      `was written against structured schema version 1, but this database requires version ${STRUCTURED_SCHEMA_VERSION}`,
    )
  })

  it('accepts the same document once the upgrade has carried it forward', async () => {
    // The upgrade is the version number and nothing else, which is what makes
    // the migration's UPDATE safe to run over every stored row at once.
    const v1 = { ...document(), schemaVersion: 1 }
    const upgraded = upgradeStructuredDocument(v1)
    expect(upgraded).toEqual(document())
    expect(await sectionDefect(JSON.stringify(upgraded))).toBeNull()
    await expect(save({ doc: upgraded })).resolves.toBeDefined()
  })
})

describe('a cycle and a repeated node reference cannot reach the database at all', () => {
  it('cannot be written down in JSON, which is why TypeScript is the only layer that checks', async () => {
    // Worth an assertion rather than a comment: the reason `structured_shape_defect`
    // has no cycle check is that `jsonb` is a tree by construction, and the
    // shared-object document below arrives as two copies of the same subtree —
    // an ordinary, acceptable document once it has been through JSON.
    const child = { type: 'text', field: 'heading' }
    const shared = {
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      fields: FIELDS,
      nodes: [{ type: 'element', tag: 'div', children: [child, child] }],
    }
    // TypeScript refuses it in memory, because one object in two places is
    // something no stored document can be.
    expect(structuredShapeDefects(shared).map(p => p.code)).toEqual(['node-used-twice'])
    // Serialized, it is two children that merely look alike, and the database
    // stores it — correctly, because that is a different document.
    expect(await sectionDefect(JSON.stringify(shared))).toBeNull()
    await expect(save({ docJson: JSON.stringify(shared) })).resolves.toBeDefined()
  })
})

describe('the shape check answers about a hostile document without taking the connection with it', () => {
  it('refuses a deep document quickly, because refusing slowly is its own denial of service', async () => {
    const started = Date.now()
    await db.as('owner', c =>
      c.query('SELECT app.structured_section_defect($1,$2::jsonb,$3)', [
        'structured',
        nestedJson(5_000),
        STRUCTURED_SCHEMA_VERSION,
      ]),
    )
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('refuses a wide document quickly too, which costs more than it should', async () => {
    // Measured on this machine: the recursive CTE in `app.structured_shape_defect`
    // walks the *whole* document and aggregates it before any limit is tested,
    // so the cost is linear in the document rather than in the limit. 262,657
    // nodes (8.4 MB) takes about 200 ms, 1,050,628 nodes (33.6 MB) about 860 ms,
    // and a flat list of 12,000,000 empty objects (36 MB) about 5.6 s, which is
    // as far as this attack goes — past roughly 60 MB the jsonb parser itself
    // refuses with "invalid memory alloc request size". TypeScript answers the
    // same question in about a millisecond because it stops counting at 2,001.
    //
    // Not explosive, then, but not bounded by the limit either. Wrapping the
    // aggregate in `LIMIT 2001` and reading the length of the top-level node
    // list first brings the walk to roughly 30 ms whatever the document; that
    // is a migration, and this test is the measurement that says why it is
    // worth one.
    const leaf = '{"type":"element","tag":"span"}'
    const mid = `{"type":"element","tag":"div","children":[${Array(512).fill(leaf).join(',')}]}`
    const wide =
      `{"schemaVersion":${STRUCTURED_SCHEMA_VERSION},"fields":[],"nodes":` +
      `[{"type":"element","tag":"div","children":[${Array(512).fill(mid).join(',')}]}]}`

    const started = Date.now()
    const defect = await shapeDefect(wide)
    const elapsed = Date.now() - started
    expect(defect).toBe('has more than 2000 nodes')
    expect(elapsed).toBeLessThan(5_000)
  })

  it('refuses the same wide document through the command, so it never reaches a page', async () => {
    const wide = siblingsJson(3_000)
    expect(typescriptVerdict(wide)).toBe('refused')
    await expectSqlState(save({ docJson: wide }), 'CMS04')
  })
})
