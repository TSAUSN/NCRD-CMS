import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { ChapterSetup } from '@cms/schema'
import { mapErrors } from '@cms/domain'
import { renderPage } from '@cms/renderer'
let db: TestDatabase, s: Scenario, site: { siteId: string; hostname: string }
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import { ensureEchelonSite, ensureEchelonChapterSetups, prepareEchelonDemoPhotos } from '../src/lib/echelon-site.ts'
import { echelonSiteSetup } from '@cms/seeds/echelon-site'
import { echelonChapterSetups } from '@cms/seeds/echelon-chapters'
import { createSiteFromSetupInTransaction } from '../src/lib/site-creation.ts'
import { readSitePreview } from '../src/lib/site-preview.ts'
import { listReleaseCandidates, planSiteRelease, executeSiteRelease } from '../src/lib/releases.ts'
beforeAll(async () => {
  db = await TestDatabase.create('echelon_site')
  s = await seedScenario(db)
  site = await db.asUser(s.superAdmin, c => ensureEchelonSite(c, randomUUID()))
})
afterAll(async () => {
  await db?.close()
})
const config = (patch: Record<string, unknown> = {}) =>
  ChapterSetup.parse({
    name: '[Chapter name]',
    destination: 'page',
    pageId: null,
    externalUrl: null,
    contact: { name: '[Name]', role: '[Role]', email: 'chapter@example.test' },
    sections: {},
    ...patch,
  })
async function save(slug: string, value = config(), id: string | null = null, revision = 0, user = s.superAdmin) {
  return db.asUser(
    user,
    async c =>
      (
        await c.query('SELECT * FROM app.save_chapter_setup($1,$2,$3,$4,$5)', [
          site.siteId,
          id,
          revision,
          slug,
          JSON.stringify(value),
        ])
      ).rows[0]!,
  )
}
async function directory(host = site.hostname) {
  return db.as(
    'public',
    async c => (await c.query('SELECT public_api.chapter_directory($1) AS entries', [host])).rows[0]!.entries,
  )
}
it('creates only a private national home/finder, preserves the existing sites and retries without rewriting drafts', async () => {
  const before = await db.asUser(s.superAdmin, c =>
    c.query('SELECT id,draft_version_id FROM pages WHERE site_id=$1 ORDER BY id', [site.siteId]),
  )
  expect(before.rows).toHaveLength(2)
  expect(await db.asUser(s.superAdmin, c => ensureEchelonSite(c, randomUUID()))).toEqual(site)
  const chapters = await db.asUser(s.superAdmin, c =>
    c.query('SELECT id,published_version_id FROM chapters WHERE site_id=$1', [site.siteId]),
  )
  expect(chapters.rows).toHaveLength(43)
  expect(chapters.rows.every(row => row.published_version_id === null)).toBe(true)
  expect(
    (
      await db.asUser(s.superAdmin, c =>
        c.query('SELECT id,draft_version_id FROM pages WHERE site_id=$1 ORDER BY id', [site.siteId]),
      )
    ).rows,
  ).toEqual(before.rows)
  expect(
    (await db.as('public', c => c.query('SELECT * FROM public_api.site_routes($1)', [site.hostname]))).rows,
  ).toEqual([])
  expect(
    (await db.asUser(s.superAdmin, c => c.query('SELECT reader_key FROM collections WHERE site_id=$1', [site.siteId])))
      .rows,
  ).toEqual([{ reader_key: 'people' }])
  const preview = await db.asUser(s.superAdmin, c => readSitePreview(c, site.siteId))
  for (const row of before.rows) {
    const manifest = await db.asUser(
      s.superAdmin,
      async c =>
        (await c.query('SELECT app.build_initial_preview_manifest($1) AS manifest', [row.draft_version_id])).rows[0]!
          .manifest,
    )
    const html = renderPage({ manifest, ...preview!, isStaging: true }).html
    expect(html).toContain('Echelon')
    expect(html).not.toContain('A shared purpose. A stronger community.')
    if (html.includes('Contact Echelon')) expect(html).not.toContain('Jordan Lee')
  }
  expect(
    (await db.asUser(s.superAdmin, c => c.query('SELECT id FROM sites WHERE id=ANY($1::uuid[])', [[s.siteA, s.siteB]])))
      .rows,
  ).toHaveLength(2)
})
it('prepares only untouched offline demo photos without weakening publication or rewriting authored drafts', async () => {
  const candidates = await listReleaseCandidates(s.superAdmin, site.siteId)
  await expect(planSiteRelease(s.superAdmin, randomUUID(), site.siteId, candidates)).rejects.toThrow(
    'Choose Echelon photos from Media',
  )
  await db.asUser(s.superAdmin, async c => {
    const read = async (id: string) =>
      (
        await c.query(
          'SELECT p.id,p.revision,p.draft_version_id,p.published_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [id],
        )
      ).rows[0]!
    const id = (await c.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [site.siteId])).rows[0]!.id,
      before = await read(id)
    expect(await prepareEchelonDemoPhotos(c, site.siteId)).toBe(1)
    const after = await read(id),
      expected = structuredClone(before.content)
    let pictures = 0
    for (const section of expected)
      for (const [key, value] of Object.entries(section.values))
        if (
          value &&
          typeof value === 'object' &&
          String((value as { src?: string }).src ?? '').startsWith('/cms-samples/')
        ) {
          section.values[key] = ''
          pictures++
        }
    expect(pictures).toBeGreaterThan(0)
    expect(after.content).toEqual(expected)
    expect(after.meta).toEqual(before.meta)
    expect(after.published_version_id).toBeNull()
    expect(await prepareEchelonDemoPhotos(c, site.siteId)).toBe(0)
    expect(await read(id)).toEqual(after)
    const other = await createSiteFromSetupInTransaction(
      c,
      randomUUID(),
      { ...echelonSiteSetup(), slug: 'authored-demo' },
      'authored-demo.staging.localhost',
    )
    await c.query('SELECT app.enable_chapters($1)', [other.siteId])
    const otherId = (await c.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [other.siteId])).rows[0]!.id,
      editing = await read(otherId)
    editing.content[0].values.heading = '[Authored heading]'
    await c.query("SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint','Authored draft')", [
      otherId,
      editing.revision,
      JSON.stringify(editing.content),
      JSON.stringify(editing.meta),
    ])
    const authored = await read(otherId)
    expect(await prepareEchelonDemoPhotos(c, other.siteId)).toBe(0)
    expect(await read(otherId)).toEqual(authored)
  })
})
it('keeps directory drafts and private contacts hidden, and adds internal destinations only when their pages go live', async () => {
  const page = (
    await db.asUser(s.superAdmin, c => c.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [site.siteId]))
  ).rows[0]!.id
  const draft = await save('chapter-one', config({ pageId: page }))
  expect(await directory()).toEqual([])
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT app.publish_chapter_setup($1,$2)', [draft.chapter_id, draft.revision]),
  )
  expect(await directory()).toEqual([])
  const release = await planSiteRelease(
    s.superAdmin,
    randomUUID(),
    site.siteId,
    await listReleaseCandidates(s.superAdmin, site.siteId),
  )
  expect(
    release.preview_report.flatMap(item => item.report.blocking).every(finding => finding.rule === 'sample_content'),
  ).toBe(true)
  expect(release.preview_report.flatMap(item => item.report.blocking).length).toBeGreaterThan(0)
  await executeSiteRelease(s.superAdmin, release.id, 'Confirmed: Publish with sample content.')
  expect(await directory()).toEqual([{ name: '[Chapter name]', slug: 'chapter-one', path: '/', externalUrl: null }])
  expect(JSON.stringify(await directory())).not.toContain('chapter@example.test')
  const external = await save(
    'external-chapter',
    config({ name: '[External chapter]', destination: 'external', externalUrl: 'https://example.test/chapter' }),
  )
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT app.publish_chapter_setup($1,$2)', [external.chapter_id, external.revision]),
  )
  expect(await directory()).toHaveLength(2)
  expect(await directory('site-a.staging.example.test')).toEqual([])
  expect(await directory('unknown.example.test')).toEqual([])
})
it('checks revisions, settings shape, role permissions, foreign pages and immutable direct access', async () => {
  const row = await save('revision-check')
  await expectSqlState(save('revision-check', config(), row.chapter_id, 0), 'CMS01')
  await expectSqlState(save('denied', config(), null, 0, s.contributorA), 'CMS02')
  await expectSqlState(
    db.asUser(s.editorB, c => c.query('SELECT app.publish_chapter_setup($1,$2)', [row.chapter_id, row.revision])),
    'CMS02',
  )
  await expectSqlState(save('foreign-page', config({ pageId: s.pageA })), 'CMS04')
  await expectSqlState(
    db.asUser(s.superAdmin, c =>
      c.query('SELECT * FROM app.save_chapter_setup($1,NULL,0,$2,$3)', [
        site.siteId,
        'bad',
        JSON.stringify({ ...config(), unexpected: true }),
      ]),
    ),
    'CMS04',
  )
  await expectSqlState(
    db.asUser(s.superAdmin, c => c.query('UPDATE chapter_versions SET config=$1', [JSON.stringify(config())])),
    '42501',
  )
  await expectSqlState(
    db.as('public', c => c.query('SELECT * FROM public.chapter_versions')),
    '42501',
  )
})
it('stores only bounded contact messages for a published form, deduplicates and denies foreign reads', async () => {
  const message = {
      first_name: '[Name]',
      last_name: '[Name]',
      email: 'visitor@example.test',
      phone: '123',
      comments: '[Message]',
    },
    key = 'a'.repeat(64)
  for (let n = 0; n < 2; n++)
    await db.as('public', c =>
      c.query('SELECT public_api.submit_contact($1,$2,$3,$4)', [site.hostname, '/', JSON.stringify(message), key]),
    )
  expect(
    (
      await db.asUser(s.superAdmin, c =>
        c.query('SELECT message FROM contact_messages WHERE site_id=$1', [site.siteId]),
      )
    ).rows,
  ).toEqual([{ message }])
  expect((await db.asUser(s.editorB, c => c.query('SELECT id FROM contact_messages'))).rows).toEqual([])
  await expectSqlState(
    db.as('public', c => c.query('SELECT * FROM public.contact_messages')),
    '42501',
  )
  await expectSqlState(
    db.as('public', c =>
      c.query('SELECT public_api.submit_contact($1,$2,$3,$4)', [
        site.hostname,
        '/chapters',
        JSON.stringify(message),
        'b'.repeat(64),
      ]),
    ),
    'CMS03',
  )
  await expectSqlState(
    db.as('public', c =>
      c.query('SELECT public_api.submit_contact($1,$2,$3,$4)', [
        site.hostname,
        '/',
        JSON.stringify({ ...message, email: 'invalid' }),
        'c'.repeat(64),
      ]),
    ),
    'CMS04',
  )
  for (let n = 1; n < 50; n++)
    await db.as('public', c =>
      c.query('SELECT public_api.submit_contact($1,$2,$3,$4)', [
        site.hostname,
        '/',
        JSON.stringify(message),
        String(n).padStart(64, '0'),
      ]),
    )
  await expectSqlState(
    db.as('public', c =>
      c.query('SELECT public_api.submit_contact($1,$2,$3,$4)', [
        site.hostname,
        '/',
        JSON.stringify(message),
        'f'.repeat(64),
      ]),
    ),
    'CMS04',
  )
  await db.as('public', c =>
    c.query('SELECT public_api.submit_contact($1,$2,$3,$4)', [site.hostname, '/', JSON.stringify(message), key]),
  )
})
it('reapplies the migration without altering chapter heads or command authority', async () => {
  const sql = await readFile(
    new URL('../../../packages/schema/migrations/0145_chapter_setup_and_contact.sql', import.meta.url),
    'utf8',
  )
  const before = await db.as('owner', c => c.query('SELECT * FROM chapters ORDER BY id'))
  await db.as('owner', async c => {
    const authority = () =>
      c.query(
        "SELECT proowner::regrole::text,proacl::text FROM pg_proc WHERE oid='app.save_chapter_setup(uuid,uuid,bigint,text,jsonb)'::regprocedure",
      )
    const original = (await authority()).rows
    await c.query(sql)
    await c.query(sql)
    expect((await authority()).rows).toEqual(original)
  })
  expect((await db.as('owner', c => c.query('SELECT * FROM chapters ORDER BY id'))).rows).toEqual(before.rows)
})
it('upgrades only the untouched private Boston sample to the approved CMS destination', async () => {
  await db.asUser(s.superAdmin, async c => {
    const local = await createSiteFromSetupInTransaction(
      c,
      randomUUID(),
      { ...echelonSiteSetup(), slug: 'chapter-upgrade' },
      'chapter-upgrade.staging.localhost',
    )
    const next = echelonChapterSetups().find(row => row.slug === 'boston')!.config,
      old = { ...next, destination: 'external', externalUrl: 'https://example.test/chapters/boston' }
    const saved = (
      await c.query('SELECT * FROM app.save_chapter_setup($1,NULL,0,$2,$3)', [
        local.siteId,
        'boston',
        JSON.stringify(old),
      ])
    ).rows[0]!
    await ensureEchelonChapterSetups(c, local.siteId)
    const read = async () =>
      (
        await c.query(
          'SELECT c.revision,c.draft_version_id,v.config FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.id=$1',
          [saved.chapter_id],
        )
      ).rows[0]!
    const upgraded = await read()
    expect(upgraded.revision).toBe('2')
    expect(upgraded.config).toEqual(next)
    await ensureEchelonChapterSetups(c, local.siteId)
    expect(await read()).toEqual(upgraded)
    await c.query('SELECT * FROM app.save_chapter_setup($1,$2,$3,$4,$5)', [
      local.siteId,
      saved.chapter_id,
      upgraded.revision,
      'boston',
      JSON.stringify({ ...old, contact: { ...old.contact, role: '[Updated role]' } }),
    ])
    const edited = await read()
    await ensureEchelonChapterSetups(c, local.siteId)
    expect(await read()).toEqual(edited)
  })
})
