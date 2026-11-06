import { readFileSync } from 'node:fs'
import { beforeAll, afterAll, expect, it } from 'vitest'
import { TestDatabase, CHECKED_CLEAN } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { savePageDetails, pageInMenu } from '../src/lib/page-details.ts'
import {
  exportSiteArchiveInTransaction,
  importSiteArchiveInTransaction,
  importedId,
} from '../src/lib/site-portability.ts'
import type { MediaStore } from '@cms/platform'
let db: TestDatabase, s: Scenario
const media: MediaStore = {
  get: async () => null,
  put: async () => {
    throw new Error('No media in this fixture')
  },
  remove: async () => {},
  createSignedUpload: async () => {
    throw new Error('Unused')
  },
}
beforeAll(async () => {
  db = await TestDatabase.create('page_details')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
async function setup() {
  return db.asUser(s.editorA, async client => {
    const slug = 'details-' + crypto.randomUUID(),
      page = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, slug, 'Original title'])).rows[0]!
        .id
    const saved = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        page,
        JSON.stringify([
          {
            section_def_id: s.heroDefId,
            section_def_version: 1,
            values: { heading: 'An original heading', intro: 'Preserve this body' },
          },
        ]),
        '{}',
      ])
    ).rows[0]!
    await client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, saved.revision, ...CHECKED_CLEAN])
    const head = (await client.query('SELECT revision FROM pages WHERE id=$1', [page])).rows[0]!
    const nav = (
      await client.query(
        'SELECT n.revision,v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
        [s.siteA],
      )
    ).rows[0]!
    return {
      pageId: page,
      title: 'A clearer title',
      address: slug + '-updated',
      parentId: s.pageA,
      inMenu: null,
      originalInMenu: pageInMenu(nav.tree, page),
      menuRevision: Number(nav.revision),
      expectedRevision: Number(head.revision),
      oldAddress: slug,
    }
  })
}
it('saves native identity and grouping without moving the menu, live route or content', async () => {
  const input = await setup(),
    menuBefore = await db.asUser(
      s.editorA,
      async client => (await client.query('SELECT * FROM navigations WHERE site_id=$1', [s.siteA])).rows,
    ),
    saved = await db.asUser(s.editorA, client => savePageDetails(client, input, input.expectedRevision))
  expect(
    await db.asUser(
      s.editorA,
      async client => (await client.query('SELECT * FROM navigations WHERE site_id=$1', [s.siteA])).rows,
    ),
  ).toEqual(menuBefore)
  const row = (
    await db.asUser(s.editorA, client =>
      client.query(
        'SELECT p.title,p.slug,p.parent_page_id,v.content,r.path FROM pages p JOIN page_versions v ON v.id=p.draft_version_id JOIN published_routes r ON r.page_id=p.id WHERE p.id=$1',
        [input.pageId],
      ),
    )
  ).rows[0]!
  expect(row.title).toBe(input.title)
  expect(row.slug).toBe(input.address)
  expect(row.parent_page_id).toBe(s.pageA)
  expect(row.path).toBe('/' + input.oldAddress)
  expect(row.content[0].values.heading).toBe('An original heading')
  expect(saved.revision).toBeGreaterThan(input.expectedRevision)
})
it('rejects a stale page and attempted native menu changes, rolling back renames atomically', async () => {
  const input = await setup()
  await expect(
    db.asUser(s.editorA, client => savePageDetails(client, input, input.expectedRevision - 1)),
  ).rejects.toThrow('The page changed')
  await expect(
    db.asUser(s.editorA, client =>
      savePageDetails(
        client,
        { ...input, inMenu: !input.originalInMenu, menuRevision: input.menuRevision - 1 },
        input.expectedRevision,
      ),
    ),
  ).rejects.toThrow('Use Header & menu')
  const row = (
    await db.asUser(s.editorA, client =>
      client.query('SELECT title,slug,parent_page_id FROM pages WHERE id=$1', [input.pageId]),
    )
  ).rows[0]!
  expect(row).toEqual({ title: 'Original title', slug: input.oldAddress, parent_page_id: null })
})
it('denies contributors, other sites, foreign parents, self-parenting and cycles', async () => {
  const input = await setup()
  for (const actor of [s.contributorA, s.editorB])
    await expect(db.asUser(actor, client => savePageDetails(client, input, input.expectedRevision))).rejects.toThrow()
  const foreign = (
    await db.asUser(s.editorB, client =>
      client.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteB, 'foreign-parent', 'Other site']),
    )
  ).rows[0]!.id
  for (const parent of [foreign, input.pageId])
    await expect(
      db.asUser(s.editorA, client => savePageDetails(client, { ...input, parentId: parent }, input.expectedRevision)),
    ).rejects.toThrow()
  const saved = await db.asUser(s.editorA, client => savePageDetails(client, input, input.expectedRevision))
  await expect(
    db.asUser(s.editorA, client =>
      client.query('SELECT app.set_page_parent($1,(SELECT revision FROM pages WHERE id=$1),$2)', [
        s.pageA,
        input.pageId,
      ]),
    ),
  ).rejects.toThrow('outside this page')
  expect(saved.parentId).toBe(s.pageA)
})
it('exports and reimports hierarchy with remapped ids, keeping old archives without a parent readable', async () => {
  const input = await setup()
  await db.asUser(s.editorA, client => savePageDetails(client, input, input.expectedRevision))
  const archive = await db.asUser(s.superAdmin, client => exportSiteArchiveInTransaction(client, s.siteA, media))
  expect(archive.content.pages.find(page => page.id === input.pageId)?.parent_page_id).toBe(s.pageA)
  const request = crypto.randomUUID()
  await db.asUser(s.superAdmin, client =>
    importSiteArchiveInTransaction(client, request, { slug: 'hierarchy-copy', name: 'Hierarchy copy' }, archive, media),
  )
  const copied = (
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT parent_page_id FROM pages WHERE id=$1', [importedId(request, input.pageId)]),
    )
  ).rows[0]!
  expect(copied.parent_page_id).toBe(importedId(request, s.pageA))
})

it('repeats page-management migrations without touching saved heads, content or audit history', async () => {
  async function snapshot() {
    return db.as(
      'owner',
      async client =>
        (
          await client.query(
            'SELECT id,revision,draft_version_id,published_version_id,parent_page_id FROM pages ORDER BY id',
          )
        ).rows,
    )
  }
  const before = await snapshot(),
    audit = await db.as('owner', async client => (await client.query('SELECT count(*) FROM audit_log')).rows)
  for (const migration of [
    '0124_page_hierarchy.sql',
    '0125_duplicate_page.sql',
    '0167_page_details_keep_site_menu.sql',
  ])
    await db.as('owner', client =>
      client.query(readFileSync(new URL('../../../packages/schema/migrations/' + migration, import.meta.url), 'utf8')),
    )
  expect(await snapshot()).toEqual(before)
  expect(await db.as('owner', async client => (await client.query('SELECT count(*) FROM audit_log')).rows)).toEqual(
    audit,
  )
})

it('keeps native menu and frame heads exact even after another tab changes the menu', async () => {
  const input = await setup()
  const before = await db.asUser(s.superAdmin, async client => {
    const head = (
      await client.query(
        'SELECT n.revision,v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
        [s.siteA],
      )
    ).rows[0]!
    await client.query('SELECT app.save_navigation_draft($1,$2,$3,$4)', [
      s.siteA,
      head.revision,
      JSON.stringify([
        ...head.tree,
        { label: '[New menu link]', target: { type: 'url', url: '/example' }, visible: true },
      ]),
      'manual',
    ])
    return {
      menu: (await client.query('SELECT * FROM navigations WHERE site_id=$1', [s.siteA])).rows,
      frames: (await client.query('SELECT * FROM global_elements WHERE site_id=$1 ORDER BY id', [s.siteA])).rows,
    }
  })
  const saved = await db.asUser(s.editorA, client =>
    savePageDetails(client, { ...input, menuRevision: input.menuRevision - 1 }, input.expectedRevision),
  )
  expect(saved.title).toBe(input.title)
  expect(
    await db.asUser(
      s.superAdmin,
      async client => (await client.query('SELECT * FROM navigations WHERE site_id=$1', [s.siteA])).rows,
    ),
  ).toEqual(before.menu)
  expect(
    await db.asUser(
      s.superAdmin,
      async client =>
        (await client.query('SELECT * FROM global_elements WHERE site_id=$1 ORDER BY id', [s.siteA])).rows,
    ),
  ).toEqual(before.frames)
  const other = await setup()
  for (const actor of [s.editorA, s.superAdmin])
    await expect(
      db.asUser(actor, client =>
        savePageDetails(client, { ...other, inMenu: !other.originalInMenu }, other.expectedRevision),
      ),
    ).rejects.toThrow('Use Header & menu')
})

it('preserves an existing native automatic menu label when the renamed page is published', async () => {
  await db.asUser(s.editorA, async client => {
    const nav = (
      await client.query(
        'SELECT n.revision,v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
        [s.siteA],
      )
    ).rows[0]!
    const saved = (
      await client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
        s.siteA,
        nav.revision,
        JSON.stringify(nav.tree),
        'auto',
      ])
    ).rows[0]!
    await client.query('SELECT app.publish_navigation($1,$2)', [s.siteA, saved.revision])
  })
  const input = await setup(),
    before = await db.asUser(
      s.editorA,
      async client => (await client.query('SELECT * FROM navigations WHERE site_id=$1', [s.siteA])).rows,
    )
  expect(before[0]!.mode).toBe('auto')
  expect(input.originalInMenu).toBe(true)
  const saved = await db.asUser(s.editorA, client => savePageDetails(client, input, input.expectedRevision))
  await db.asUser(s.editorA, client =>
    client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [input.pageId, saved.revision, ...CHECKED_CLEAN]),
  )
  expect(
    await db.asUser(
      s.editorA,
      async client => (await client.query('SELECT * FROM navigations WHERE site_id=$1', [s.siteA])).rows,
    ),
  ).toEqual(before)
})

it('retains original-design page-details menu behavior behind the same command and revision checks', async () => {
  const input = await setup()
  await db.asUser(s.superAdmin, client =>
    client.query('SELECT app.save_site_file_bundle($1,0,$2)', [
      s.siteA,
      JSON.stringify({
        version: 1,
        files: [],
        styles: [],
        scripts: [],
        original: {
          version: 1,
          definitions: [],
          pages: [{ pageId: input.pageId, html: { lang: 'en' }, body: {}, header: true, footer: true }],
        },
      }),
    ]),
  )
  const saved = await db.asUser(s.editorA, client =>
    savePageDetails(client, { ...input, inMenu: !input.originalInMenu }, input.expectedRevision),
  )
  expect(saved.inMenu).toBe(!input.originalInMenu)
  const menu = await db.asUser(
    s.editorA,
    async client =>
      (
        await client.query(
          'SELECT v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
          [s.siteA],
        )
      ).rows[0]!.tree,
  )
  expect(pageInMenu(menu, input.pageId)).toBe(!input.originalInMenu)
})
