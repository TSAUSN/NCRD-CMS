// Authored header and footer components (ADR 0010, migration 0084).
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('frame-components')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

const frameAst = (menuContext = 'element-text') => ({
  nodes: [
    { kind: 'html', value: '<div class="bar"><a href="/">' },
    { kind: 'slot', slotId: 'title', slotKind: 'text', context: 'element-text' },
    { kind: 'html', value: '</a></div><nav>' },
    {
      kind: 'slot',
      slotId: 'menu',
      slotKind: 'navigation',
      context: menuContext,
      ...(menuContext === 'quoted-attribute' ? { attribute: 'title' } : {}),
    },
    { kind: 'html', value: '</nav>' },
  ],
  policyVersion: 4,
  cssPolicyVersion: 6,
})
const frameSlots = [
  { id: 'title', kind: 'text', label: 'Title', constraints: {} },
  { id: 'menu', kind: 'navigation', label: 'Site menu', constraints: {} },
]

async function defineFrame(slug: string, ast = frameAst(), scope: { site?: string } = {}) {
  const common = [
    slug,
    'Frame ' + slug,
    'Frame',
    '<div class="bar"><a href="/">{{title}}</a></div><nav>{{menu}}</nav>',
    '.bar{display:flex}',
    `.cms-section--${slug} .bar{display:flex}`,
    JSON.stringify(ast),
    JSON.stringify(frameSlots),
    `hash-${slug}`,
    4,
    6,
    'initial',
  ]
  return db.asUser(s.superAdmin, async client => {
    const row = scope.site
      ? (
          await client.query<{ section_def_id: string }>(
            'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
            [...common, false, 'legacy', null, null, 'site', scope.site],
          )
        ).rows[0]!
      : (
          await client.query<{ section_def_id: string }>(
            'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
            common,
          )
        ).rows[0]!
    return row.section_def_id
  })
}

const place = (defId: string, placement: string, actor = s.superAdmin) =>
  db.asUser(actor, client => client.query('SELECT app.set_section_def_placement($1,$2)', [defId, placement]))

type Heads = {
  header_revision: string
  footer_revision: string
  header_live: Record<string, unknown>
  footer_live: Record<string, unknown>
}
async function heads(siteId = s.siteA): Promise<Heads> {
  return db.asUser(
    s.editorA,
    async client =>
      (
        await client.query<Heads>(
          `SELECT h.revision AS header_revision, f.revision AS footer_revision,
            hl.content AS header_live, fl.content AS footer_live
       FROM global_elements h JOIN global_element_versions hl ON hl.id = h.published_version_id
       JOIN global_elements f ON f.site_id = h.site_id AND f.kind = 'footer'
       JOIN global_element_versions fl ON fl.id = f.published_version_id
      WHERE h.site_id = $1 AND h.kind = 'header'`,
          [siteId],
        )
      ).rows[0]!,
  )
}
async function saveFrame(header: unknown, footer?: unknown) {
  const current = await heads()
  return db.asUser(s.editorA, client =>
    client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
      s.siteA,
      current.header_revision,
      current.footer_revision,
      JSON.stringify(header),
      JSON.stringify(footer ?? current.footer_live),
    ]),
  )
}
async function publishFrame() {
  const current = await heads()
  return db.asUser(s.editorA, client =>
    client.query('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
      s.siteA,
      current.header_revision,
      current.footer_revision,
    ]),
  )
}
async function refused(promise: Promise<unknown>, reason: RegExp) {
  const error = await promise.then(
    () => null,
    (caught: Error & { code?: string }) => caught,
  )
  expect(error?.code).toBe('CMS04')
  expect(error?.message).toMatch(reason)
}

const authored = (defId: string, over: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  enabled: true,
  sticky: true,
  component: { section_def_id: defId, section_def_version: 1, values: { title: 'Site A' } },
  ...over,
})

describe('navigation slots in the database gate', () => {
  it('stores a definition whose navigation slot sits between tags', async () => {
    expect(await defineFrame(`nav-ok-${randomUUID().slice(0, 6)}`)).toMatch(/[0-9a-f-]{36}/)
  })

  it('refuses a navigation slot inside an attribute', async () => {
    await expectSqlState(defineFrame(`nav-attr-${randomUUID().slice(0, 6)}`, frameAst('quoted-attribute')), 'CMS04')
  })
})

describe('placement', () => {
  it('defaults to page and is changed only by a super admin', async () => {
    const id = await defineFrame(`placement-${randomUUID().slice(0, 6)}`)
    const before = await db.asUser(s.editorA, client =>
      client.query<{ placement: string }>('SELECT placement FROM section_defs WHERE id=$1', [id]),
    )
    expect(before.rows[0]!.placement).toBe('page')
    await expectSqlState(place(id, 'header', s.editorA), 'CMS02')
    await expectSqlState(place(id, 'sidebar'), 'CMS04')
    await place(id, 'header')
    const after = await db.asUser(s.editorA, client =>
      client.query<{ placement: string }>('SELECT placement FROM section_defs WHERE id=$1', [id]),
    )
    expect(after.rows[0]!.placement).toBe('header')
  })

  it('refuses a frame component in page content and freezes placement once used', async () => {
    const id = await defineFrame(`in-page-${randomUUID().slice(0, 6)}`)
    await place(id, 'header')
    const page = await db.asUser(
      s.editorA,
      async client =>
        (
          await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
            s.siteA,
            `frame-${randomUUID().slice(0, 6)}`,
            'Frame test',
          ])
        ).rows[0]!.id,
    )
    const content = JSON.stringify([{ section_def_id: id, section_def_version: 1, values: { title: 'x' } }])
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [page, content, '{}']),
      ),
      'CMS04',
    )
    // Used by a page: the hero cannot become a frame component.
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        page,
        JSON.stringify([{ section_def_id: s.heroDefId, section_def_version: 1, values: { heading: 'h', intro: 'i' } }]),
        '{}',
      ]),
    )
    await expectSqlState(place(s.heroDefId, 'header'), 'CMS04')
  })
})

describe('version-2 header and footer content', () => {
  it('checks shape on save and refuses presets fields mixed in', async () => {
    await expectSqlState(saveFrame({ ...authored(randomUUID()), preset: 'standard' }), 'CMS04')
    await expectSqlState(saveFrame(authored(randomUUID(), { sticky: 'yes' })), 'CMS04')
    await expectSqlState(
      saveFrame({
        ...authored(randomUUID()),
        component: { section_def_id: 'nope', section_def_version: 1, values: {} },
      }),
      'CMS04',
    )
    await expectSqlState(
      saveFrame({
        ...authored(randomUUID()),
        component: { section_def_id: randomUUID(), section_def_version: 1.5, values: {} },
      }),
      'CMS04',
    )
    // A footer has no sticky flag.
    const current = await heads()
    await expectSqlState(
      saveFrame(current.header_live, {
        schemaVersion: 2,
        enabled: true,
        sticky: false,
        component: { section_def_id: randomUUID(), section_def_version: 1, values: {} },
      }),
      'CMS04',
    )
  })

  it("refuses at publication a component that is missing, misplaced, or another site's", async () => {
    await saveFrame(authored(randomUUID()))
    await refused(publishFrame(), /does not exist at that version/)

    await saveFrame(authored(s.heroDefId))
    await refused(publishFrame(), /not a header component/)

    const footerOnly = await defineFrame(`footer-only-${randomUUID().slice(0, 6)}`)
    await place(footerOnly, 'footer')
    await saveFrame(authored(footerOnly))
    await refused(publishFrame(), /not a header component/)

    const siteB = await defineFrame(`site-b-${randomUUID().slice(0, 6)}`, frameAst(), { site: s.siteB })
    await place(siteB, 'header')
    await saveFrame(authored(siteB))
    await refused(publishFrame(), /belongs to another site/)
  })

  it('publishes a ready component into the shell with its compiled definition', async () => {
    const slug = `header-${randomUUID().slice(0, 6)}`
    const id = await defineFrame(slug)
    await place(id, 'header')
    await saveFrame(authored(id))
    await publishFrame()
    const shell = (
      await db.asUser(s.editorA, client =>
        client.query<{ payload: Record<string, any> }>('SELECT payload FROM published_site_shells WHERE site_id=$1', [
          s.siteA,
        ]),
      )
    ).rows[0]!.payload
    expect(shell['header'].component.section_def_id).toBe(id)
    expect(shell['header_component']).toMatchObject({
      section_def_id: id,
      version: 1,
      slug,
      css: `.cms-section--${slug} .bar{display:flex}`,
      css_policy_version: 6,
      sanitizer_policy_version: 4,
    })
    expect(shell['footer_component']).toBeNull()
  })

  it('previews a draft component only for someone with access to the site', async () => {
    const id = await defineFrame(`preview-${randomUUID().slice(0, 6)}`)
    await place(id, 'header')
    const view = await db.asUser(s.editorA, client =>
      client.query<{ view: Record<string, unknown> | null }>(
        "SELECT app.preview_global_component($1,'header',$2) AS view",
        [s.siteA, JSON.stringify(authored(id))],
      ),
    )
    expect(view.rows[0]!.view).toMatchObject({ section_def_id: id, version: 1 })
    const misplaced = await db.asUser(s.editorA, client =>
      client.query<{ view: unknown }>("SELECT app.preview_global_component($1,'footer',$2) AS view", [
        s.siteA,
        JSON.stringify(authored(id)),
      ]),
    )
    expect(misplaced.rows[0]!.view).toBeNull()
    await expectSqlState(
      db.asUser(s.editorB, client =>
        client.query("SELECT app.preview_global_component($1,'header',$2)", [s.siteA, JSON.stringify(authored(id))]),
      ),
      'CMS02',
    )
  })

  it('reverts an authored frame to the live version like a preset', async () => {
    const current = await heads()
    expect(current.header_live['schemaVersion']).toBe(2)
    await saveFrame({ ...current.header_live, enabled: false })
    const draft = await heads()
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.revert_global_elements_to_live($1,$2,$3)', [
        s.siteA,
        draft.header_revision,
        draft.footer_revision,
      ]),
    )
    const reverted = await db.asUser(s.editorA, client =>
      client.query<{ content: Record<string, unknown> }>(
        `SELECT v.content FROM global_elements g JOIN global_element_versions v ON v.id = g.draft_version_id
        WHERE g.site_id=$1 AND g.kind='header'`,
        [s.siteA],
      ),
    )
    expect(reverted.rows[0]!.content['enabled']).toBe(true)
  })
})
