import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compileSection } from '../../renderer/src/compile.ts'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('typedattrs')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

function save(html: string, kind: 'image' | 'link', mutate?: (ast: ReturnType<typeof compileSection>['ast']) => void) {
  const slots = [{ id: 'value', kind, label: 'Value', constraints: {} }]
  const compiled = compileSection({ sourceHtml: html, slots })
  mutate?.(compiled.ast)
  return db.asUser(s.superAdmin, client =>
    client.query('SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
      `typed-${Math.random().toString(36).slice(2, 10)}`,
      'Typed',
      'Migration',
      html,
      '',
      '',
      JSON.stringify(compiled.ast),
      JSON.stringify(slots),
      compiled.renderHash,
      compiled.ast.policyVersion,
      compiled.ast.cssPolicyVersion,
      'Preserved attributes',
    ]),
  )
}

describe('preserved typed attribute storage contract', () => {
  it('stores image src/alt/role and a destination while retaining source/hash', async () => {
    for (const [html, kind] of [
      ['<img class="cover" width="640" src="{{value}}" alt="{{value}}" role="{{value}}">', 'image'],
      ['<a class="cta" href="{{value}}"><svg viewBox="0 0 2 2"><path d="M0 0"/></svg>Go</a>', 'link'],
    ] as const) {
      const result = await save(html, kind)
      const row = result.rows[0]!
      const stored = await db.asUser(s.superAdmin, c =>
        c.query(
          'SELECT source_html,render_hash,sanitizer_policy_version,compiled_ast FROM section_def_versions WHERE section_def_id=$1 AND version=$2',
          [row.section_def_id, row.version],
        ),
      )
      expect(stored.rows[0]?.source_html).toBe(html)
      expect(stored.rows[0]?.sanitizer_policy_version).toBe(5)
      expect(stored.rows[0]?.compiled_ast.policyVersion).toBe(5)
      expect(stored.rows[0]?.render_hash).toHaveLength(32)
    }
  })
  it.each([
    ['image', 'url-attribute', 'href'],
    ['image', 'url-attribute', 'srcset'],
    ['image', 'style-attribute', 'style'],
    ['image', 'quoted-attribute', 'title'],
    ['link', 'url-attribute', 'src'],
    ['link', 'url-attribute', 'formaction'],
  ] as const)('refuses %s in %s %s', async (kind, context, attribute) => {
    await expectSqlState(
      save(`<img src="{{value}}">`, kind, ast => {
        ast.policyVersion = 5
        ast.nodes = [{ kind: 'slot', slotId: 'value', slotKind: kind, context, attribute }]
      }),
      'CMS04',
    )
  })
  it('refuses new bindings labelled with old policy 4', async () => {
    await expectSqlState(
      save('<img src="{{value}}" alt="{{value}}">', 'image', ast => {
        ast.policyVersion = 4
      }),
      'CMS04',
    )
  })
  it('refuses a missing attribute and future policy', async () => {
    await expectSqlState(
      save('<img src="{{value}}">', 'image', ast => {
        ast.nodes = [{ kind: 'slot', slotId: 'value', slotKind: 'image', context: 'url-attribute' }]
      }),
      'CMS04',
    )
    await expectSqlState(
      save('<img src="{{value}}">', 'image', ast => {
        ast.policyVersion = 6
      }),
      'CMS04',
    )
  })
})
