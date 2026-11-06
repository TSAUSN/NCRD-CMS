// The database will not store or publish a structured definition it cannot
// vouch for (migration 0019).
//
// The reasoning is 0012's, one model along: `upsert_section_def_version` takes
// the document as an argument, so "the compiler would not have produced this" is
// a claim about the caller rather than a property of the row. What is new is the
// discriminator — every check below is really the same question asked twice,
// because a row that says one thing and carries the artifacts of the other is
// the failure this column exists to make impossible.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  STRUCTURED_SCHEMA_VERSION,
  StructuredDocument,
  structuredShapeDefects,
  upgradeStructuredDocument,
} from '../src/index.ts'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('structured')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

// Literals, not @cms/renderer's constants: the renderer depends on this package,
// so importing back would be a cycle. Migrations 0012, 0013 and 0019 are what
// keep the numbers honest — a stale one fails loudly here rather than quietly
// storing something the renderer will refuse.
const SANITIZER_POLICY_VERSION = 4
const CSS_POLICY_VERSION = 6

/** What a structured row stores in `compiled_ast`: nothing to interpolate. */
const NO_TEMPLATE = JSON.stringify({
  nodes: [],
  policyVersion: SANITIZER_POLICY_VERSION,
  cssPolicyVersion: CSS_POLICY_VERSION,
})

const FIELDS = [
  { name: 'heading', type: 'text', label: 'Heading' },
  { name: 'body', type: 'richtext', label: 'Body' },
]

const NODES = [
  {
    type: 'element',
    tag: 'section',
    attributes: { class: 'quote' },
    children: [
      { type: 'element', tag: 'h1', children: [{ type: 'text', field: 'heading' }] },
      { type: 'element', tag: 'div', children: [{ type: 'richtext', field: 'body' }] },
    ],
  },
]

const document = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: STRUCTURED_SCHEMA_VERSION,
  fields: FIELDS,
  nodes: NODES,
  ...overrides,
})

/** The slots a structured definition declares, in the shape the editor reads. */
const SLOTS = JSON.stringify(FIELDS.map(f => ({ id: f.name, kind: f.type, label: f.label, constraints: {} })))

type SaveOptions = {
  slug?: string
  kind?: string | null
  doc?: unknown
  /**
   * The document already serialized, for fixtures `JSON.stringify` cannot
   * produce. It recurses, so a 5,000-deep document overflows the stack in the
   * *test* before it can reach the database — the same defect this suite exists
   * to check for, met on the way to checking for it.
   */
  docJson?: string
  schemaVersion?: number | null
  compiledAst?: string
  compiledCss?: string
}

function save(options: SaveOptions = {}) {
  const slug = options.slug ?? `struct-${Math.random().toString(36).slice(2, 8)}`
  const doc = 'doc' in options ? options.doc : document()
  return db.asUser(s.superAdmin, c =>
    c.query<{ section_def_id: string; version: number }>(
      'SELECT * FROM app.upsert_section_def_version' + '($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
      [
        slug,
        'Structured',
        'Content',
        // A structured definition has no authored HTML; the scoped stylesheet is
        // the same artifact both models produce.
        '',
        '.a{color:red}',
        options.compiledCss ?? `.cms-section--${slug} .a{color:red}`,
        options.compiledAst ?? NO_TEMPLATE,
        SLOTS,
        'hash',
        SANITIZER_POLICY_VERSION,
        CSS_POLICY_VERSION,
        'structured test',
        false,
        'kind' in options ? options.kind : 'structured',
        options.docJson ?? (doc === undefined || doc === null ? null : JSON.stringify(doc)),
        'schemaVersion' in options ? options.schemaVersion : STRUCTURED_SCHEMA_VERSION,
      ],
    ),
  )
}

async function pageWith(slug: string, content: unknown[]): Promise<{ page: string; version: string }> {
  const page = await db.asUser(
    s.editorA,
    async c =>
      (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, slug, 'Structured'])).rows[0]!
        .id,
  )
  const saved = await db.asUser(s.editorA, c =>
    c.query<{ version_id: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      page,
      0,
      JSON.stringify(content),
      '{}',
    ]),
  )
  return { page, version: saved.rows[0]!.version_id }
}

const instance = (defId: string, version: number, values: Record<string, unknown>) => ({
  section_def_id: defId,
  section_def_version: version,
  values,
  hidden: false,
  hidden_at: [],
  label: 'Section',
})

const VALUES = { heading: 'A structured heading', body: '<p>Body <strong>copy</strong>.</p>' }

async function revisionOf(pageId: string): Promise<number> {
  const { rows } = await db.as('owner', c =>
    c.query<{ revision: string }>('SELECT revision FROM pages WHERE id = $1', [pageId]),
  )
  return Number(rows[0]!.revision)
}

// ------------------------------------------------------------ the happy path

describe('a structured definition saves, previews and publishes', () => {
  it('stores one, and the row says which model it is written in', async () => {
    const saved = await save({ slug: 'struct-happy' })
    const { rows } = await db.as('owner', c =>
      c.query<{ definition_kind: string; structured_schema_version: number; nodes: unknown }>(
        `SELECT definition_kind, structured_schema_version, structured_doc -> 'nodes' AS nodes
           FROM section_def_versions WHERE section_def_id = $1`,
        [saved.rows[0]!.section_def_id],
      ),
    )
    expect(rows[0]!.definition_kind).toBe('structured')
    expect(rows[0]!.structured_schema_version).toBe(STRUCTURED_SCHEMA_VERSION)
    expect(rows[0]!.nodes).toEqual(NODES)
  })

  it('previews through the manifest, carrying the discriminator with the definition', async () => {
    const saved = await save({ slug: 'struct-preview' })
    const { version } = await pageWith('structured-preview', [instance(saved.rows[0]!.section_def_id, 1, VALUES)])

    const { rows } = await db.asUser(s.editorA, c =>
      c.query<{ manifest: { sections: { def: Record<string, unknown> }[] } }>(
        'SELECT app.build_render_manifest($1) AS manifest',
        [version],
      ),
    )
    const def = rows[0]!.manifest.sections[0]!.def
    // Without the discriminator the renderer would have to work out which model
    // it was looking at, which is the inference the column exists to remove.
    expect(def['definition_kind']).toBe('structured')
    expect(def['structured_schema_version']).toBe(STRUCTURED_SCHEMA_VERSION)
    expect(def['structured_doc']).toEqual(document())
  })

  it('publishes, and the published manifest is the one that was checked', async () => {
    const saved = await save({ slug: 'struct-publish' })
    const { page } = await pageWith('structured-publish', [instance(saved.rows[0]!.section_def_id, 1, VALUES)])

    const revision = await revisionOf(page)
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, revision, ...CHECKED_CLEAN]),
    )

    const { rows } = await db.as('owner', c =>
      c.query<{ manifest: { sections: { def: Record<string, unknown> }[] } }>(
        'SELECT render_manifest AS manifest FROM published_routes WHERE page_id = $1',
        [page],
      ),
    )
    expect(rows[0]!.manifest.sections[0]!.def['definition_kind']).toBe('structured')
  })

  it('puts a structured section and an interpolated one on the same published page', async () => {
    // Coexistence, asserted where it actually matters. The seeded hero is a
    // legacy definition and nothing about publishing had to know that.
    const saved = await save({ slug: 'struct-coexist' })
    const { page, version } = await pageWith('structured-coexist', [
      instance(s.heroDefId, 1, { heading: 'Interpolated', intro: 'Still frozen.' }),
      instance(saved.rows[0]!.section_def_id, 1, VALUES),
    ])

    const { rows } = await db.asUser(s.editorA, c =>
      c.query<{ manifest: { sections: { def: Record<string, unknown> }[] } }>(
        'SELECT app.build_render_manifest($1) AS manifest',
        [version],
      ),
    )
    expect(rows[0]!.manifest.sections.map(section => section.def['definition_kind'])).toEqual(['legacy', 'structured'])

    const revision = await revisionOf(page)
    await expect(
      db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, revision, ...CHECKED_CLEAN])),
    ).resolves.toBeDefined()
  })
})

// ---------------------------------------------------------------- refusals

describe('authoring refuses a structured definition it cannot vouch for', () => {
  it.each([
    ['a document that is not an object', []],
    ['a document with no node list', { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: FIELDS }],
    ['a document with no field list', { schemaVersion: STRUCTURED_SCHEMA_VERSION, nodes: NODES }],
    ['a key this schema version does not define', document({ behaviour: 'run' })],
    [
      'an element node with a tag that can execute',
      document({ nodes: [{ type: 'element', tag: 'script', children: [] }] }),
    ],
    [
      'an element node with a tag that can fetch',
      document({ nodes: [{ type: 'element', tag: 'iframe', children: [] }] }),
    ],
    ['an anchor, which is the link field’s job', document({ nodes: [{ type: 'element', tag: 'a', children: [] }] })],
    [
      'an element node carrying an event handler',
      document({ nodes: [{ type: 'element', tag: 'div', attributes: { onclick: 'alert(1)' } }] }),
    ],
    [
      'an element node carrying a style declaration list',
      document({ nodes: [{ type: 'element', tag: 'div', attributes: { style: 'background:url(//evil.test/x)' } }] }),
    ],
    [
      'a class value that would break out of its own attribute',
      document({ nodes: [{ type: 'element', tag: 'div', attributes: { class: 'a" onclick="alert(1)' } }] }),
    ],
    [
      'a void element with children',
      document({ nodes: [{ type: 'element', tag: 'br', children: [{ type: 'element', tag: 'p' }] }] }),
    ],
    [
      'an icon node carrying external markup instead of a closed symbol',
      document({ nodes: [{ type: 'icon', field: 'heading', svg: '<svg onload="alert(1)"></svg>' }] }),
    ],
    ['a repeat node, which is not in this slice', document({ nodes: [{ type: 'repeat', field: 'heading' }] })],
    [
      'an interpolation node smuggled into a structured document',
      document({ nodes: [{ kind: 'html', value: '<script>alert(1)</script>' }] }),
    ],
    ['a field node the document never declares', document({ fields: [], nodes: [{ type: 'text', field: 'heading' }] })],
    ['a field used as one type and declared as another', document({ nodes: [{ type: 'richtext', field: 'heading' }] })],
    [
      'a field name that is not a usable one',
      document({ fields: [{ name: 'a}}<div ', type: 'text', label: 'A' }], nodes: [] }),
    ],
    [
      'a field declared twice',
      document({
        fields: [...FIELDS, { name: 'heading', type: 'richtext', label: 'Heading' }],
        nodes: [],
      }),
    ],
    ['a field with no label', document({ fields: [{ name: 'heading', type: 'text' }], nodes: [] })],
  ])('refuses %s', async (_label, doc) => {
    await expectSqlState(save({ doc }), 'CMS04')
  })

  it('refuses a definition that does not say which model it is written in', async () => {
    await expectSqlState(save({ kind: null }), 'CMS04')
  })

  it('refuses a discriminator this database does not recognise', async () => {
    await expectSqlState(save({ kind: 'holographic' }), 'CMS04')
  })

  it('refuses a legacy definition that carries a structured document', async () => {
    // Both artifacts on one row is the case the discriminator cannot help with:
    // two readers would find two different sections, and both would render.
    await expectSqlState(save({ kind: 'legacy', doc: document() }), 'CMS04')
  })

  it('refuses a structured definition with no document at all', async () => {
    await expectSqlState(save({ doc: null }), 'CMS04')
  })

  it('says what is wrong, so the author is told rather than shown an empty section', async () => {
    const error = await save({ doc: document({ nodes: [{ type: 'element', tag: 'script' }] }) }).catch((e: Error) => e)
    expect((error as Error).message).toContain('not one an element node may carry')
  })
})

describe('the gate answers with a sentence, and never with silence', () => {
  const defectOf = async (kind: string | null, doc: unknown, version: number | null) => {
    const { rows } = await db.as('owner', c =>
      c.query<{ defect: string | null }>('SELECT app.structured_section_defect($1,$2::jsonb,$3) AS defect', [
        kind,
        doc === undefined ? null : JSON.stringify(doc),
        version,
      ]),
    )
    return rows[0]!.defect
  }

  it.each([
    ['a document that is JSON null', 'structured', null],
    ['a document that is a number', 'structured', 7],
    ['a document that is a string', 'structured', 'nodes'],
    ['a node list holding a number', 'structured', document({ nodes: [1] })],
    ['a node with no type', 'structured', document({ nodes: [{}] })],
    ['an element with no tag', 'structured', document({ nodes: [{ type: 'element' }] })],
    [
      'attributes that are a list',
      'structured',
      document({ nodes: [{ type: 'element', tag: 'div', attributes: [] }] }),
    ],
    [
      'an attribute whose value is a number',
      'structured',
      document({ nodes: [{ type: 'element', tag: 'div', attributes: { id: 4 } }] }),
    ],
    ['children that are a string', 'structured', document({ nodes: [{ type: 'element', tag: 'div', children: 'x' }] })],
    ['a field list holding a string', 'structured', document({ fields: ['heading'] })],
    ['a schema version that is a string', 'structured', document({ schemaVersion: '1' })],
  ])('names a defect for %s rather than returning nothing', async (_label, kind, doc) => {
    // The property migration 0016 is about, one gate along. A missing JSON
    // member makes `jsonb_typeof` NULL, and `NULL <> 'array'` is NULL rather
    // than true — so a guard written without COALESCE does not fire, and
    // "did not fire" and "passed" are the same thing to everything downstream.
    const defect = await defectOf(kind, doc, STRUCTURED_SCHEMA_VERSION)
    expect(defect, `${_label} produced no defect`).not.toBeNull()
    expect((defect ?? '').length, _label).toBeGreaterThan(10)
  })

  it('refuses a space-separated attribute list exactly as the compiler does', async () => {
    // Written as one repeated-token pattern in SQL and as a split-and-check in
    // TypeScript, so the two are only equivalent if the awkward cases agree: a
    // doubled space, a trailing space, and the empty string all produce an empty
    // token on one side and fail the pattern on the other.
    for (const value of ['a  b', 'a ', ' a', '', '1bad']) {
      const { rows } = await db.as('owner', c =>
        c.query<{ ok: boolean }>('SELECT app.is_structured_attribute_value($1,$2) AS ok', ['class', value]),
      )
      expect(rows[0]!.ok, JSON.stringify(value)).toBe(false)
    }
    const { rows } = await db.as('owner', c =>
      c.query<{ ok: boolean }>('SELECT app.is_structured_attribute_value($1,$2) AS ok', [
        'class',
        'cms-section-quote__text one_more',
      ]),
    )
    expect(rows[0]!.ok).toBe(true)
  })
})

describe('a stale structured schema version refuses preview and publication', () => {
  it('will not save one written against a version this database does not implement', async () => {
    await expectSqlState(
      save({
        doc: document({ schemaVersion: STRUCTURED_SCHEMA_VERSION + 1 }),
        schemaVersion: STRUCTURED_SCHEMA_VERSION + 1,
      }),
      'CMS04',
    )
  })

  it('will not save one whose document and row disagree about the version', async () => {
    // The column is what this database vouched for; the number inside is what
    // the compiler wrote. A row where they differ is one somebody rewrote half
    // of, and half a rewrite is the interesting half.
    await expectSqlState(save({ doc: document({ schemaVersion: 99 }) }), 'CMS04')
  })

  it('will not build a manifest for a page pinned to a stale one, so it neither previews nor publishes', async () => {
    const saved = await save({ slug: 'struct-stale' })
    const { page, version } = await pageWith('structured-stale', [instance(saved.rows[0]!.section_def_id, 1, VALUES)])

    // Pushed back the way a restore from an older backup would, behind the
    // command's back — which is the only way a stale row exists at all.
    await db.as('owner', c =>
      c.query(
        `UPDATE section_def_versions
                  SET structured_schema_version = 0,
                      structured_doc = jsonb_set(structured_doc, '{schemaVersion}', '0')
                WHERE section_def_id = $1`,
        [saved.rows[0]!.section_def_id],
      ),
    )

    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.build_render_manifest($1)', [version])),
      'CMS04',
    )
    const revision = await revisionOf(page)
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, revision, ...CHECKED_CLEAN])),
      'CMS04',
    )

    const head = await db.as('owner', c =>
      c.query<{ v: string | null }>('SELECT published_version_id AS v FROM pages WHERE id = $1', [page]),
    )
    expect(head.rows[0]!.v).toBeNull()
  })

  it('will not build a manifest for a document that went malformed underneath it', async () => {
    const saved = await save({ slug: 'struct-corrupted' })
    const { version } = await pageWith('structured-corrupted', [instance(saved.rows[0]!.section_def_id, 1, VALUES)])

    await db.as('owner', c =>
      c.query(
        `UPDATE section_def_versions
                  SET structured_doc = jsonb_set(structured_doc, '{nodes}',
                        '[{"type":"element","tag":"iframe"}]')
                WHERE section_def_id = $1`,
        [saved.rows[0]!.section_def_id],
      ),
    )

    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.build_render_manifest($1)', [version])),
      'CMS04',
    )
  })
})

// ------------------------------------------------------ the row's own shape

describe('the two artifacts cannot both be on one row', () => {
  const update = (sql: string, id: string) => db.as('owner', c => c.query(sql, [id]))

  it('refuses a legacy row given a structured document directly', async () => {
    // Not through the command. A CHECK constraint is what holds when the
    // command is bypassed by a migration, a restore, or a hand edit.
    await expectSqlState(
      update(`UPDATE section_def_versions SET structured_doc = '{}'::jsonb WHERE section_def_id = $1`, s.heroDefId),
      '23514',
    )
  })

  it('refuses a structured row whose compiled template has nodes in it', async () => {
    const saved = await save({ slug: 'struct-shape' })
    await expectSqlState(
      update(
        `UPDATE section_def_versions
                 SET compiled_ast = jsonb_set(compiled_ast, '{nodes}', '[{"kind":"html","value":"<p>"}]')
               WHERE section_def_id = $1`,
        saved.rows[0]!.section_def_id,
      ),
      '23514',
    )
  })

  it('refuses a structured row with no schema version', async () => {
    const saved = await save({ slug: 'struct-noversion' })
    await expectSqlState(
      update(
        'UPDATE section_def_versions SET structured_schema_version = NULL WHERE section_def_id = $1',
        saved.rows[0]!.section_def_id,
      ),
      '23514',
    )
  })

  it('gives every row that predates the column the kind it actually has', async () => {
    const { rows } = await db.as('owner', c =>
      c.query<{ definition_kind: string }>(
        'SELECT definition_kind FROM section_def_versions WHERE section_def_id = $1',
        [s.heroDefId],
      ),
    )
    expect(rows[0]!.definition_kind).toBe('legacy')
  })
})

// -------------------------------------------------------------- version pinning

describe('a page pins the exact definition version it was built with', () => {
  it('keeps rendering version 1 after version 2 is authored', async () => {
    const first = await save({ slug: 'struct-pinned' })
    const defId = first.rows[0]!.section_def_id
    const { version } = await pageWith('structured-pinned', [instance(defId, 1, VALUES)])

    const second = await save({
      slug: 'struct-pinned',
      doc: document({
        fields: [{ name: 'heading', type: 'text', label: 'Heading' }],
        nodes: [{ type: 'element', tag: 'h2', children: [{ type: 'text', field: 'heading' }] }],
      }),
    })
    expect(second.rows[0]!.version).toBe(2)

    const { rows } = await db.asUser(s.editorA, c =>
      c.query<{ manifest: { sections: { def: Record<string, unknown> }[] } }>(
        'SELECT app.build_render_manifest($1) AS manifest',
        [version],
      ),
    )
    const def = rows[0]!.manifest.sections[0]!.def
    expect(def['version']).toBe(1)
    // Version 1's document, node for node. An upgrade is a deliberate per-page
    // action, and a page that silently followed the latest version would change
    // what it says the moment somebody edited a definition elsewhere.
    expect(def['structured_doc']).toEqual(document())
  })

  it('refuses a page pinned to a version that does not exist', async () => {
    const saved = await save({ slug: 'struct-missing-version' })
    await expectSqlState(
      pageWith('structured-missing-version', [instance(saved.rows[0]!.section_def_id, 7, VALUES)]).then(({ version }) =>
        db.asUser(s.editorA, c => c.query('SELECT app.build_render_manifest($1)', [version])),
      ),
      'CMS04',
    )
  })
})

// ------------------------------------------------------------- the bounds

// The renderer crashed on this shape — about 5,000 nested elements around one
// text field returned RangeError from `structuredSectionProblems`, because the
// recursive Zod parse ran before the depth check that would have refused the
// document. The database never crashed: `structured_node_defect` tests its
// depth argument before it recurses. What it did not do was bound anything
// else, so a document too large for the renderer to accept still saved,
// previewed and published, and the section then rendered as nothing.
//
// What is asserted below is not "the database also refuses big documents". It
// is that the two layers draw the line in the same place, node for node. A
// limit that differs by one between them is a document one layer stores and the
// other refuses to render, which is the shape this schema has now met three
// times and is invisible until somebody looks at a live page.

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
