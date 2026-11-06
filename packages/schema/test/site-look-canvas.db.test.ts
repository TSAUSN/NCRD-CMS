import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect } from 'vitest'
import { ThemeTokens, type HeaderConfigV1, type FooterConfig, type NavTree } from '../src/index.ts'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, heroContent, type Scenario } from './fixtures.ts'
let savedTokens: unknown
let db: TestDatabase,
  s: Scenario,
  version: string,
  look: { tokens: ThemeTokens; header: HeaderConfigV1; footer: FooterConfig; menu: NavTree }
const parent = 'http://127.0.0.1:3200',
  channel = 'site_look_' + randomUUID().replaceAll('-', '')
const snapshot = (token: string, host = 'site-a.staging.example.test') =>
  db.as(
    'public',
    async c => (await c.query('SELECT public_api.canvas_snapshot($1,$2) AS data', [host, token])).rows[0]?.data,
  )
const mint = (value: unknown = look, user = s.superAdmin, id = version) =>
  db.asUser(
    user,
    async c =>
      (
        await c.query('SELECT * FROM app.create_site_look_canvas_ticket($1,$2,$3,$4,$5)', [
          id,
          parent,
          channel,
          '[]',
          JSON.stringify(value),
        ])
      ).rows[0]!,
  )
beforeAll(async () => {
  db = await TestDatabase.create('look_canvas')
  s = await seedScenario(db)
  version = await db.asUser(
    s.editorA,
    async c =>
      (await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [s.pageA, heroContent(s.heroDefId), '{}']))
        .rows[0]!.version_id,
  )
  const ticket = await db.asUser(
    s.editorA,
    async c =>
      (
        await c.query('SELECT * FROM app.create_canvas_ticket($1,true,$2,$3,false,$4)', [
          version,
          parent,
          channel,
          '[]',
        ])
      ).rows[0]!,
  )
  const shell = (await snapshot(ticket.token)).snapshot.shell
  savedTokens = shell.theme
  look = { tokens: ThemeTokens.parse(shell.theme), header: shell.header, footer: shell.footer, menu: shell.navigation }
})
afterAll(async () => {
  await db?.close()
})
it('pins unsaved design/frame choices without writing their saved heads or changing the frozen page', async () => {
  const changed = structuredClone(look)
  changed.tokens.colors.primary = '#123456'
  changed.header.brand.siteName = 'Unsaved preview name'
  changed.menu = [{ label: 'Preview home', target: { type: 'page', page_id: s.pageA }, visible: true }]
  const ticket = await mint(changed),
    data = await snapshot(ticket.token)
  expect(data.snapshot.shell.theme.colors.primary).toBe('#123456')
  expect(data.snapshot.shell.header.brand.siteName).toBe('Unsaved preview name')
  expect(data.snapshot.shell.navigation).toEqual(changed.menu)
  expect(data.snapshot.manifest.page.version_id).toBe(version)
  expect(await snapshot(ticket.token, 'site-b.staging.example.test')).toBeNull()
  const saved = await db.as(
    'owner',
    async c =>
      (
        await c.query(
          'SELECT v.tokens FROM themes h JOIN theme_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
          [s.siteA],
        )
      ).rows[0]!.tokens,
  )
  expect(saved).toEqual(savedTokens)
})
it('lets Editors preview their frame changes but refuses an unauthorized design or Contributor frame change', async () => {
  const changed = structuredClone(look)
  changed.header.brand.siteName = 'Editor frame choice'
  expect((await snapshot((await mint(changed, s.editorA)).token)).snapshot.shell.header.brand.siteName).toBe(
    'Editor frame choice',
  )
  changed.tokens.colors.primary = '#654321'
  await expectSqlState(mint(changed, s.editorA), 'CMS02')
  await expectSqlState(mint({ ...look, header: changed.header }, s.contributorA), 'CMS02')
  await expectSqlState(mint(look, s.editorB), 'CMS03')
})
it('refuses code overrides, malformed values and menu links to another site', async () => {
  for (const value of [
    { ...look, html: '<script>bad()</script>' },
    { ...look, site_files: {} },
    { ...look, tokens: { ...look.tokens, script: 'bad()' } },
    { ...look, header: { ...look.header, onload: 'bad()' } },
    { ...look, menu: [{ label: 'Foreign page', target: { type: 'page', page_id: randomUUID() }, visible: true }] },
  ])
    await expectSqlState(mint(value), 'CMS04')
})
it('refuses private foreign media and authored frame pins rather than projecting them into the ticket', async () => {
  const id = randomUUID()
  await db.as('owner', c =>
    c.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'Private.png','Private picture',10,10,100,'image/png','ready')",
      [id, s.siteB, `look/${id}.png`, 'a'.repeat(64)],
    ),
  )
  await expectSqlState(
    mint({ ...look, header: { ...look.header, brand: { ...look.header.brand, logoMediaId: id } } }),
    'CMS04',
  )
  await expectSqlState(
    mint({
      ...look,
      header: {
        schemaVersion: 2,
        enabled: true,
        sticky: false,
        component: { section_def_id: s.heroDefId, section_def_version: 1, values: {} },
      },
    }),
    'CMS04',
  )
})
it('opens frame previews after a menu target is archived without exposing the archived page', async () => {
  const archived = await db.asUser(s.superAdmin, async c => {
    const id = (
      await c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'archived-menu-qa', 'Archived menu QA'])
    ).rows[0]!.id
    await c.query('SELECT app.archive_page($1,(SELECT revision FROM pages WHERE id=$1))', [id])
    return id as string
  })
  for (const visible of [false, true]) {
    const ticket = await mint({
      ...look,
      menu: [{ label: 'Archived QA', target: { type: 'page', page_id: archived }, visible }],
    })
    const data = await snapshot(ticket.token)
    expect(data.snapshot.navigationPaths[archived]).toBeUndefined()
    expect(data.snapshot.manifest.page.version_id).toBe(version)
  }
  const foreign = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query('SELECT app.create_page($1,$2,$3) AS id', [
          s.siteB,
          'foreign-archived-menu',
          'Foreign archived menu',
        ])
      ).rows[0]!.id,
  )
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT app.archive_page($1,(SELECT revision FROM pages WHERE id=$1))', [foreign]),
  )
  await expectSqlState(
    mint({ ...look, menu: [{ label: 'Foreign', target: { type: 'page', page_id: foreign }, visible: false }] }),
    'CMS04',
  )
})
it('keeps issuance and ticket writes inaccessible to public and worker roles', async () => {
  for (const role of ['public', 'worker'] as const)
    await expectSqlState(
      db.as(role, c =>
        c.query('SELECT * FROM app.create_site_look_canvas_ticket($1,$2,$3,$4,$5)', [
          version,
          parent,
          channel,
          '[]',
          JSON.stringify(look),
        ]),
      ),
      '42501',
    )
  await expectSqlState(
    db.asUser(s.editorA, c => c.query("UPDATE canvas_preview_tickets SET snapshot='{}' WHERE page_id=$1", [s.pageA])),
    '42501',
  )
})
