import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { STRUCTURED_SCHEMA_VERSION } from '../src/index.ts'
import { CHECKED_CLEAN, expectSqlState } from './harness.ts'
import {
  createStructuredSectionFixture,
  FIELDS,
  NODES,
  structuredDocument as document,
} from './structured-section-fixture.ts'

type Fixture = Awaited<ReturnType<typeof createStructuredSectionFixture>>
let db: Fixture['db']
let s: Fixture['scenario']
let save: Fixture['save']

beforeAll(async () => {
  const fixture = await createStructuredSectionFixture()
  db = fixture.db
  s = fixture.scenario
  save = fixture.save
})
afterAll(async () => {
  await db?.close()
})

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
