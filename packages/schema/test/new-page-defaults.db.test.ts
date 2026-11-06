import { beforeAll, afterAll, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, heroContent, type Scenario } from './fixtures.ts'
let db: TestDatabase, s: Scenario, file: string, version: string
const marker = randomUUID(),
  defaults = {
    html: { lang: 'en' },
    body: { class: 'new-original-page', 'data-note': '/assets/' + marker },
    header: true,
    footer: true,
    quirks: false,
  }
beforeAll(async () => {
  db = await TestDatabase.create('new_page_defaults')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    file = (
      await c.query('SELECT app.register_site_file($1,$2,$3,$4,$5,$6,$7,$8) AS id', [
        s.siteA,
        randomUUID(),
        'script',
        'menu.js',
        'local:menu.js',
        'text/javascript',
        100,
        'a'.repeat(64),
      ])
    ).rows[0]!.id
    version = (
      await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [s.pageA, heroContent(s.heroDefId), '{}'])
    ).rows[0]!.version_id
  })
})
afterAll(async () => {
  await db?.close()
})
const bundle = () => ({
  version: 1,
  files: [file],
  styles: [],
  scripts: [{ fileId: file, position: 'body-end', loading: 'normal', pages: [s.pageA], newPages: true }],
  original: {
    version: 1,
    definitions: [],
    pages: [{ pageId: s.pageA, html: {}, body: {}, header: false, footer: false }],
    newPages: defaults,
  },
})
const save = (value: unknown, user?: string) =>
  db.asUser(user ?? s.superAdmin, async c => {
    const revision =
      (await c.query('SELECT revision FROM site_file_heads WHERE site_id=$1', [s.siteA])).rows[0]?.revision ?? 0
    return (
      await c.query('SELECT * FROM app.save_site_file_bundle($1,$2,$3)', [s.siteA, revision, JSON.stringify(value)])
    ).rows[0]!
  })
it('requires root review, stores exact defaults and denies direct helper access', async () => {
  for (const user of [s.editorA, s.contributorA, s.editorB]) await expectSqlState(save(bundle(), user), 'CMS02')
  const saved = await save(bundle())
  expect(
    (await db.asUser(s.editorA, c => c.query('SELECT bundle FROM site_file_versions WHERE id=$1', [saved.version_id])))
      .rows[0]!.bundle,
  ).toEqual(bundle())
  await expectSqlState(
    db.asUser(s.superAdmin, c => c.query('SELECT app.new_page_file_choices_defect($1)', [JSON.stringify(bundle())])),
    '42501',
  )
  await expectSqlState(
    db.as('public', c => c.query('SELECT app.without_new_page_file_choices($1)', [JSON.stringify(bundle())])),
    '42501',
  )
})
it('refuses executable, incomplete or unknown default metadata and non-boolean file choices', async () => {
  for (const value of [
    { ...defaults, pageId: s.pageA },
    { ...defaults, body: { onload: 'run()' } },
    { ...defaults, body: { style: 'color:red' } },
    { ...defaults, html: { 'data-cms-section': '0' } },
    { ...defaults, quirks: 'false' },
    { ...defaults, header: null },
    { html: {}, body: {}, header: true },
  ])
    await expectSqlState(save({ ...bundle(), original: { ...bundle().original, newPages: value } }), 'CMS04')
  for (const value of ['true', null, {}, 1])
    await expectSqlState(save({ ...bundle(), scripts: [{ ...bundle().scripts[0], newPages: value }] }), 'CMS04')
  const { newPages, ...original } = bundle().original
  await expectSqlState(save({ ...bundle(), original }), 'CMS04')
  await expectSqlState(save({ ...bundle(), scripts: [{ ...bundle().scripts[0], inline: 'run()' }] }), 'CMS04')
  expect(newPages).toEqual(defaults)
})
it('keeps frozen reviewed defaults after removal and does not grant assets mentioned in document attributes', async () => {
  await save(bundle())
  const ticket = await db.asUser(
    s.editorA,
    async c =>
      (
        await c.query('SELECT * FROM app.create_canvas_ticket($1,true,$2,$3,false,$4)', [
          version,
          'http://127.0.0.1:3200',
          'new-page-defaults-123456789',
          '[]',
        ])
      ).rows[0]!,
  )
  const snapshot = () =>
    db.as(
      'public',
      async c =>
        (
          await c.query('SELECT public_api.canvas_snapshot($1,$2) AS data', [
            'site-a.staging.example.test',
            ticket.token,
          ])
        ).rows[0]!.data,
    )
  const before = await snapshot()
  expect(before.snapshot.shell.site_files.bundle.original.newPages).toEqual(defaults)
  expect(
    (
      await db.as('owner', c => c.query('SELECT asset_refs FROM canvas_preview_tickets WHERE version_id=$1', [version]))
    ).rows[0]!.asset_refs.some((reference: { id: string }) => reference.id === marker),
  ).toBe(false)
  const { newPages, ...original } = bundle().original
  await save({ ...bundle(), scripts: [{ ...bundle().scripts[0], newPages: false }], original })
  expect(await snapshot()).toEqual(before)
  expect(
    (
      await db.as('public', c =>
        c.query('SELECT public_api.canvas_snapshot($1,$2) AS data', ['site-b.staging.example.test', ticket.token]),
      )
    ).rows[0]!.data,
  ).toBeNull()
  expect(newPages).toEqual(defaults)
})
it('can reapply the additive migration twice without resetting choices or layering wrappers', async () => {
  const saved = await save(bundle()),
    sql = readFileSync(new URL('../migrations/0143_reviewed_new_page_defaults.sql', import.meta.url), 'utf8')
  await db.as('owner', async c => {
    await c.query(sql)
    await c.query(sql)
    expect(
      (await c.query('SELECT app.site_file_bundle_defect($1,$2) AS defect', [s.siteA, JSON.stringify(bundle())]))
        .rows[0]!.defect,
    ).toBeNull()
    expect(
      (await c.query('SELECT bundle FROM site_file_versions WHERE id=$1', [saved.version_id])).rows[0]!.bundle,
    ).toEqual(bundle())
    const bad = { ...bundle(), original: { ...bundle().original, newPages: { ...defaults, quirks: 'true' } } }
    expect(
      (await c.query('SELECT app.site_file_bundle_defect($1,$2) AS defect', [s.siteA, JSON.stringify(bad)])).rows[0]!
        .defect,
    ).toContain('new pages')
  })
})
