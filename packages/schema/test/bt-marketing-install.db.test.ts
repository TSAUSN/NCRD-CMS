import { beforeAll, afterAll, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TestDatabase } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { createFilesystemMediaStore } from '../../platform/src/local/index.ts'
import { importBetterTogetherHomepage } from '../../importer/src/better-together.ts'
import { installBetterTogetherPages } from '../../importer/src/better-together-install.ts'
let db: TestDatabase, s: Scenario, root: string
beforeAll(async () => {
  db = await TestDatabase.create('btmarketing')
  s = await seedScenario(db)
  root = mkdtempSync(join(tmpdir(), 'cms-bt-pages-'))
  mkdirSync(join(root, 'cache'))
  mkdirSync(join(root, 'css'))
  writeFileSync(join(root, 'cache/receipts.json'), '[]')
  writeFileSync(join(root, 'css/site.css'), '.hero{color:navy}')
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT * FROM app.save_site_file_bundle($1,0,$2)', [
      s.siteA,
      JSON.stringify({
        version: 1,
        files: [],
        scripts: [],
        styles: [],
        original: {
          version: 1,
          definitions: [],
          pages: [{ pageId: s.pageA, html: { lang: 'en' }, body: {}, header: false, footer: false }],
        },
      }),
    ]),
  )
})
afterAll(async () => {
  await db?.close()
  if (root) rmSync(root, { force: true, recursive: true })
})
const archive = () =>
  importBetterTogetherHomepage({
    root,
    cache: join(root, 'cache'),
    page: 'hotel-information.php',
    title: 'Hotel information',
    html: '<html lang="en"><head><link rel="stylesheet" href="css/site.css"></head><body><nav><a href="index.php">Home</a></nav><div class="hero"><h1>Hotel information</h1></div><div class="footer"><p>Contact</p></div><script>window.localProof=true;</script></body></html>',
  }).archive
it('adds original pages and exact reviewed files through commands; repeat keeps changed drafts and existing homepage', async () => {
  const store = createFilesystemMediaStore(join(root, 'objects')),
    before = await db.asUser(s.superAdmin, c =>
      c.query('SELECT revision,draft_version_id FROM pages WHERE id=$1', [s.pageA]),
    )
  const result = await db.asUser(s.superAdmin, client =>
    installBetterTogetherPages({ client, store, siteId: s.siteA, archives: [archive()], reviewed: true }),
  )
  expect(result.created).toHaveLength(1)
  expect(result.files).toBe(3)
  const id = result.created[0]!.id
  await db.asUser(s.superAdmin, async c => {
    const page = (
      await c.query(
        'SELECT p.revision,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [id],
      )
    ).rows[0]!
    page.content[1].values['text-0'] = 'Owner edited this'
    await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
      id,
      page.revision,
      JSON.stringify(page.content),
      '{}',
      'checkpoint',
      'Owner edit',
    ])
  })
  const retry = await db.asUser(s.superAdmin, client =>
    installBetterTogetherPages({ client, store, siteId: s.siteA, archives: [archive()], reviewed: true }),
  )
  expect(retry.created).toEqual([])
  expect(retry.existing).toEqual(['hotel-information'])
  await db.asUser(s.superAdmin, async c => {
    expect((await c.query('SELECT revision,draft_version_id FROM pages WHERE id=$1', [s.pageA])).rows).toEqual(
      before.rows,
    )
    expect(
      (
        await c.query('SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1', [
          id,
        ])
      ).rows[0]!.content[1].values['text-0'],
    ).toBe('Owner edited this')
    const projection = (await c.query('SELECT app.preview_site_files($1) AS value', [s.siteA])).rows[0]!.value
    expect(projection.bundle.original.pages).toHaveLength(2)
    expect(projection.bundle.scripts[0].pages).toEqual([id])
    expect(projection.bundle.original.definitions).toHaveLength(3)
  })
})
it('refuses an Editor even with a caller review claim', async () => {
  await expect(
    db.asUser(s.editorA, client =>
      installBetterTogetherPages({
        client,
        store: createFilesystemMediaStore(join(root, 'objects')),
        siteId: s.siteA,
        archives: [archive()],
        reviewed: true,
      }),
    ),
  ).rejects.toThrow(/Super Admin/)
})
