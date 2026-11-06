// The database will not store or publish a render AST it cannot vouch for
// (migration 0012).
//
// The compiler refuses to produce an unsafe definition, but
// `upsert_section_def_version` takes a pre-compiled AST as an argument — so
// "the compiler would not have made this" is a claim about the caller, not a
// property of the row. These are the checks that hold without trusting it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('astgate')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

const SLOTS = JSON.stringify([{ id: 'value', kind: 'text', label: 'V', constraints: {} }])

function save(ast: unknown, options: { policyVersion?: number; cssPolicyVersion?: number; compiledCss?: string } = {}) {
  const slug = `gate-${Math.random().toString(36).slice(2, 8)}`
  // Scoped to this definition, which is what the compiler produces and what the
  // gate expects: one definition's stylesheet cannot reach another's sections.
  const scoped = `.cms-section--${slug} .a{color:red}`
  return db.asUser(s.superAdmin, c =>
    c.query('SELECT app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
      slug,
      'Gate',
      'Test',
      '<section>{{value}}</section>',
      '.a{color:red}',
      options.compiledCss ?? scoped,
      JSON.stringify(ast),
      SLOTS,
      'hash',
      options.policyVersion ?? 4,
      options.cssPolicyVersion ?? 6,
      'gate test',
    ]),
  )
}

const good = {
  nodes: [
    { kind: 'html', value: '<section>' },
    { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'element-text' },
    { kind: 'html', value: '</section>' },
  ],
  policyVersion: 4,
  cssPolicyVersion: 6,
}

describe('authoring refuses an AST it cannot vouch for', () => {
  it('accepts a well-formed current one', async () => {
    await expect(save(good)).resolves.toBeDefined()
  })

  it.each([
    ['a slot with no context', { ...good, nodes: [{ kind: 'slot', slotId: 'value', slotKind: 'text' }] }],
    [
      'a slot in an event handler',
      { ...good, nodes: [{ kind: 'slot', slotId: 'value', slotKind: 'text', context: 'event-attribute' }] },
    ],
    [
      'a slot in a tag name',
      { ...good, nodes: [{ kind: 'slot', slotId: 'value', slotKind: 'text', context: 'tag-name' }] },
    ],
    [
      'a slot in an unquoted value',
      { ...good, nodes: [{ kind: 'slot', slotId: 'value', slotKind: 'text', context: 'unquoted-attribute' }] },
    ],
    [
      'a slot in an attribute name',
      { ...good, nodes: [{ kind: 'slot', slotId: 'value', slotKind: 'text', context: 'attribute-name' }] },
    ],
    [
      'a richtext slot in an attribute',
      { ...good, nodes: [{ kind: 'slot', slotId: 'value', slotKind: 'richtext', context: 'quoted-attribute' }] },
    ],
    [
      'an image slot in a URL attribute',
      { ...good, nodes: [{ kind: 'slot', slotId: 'value', slotKind: 'image', context: 'url-attribute' }] },
    ],
    ['a slot with no id', { ...good, nodes: [{ kind: 'slot', slotKind: 'text', context: 'element-text' }] }],
    ['an unknown node kind', { ...good, nodes: [{ kind: 'wat' }] }],
    ['a node that is not an object', { ...good, nodes: [42] }],
    ['no node list', { policyVersion: 4 }],
  ])('refuses %s', async (_label, ast) => {
    await expectSqlState(save(ast), 'CMS04')
  })

  it.each([
    ['raw authored CSS, unscoped', '.a{color:red}'],
    ['CSS containing markup', '.cms-section .a{content:"</style><script>alert(1)</script>"}'],
    ['CSS with an at-rule the policy removes', '@import url(//evil.test/x.css);'],
    ['a rule hidden inside an at-rule', '@media all{body{display:none}}'],
    ['an unscoped branch after a comma', '.cms-section .a,body{display:none}'],
    ['a scope-lookalike class', '.cms-section-evil body{display:none}'],
    ['a scope continued by an escape', String.raw`.cms-section--gate\65 vil{display:none}`],
    ['a scope continued by a comment', '.cms-section--gate/**/evil{display:none}'],
    ['another definition’s scope', '.cms-section--somebody-else .a{color:red}'],
  ])('refuses %s paired with a valid AST', async (_label, css) => {
    // The AST is fine, so the only thing standing between this call and a
    // stylesheet nobody checked is the compiled-CSS gate.
    await expectSqlState(save(good, { compiledCss: css }), 'CMS04')
  })

  it('refuses compiled CSS with no policy version', async () => {
    // NULL, the value every row from before the split carries. It means the
    // provenance is unknown, and unknown is not a version that passes.
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query('SELECT app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
          'gate-null-css',
          'Gate',
          'Test',
          '<section>{{value}}</section>',
          '.a{color:red}',
          '.cms-section--gate-null-css .a{color:red}',
          JSON.stringify(good),
          SLOTS,
          'hash',
          4,
          null,
          'gate test',
        ]),
      ),
      'CMS04',
    )
  })

  it.each([
    ['a comma', 'bad,slug'],
    ['a dot', 'bad.slug'],
    ['a space', 'bad slug'],
    ['upper case', 'BadSlug'],
    ['a leading dash', '-bad'],
    ['a backslash', 'bad\\slug'],
  ])('refuses a definition slug containing %s', async (_label, slug) => {
    // A slug becomes a CSS class name, so anything that is CSS syntax is not a
    // slug: `bad,slug` produced `.cms-section--bad,slug`, a selector list.
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query('SELECT app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
          slug,
          'Gate',
          'Test',
          '<section>{{value}}</section>',
          '',
          '',
          JSON.stringify(good),
          SLOTS,
          'hash',
          4,
          6,
          'gate test',
        ]),
      ),
      'CMS04',
    )
  })

  it('refuses an AST compiled under the previous policy version', async () => {
    // The exact case the bump exists for: a version-1 AST is structurally fine
    // and means something different, so it is refused by version rather than by
    // shape.
    await expectSqlState(save({ ...good, policyVersion: 3 }, { policyVersion: 3 }), 'CMS04')
  })

  it('says which policy version it wanted', async () => {
    const error = await save({ ...good, policyVersion: 3 }, { policyVersion: 3 }).catch((e: Error) => e)
    expect((error as Error).message).toContain('requires version 4')
  })
})

describe('publication refuses a page pinned to a definition that needs revalidating', () => {
  it('will not build a manifest, so it will not preview or publish', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'stale-def', 'Stale']))
          .rows[0]!.id,
    )
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [page, 0, heroContent(s.heroDefId), '{}']),
    )

    // Push the definition back to the old policy, the way a restore from an
    // older backup would.
    await db.as('owner', c =>
      c.query(
        `UPDATE section_def_versions
                  SET sanitizer_policy_version = 1,
                      compiled_ast = compiled_ast #- '{nodes,1,context}'
                WHERE section_def_id = $1`,
        [s.heroDefId],
      ),
    )

    const version = await db.as(
      'owner',
      async c =>
        (await c.query<{ v: string }>('SELECT draft_version_id AS v FROM pages WHERE id = $1', [page])).rows[0]!.v,
    )

    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.build_render_manifest($1)', [version])),
      'CMS04',
    )
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, 1, 1, null, '[]'])),
      'CMS04',
    )

    const head = await db.as('owner', c =>
      c.query<{ v: string | null }>('SELECT published_version_id AS v FROM pages WHERE id = $1', [page]),
    )
    expect(head.rows[0]!.v).toBeNull()
  })

  it('lists what needs revalidating, so the fix is a command and not a hunt', async () => {
    const { rows } = await db.as('owner', c =>
      c.query<{ slug: string; defect: string }>(
        'SELECT slug, defect FROM app.section_definitions_needing_revalidation()',
      ),
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]!.defect).toContain('sanitizer policy version')
  })
})

describe('the gate does not stop checking halfway (CMS-DB-01)', () => {
  it('refuses an html node with no value rather than swallowing it', async () => {
    await expectSqlState(
      save({
        nodes: [{ kind: 'html' }, { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'element-text' }],
        policyVersion: 4,
        cssPolicyVersion: 6,
      }),
      'CMS04',
    )
  })

  it('still sees a script element after one', async () => {
    // The point of the finding. `{"kind":"html"}` made the markup accumulator
    // NULL, `NULL ~* '<script'` is NULL, and the one rule that keeps a data
    // slot out of a script-bearing template was skipped for the whole node
    // list that followed.
    await expectSqlState(
      save({
        nodes: [
          { kind: 'html' },
          { kind: 'html', value: '<script>globalThis.__pwned=1</script><p>' },
          { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'element-text' },
          { kind: 'html', value: '</p>' },
        ],
        policyVersion: 4,
        cssPolicyVersion: 6,
      }),
      'CMS04',
    )
  })

  it('names the missing value, so the author is told what is wrong', async () => {
    const { rows } = await db.as('owner', c =>
      c.query<{ defect: string | null }>(`SELECT app.render_ast_defect($1::jsonb, 4) AS defect`, [
        JSON.stringify({ nodes: [{ kind: 'html' }], policyVersion: 4 }),
      ]),
    )
    expect(rows[0]!.defect).toContain('markup with no value')
  })
})

describe('the gate accepts the CSS its own compiler emits (CMS-DB-04)', () => {
  const branches = (prelude: string) =>
    db.as(
      'owner',
      async c => (await c.query<{ b: string[] }>('SELECT app.selector_branches($1) AS b', [prelude])).rows[0]!.b,
    )

  it('splits a selector list on the commas that separate branches', async () => {
    expect(await branches('.a, .b')).toEqual(['.a', ' .b'])
  })

  it.each([
    [':is()', '.a:is(.b, .c)'],
    [':not()', '.a:not(.b,.c)'],
    [':where() and a descendant', '.a:where(.b , .c) .d'],
    ['an attribute selector', '.a[title="x,y"]'],
    ['a quoted bracket', `.a[title='x,y']`],
  ])('keeps a comma inside %s in one branch', async (_label, selector) => {
    expect(await branches(selector)).toEqual([selector])
  })

  it('saves compiled CSS containing a functional pseudo-class', async () => {
    const slug = `gate-${Math.random().toString(36).slice(2, 8)}`
    await expect(
      db.asUser(s.superAdmin, c =>
        c.query('SELECT app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
          slug,
          'Gate',
          'Test',
          '<section>{{value}}</section>',
          '.a:is(.b, .c){color:red}',
          `.cms-section--${slug} .a:is(.b, .c){color:red}`,
          JSON.stringify({
            nodes: [
              { kind: 'html', value: '<section>' },
              { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'element-text' },
              { kind: 'html', value: '</section>' },
            ],
            policyVersion: 4,
            cssPolicyVersion: 6,
          }),
          SLOTS,
          'hash',
          4,
          6,
          'gate test',
        ]),
      ),
    ).resolves.toBeDefined()
  })

  it('still refuses a branch that leaves the section', async () => {
    await expectSqlState(
      save(
        {
          nodes: [
            { kind: 'html', value: '<section>' },
            { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'element-text' },
            { kind: 'html', value: '</section>' },
          ],
          policyVersion: 4,
          cssPolicyVersion: 6,
        },
        { compiledCss: '.cms-section--x .a:is(.b, .c),body{color:red}' },
      ),
      'CMS04',
    )
  })
})
