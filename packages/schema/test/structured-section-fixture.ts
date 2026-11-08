import { STRUCTURED_SCHEMA_VERSION } from '../src/index.ts'
import { TestDatabase } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

/** Open an independent database for one structured-section test suite. */
export async function createStructuredSectionFixture() {
  const db = await TestDatabase.create('structured')
  try {
    const scenario = await seedScenario(db)
    return { db, scenario, save: (options?: SaveOptions) => saveStructuredDefinition(db, scenario, options) }
  } catch (error) {
    await db.close()
    throw error
  }
}

// Keep policy numbers literal to avoid a schema-to-renderer dependency cycle.
const SANITIZER_POLICY_VERSION = 4
const CSS_POLICY_VERSION = 6

/** What a structured row stores in `compiled_ast`: nothing to interpolate. */
const NO_TEMPLATE = JSON.stringify({
  nodes: [],
  policyVersion: SANITIZER_POLICY_VERSION,
  cssPolicyVersion: CSS_POLICY_VERSION,
})

export const FIELDS = [
  { name: 'heading', type: 'text', label: 'Heading' },
  { name: 'body', type: 'richtext', label: 'Body' },
]

export const NODES = [
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

export const structuredDocument = (overrides: Record<string, unknown> = {}) => ({
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

function saveStructuredDefinition(db: TestDatabase, s: Scenario, options: SaveOptions = {}) {
  const slug = options.slug ?? `struct-${Math.random().toString(36).slice(2, 8)}`
  const doc = 'doc' in options ? options.doc : structuredDocument()
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
