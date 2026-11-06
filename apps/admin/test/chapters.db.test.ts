import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, it, expect, vi } from 'vitest'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { CORE_LIBRARY, coreUpsertArguments } from '@cms/seeds/core-library'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { mapErrors } from '@cms/domain'
let db: TestDatabase, s: Scenario, site: { siteId: string; hostname: string }
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import { ensureEchelonSite, prepareEchelonDemoPhotos } from '../src/lib/echelon-site.ts'
import { chapterRows, saveChapterInTransaction, ensureChapterDemoPages } from '../src/lib/chapters.ts'
import { listReleaseCandidates, planSiteRelease, executeSiteRelease } from '../src/lib/releases.ts'
import { getReleaseRecoveryReview, prepareReleaseRecovery } from '../src/lib/release-recovery.ts'
beforeAll(async () => {
  db = await TestDatabase.create('chapter_pages')
  s = await seedScenario(db)
  site = await db.asUser(s.superAdmin, c => ensureEchelonSite(c, randomUUID()))
  await db.asUser(s.superAdmin, c => prepareEchelonDemoPhotos(c, site.siteId))
})
afterAll(async () => {
  await db?.close()
})
it('creates nested chapter pages and preserves all existing drafts on a retry', async () => {
  await db.asUser(s.superAdmin, c => ensureChapterDemoPages(c, site.siteId))
  const before = await db.asUser(s.superAdmin, c =>
    c.query('SELECT id,draft_version_id FROM pages WHERE site_id=$1 ORDER BY id', [site.siteId]),
  )
  expect(before.rows).toHaveLength(28)
  await db.asUser(s.superAdmin, c => ensureChapterDemoPages(c, site.siteId))
  expect(
    (
      await db.asUser(s.superAdmin, c =>
        c.query('SELECT id,draft_version_id FROM pages WHERE site_id=$1 ORDER BY id', [site.siteId]),
      )
    ).rows,
  ).toEqual(before.rows)
  const rows = await db.asUser(s.superAdmin, c => chapterRows(c, site.siteId))
  expect(rows.find(row => row.slug === 'detroit')!.config.pageId).toBeNull()
  expect(rows.find(row => row.slug === 'maryland')!.pagePublished).toBe(false)
  const texas = rows.find(row => row.slug === 'north-texas')!
  const page = (
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT p.slug,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1', [
        texas.config.pageId,
      ]),
    )
  ).rows[0]!
  expect(page.slug).toBe('chapters/north-texas')
  expect(page.content.find((section: { label: string }) => section.label === 'Board').values.cards.items).toHaveLength(
    16,
  )
})
it('publishes only the immutable setup pinned to a reviewed page, never a newer setup draft', async () => {
  const rows = await db.asUser(s.superAdmin, c => chapterRows(c, site.siteId)),
    peoria = rows.find(row => row.slug === 'peoria')!
  const page = (
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT draft_version_id FROM pages WHERE id=$1', [peoria.config.pageId]),
    )
  ).rows[0]!
  const pin = (
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT chapter_version_id FROM chapter_page_versions WHERE page_version_id=$1', [page.draft_version_id]),
    )
  ).rows[0]!
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT * FROM app.save_chapter_setup($1,$2,$3,$4,$5)', [
      site.siteId,
      peoria.id,
      peoria.revision,
      peoria.slug,
      JSON.stringify({ ...peoria.config, boardDisplay: 'first-eight' }),
    ]),
  )
  const candidates = await listReleaseCandidates(s.superAdmin, site.siteId)
  const selected = candidates.filter(
    item =>
      item.type !== 'page' ||
      item.id === peoria.config.pageId ||
      item.label === 'Home' ||
      item.label === 'Find a chapter',
  )
  const plan = await planSiteRelease(s.superAdmin, randomUUID(), site.siteId, selected)
  await executeSiteRelease(s.superAdmin, plan.id, 'Confirmed: Publish with sample content.')
  const result = (
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT draft_version_id,published_version_id FROM chapters WHERE id=$1', [peoria.id]),
    )
  ).rows[0]!
  expect(result.published_version_id).toBe(pin.chapter_version_id)
  expect(result.draft_version_id).not.toBe(pin.chapter_version_id)
  const directory = (
    await db.as('public', c => c.query('SELECT public_api.chapter_directory($1) AS entries', [site.hostname]))
  ).rows[0]!.entries
  expect(directory).toEqual([{ name: peoria.config.name, slug: 'peoria', path: '/chapters/peoria', externalUrl: null }])
})
it('denies foreign users, null/stale revisions and foreign page reassignment without losing content', async () => {
  const row = (await db.asUser(s.superAdmin, c => chapterRows(c, site.siteId))).find(row => row.slug === 'boston')!
  await expect(
    db.asUser(s.editorB, c => saveChapterInTransaction(c, site.siteId, row.id, row.revision, row.slug, row.config)),
  ).rejects.toThrow()
  await expect(
    db.asUser(s.superAdmin, c => saveChapterInTransaction(c, site.siteId, row.id, '0', row.slug, row.config)),
  ).rejects.toThrow('changed')
  await expect(
    db.asUser(s.superAdmin, c =>
      saveChapterInTransaction(c, site.siteId, row.id, row.revision, row.slug, { ...row.config, pageId: s.pageA }),
    ),
  ).rejects.toThrow('assigned')
  await expectSqlState(
    db.asUser(s.superAdmin, c =>
      c.query('SELECT * FROM app.save_chapter_setup($1,$2,NULL,$3,$4)', [
        site.siteId,
        row.id,
        row.slug,
        JSON.stringify(row.config),
      ]),
    ),
    'CMS01',
  )
  await expectSqlState(
    db.asUser(s.superAdmin, c => c.query('UPDATE chapter_page_versions SET chapter_version_id=$1', [randomUUID()])),
    '42501',
  )
  await expectSqlState(
    db.as('public', c => c.query('SELECT * FROM public.chapter_page_versions')),
    '42501',
  )
})
it('renames nested chapter identities through the existing revision command and rejects malformed paths', async () => {
  const row = (await db.asUser(s.superAdmin, c => chapterRows(c, site.siteId))).find(row => row.slug === 'boston')!
  const head = (
    await db.asUser(s.superAdmin, c => c.query('SELECT revision FROM pages WHERE id=$1', [row.config.pageId]))
  ).rows[0]!
  const renamed = (
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT * FROM app.rename_page($1,$2,$3,$4)', [
        row.config.pageId,
        head.revision,
        'Boston chapter page',
        'chapters/boston',
      ]),
    )
  ).rows[0]!
  for (const path of ['../bad', 'chapters/../bad', 'chapters//boston', '/chapters/boston', 'chapters/boston/'])
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query('SELECT * FROM app.rename_page($1,$2,$3,$4)', [
          row.config.pageId,
          renamed.revision,
          'Boston chapter page',
          path,
        ]),
      ),
      'CMS04',
    )
  await expectSqlState(
    db.asUser(s.superAdmin, c =>
      c.query('SELECT * FROM app.rename_page($1,NULL,$2,$3)', [
        row.config.pageId,
        'Boston chapter page',
        'chapters/boston',
      ]),
    ),
    'CMS01',
  )
})
it('reapplies the migration idempotently, preserving page/config pins and command authority', async () => {
  const sources = await Promise.all(
    ['0147_chapter_page_pins.sql', '0148_chapter_release_recovery.sql'].map(file =>
      readFile(new URL('../../../packages/schema/migrations/' + file, import.meta.url), 'utf8'),
    ),
  )
  const before = await db.as('owner', c => c.query('SELECT * FROM chapter_page_versions ORDER BY page_version_id'))
  await db.as('owner', async c => {
    for (const sql of sources) {
      const authority = () =>
        c.query(
          "SELECT oid::regprocedure::text,proowner::regrole::text,proacl::text FROM pg_proc WHERE oid=ANY(ARRAY['app.release_fingerprint(uuid)'::regprocedure::oid,'app.pin_release_recovery_items(uuid,uuid,jsonb)'::regprocedure::oid,'app.save_chapter_setup(uuid,uuid,bigint,text,jsonb)'::regprocedure::oid]) ORDER BY oid",
        )
      const original = (await authority()).rows
      await c.query(sql)
      await c.query(sql)
      expect((await authority()).rows).toEqual(original)
    }
  })
  expect(
    (await db.as('owner', c => c.query('SELECT * FROM chapter_page_versions ORDER BY page_version_id'))).rows,
  ).toEqual(before.rows)
})
it('reviews external directory links through normal releases, preserves later drafts and recovers the previous link', async () => {
  const row = (await db.asUser(s.superAdmin, c => chapterRows(c, site.siteId))).find(row => row.slug === 'detroit')!
  const release = async () => {
    const items = (await listReleaseCandidates(s.superAdmin, site.siteId)).filter(
      item => item.type === 'chapter_setup' && item.id === row.id,
    )
    expect(items).toHaveLength(1)
    const plan = await planSiteRelease(s.superAdmin, randomUUID(), site.siteId, items)
    await executeSiteRelease(s.superAdmin, plan.id, 'Confirmed: Publish with sample content.')
    return plan
  }
  const first = await release()
  const head = (await db.asUser(s.superAdmin, c => chapterRows(c, site.siteId))).find(value => value.id === row.id)!
  await db.asUser(s.superAdmin, c =>
    saveChapterInTransaction(c, site.siteId, head.id, head.revision, head.slug, {
      ...head.config,
      externalUrl: 'https://example.test/updated-chapter',
    }),
  )
  const second = await release()
  const review = await getReleaseRecoveryReview(s.superAdmin, second.id)
  expect(review.available).toBe(true)
  if (!review.available) throw new Error(review.reason)
  const recovery = await prepareReleaseRecovery(s.superAdmin, randomUUID(), second.id, review.expectedState)
  expect(recovery.items).toHaveLength(1)
  expect(recovery.items[0]).toMatchObject({ type: 'chapter_setup', requiresAdmin: true, action: 'publish' })
  expect(recovery.preservedDrafts).toHaveLength(1)
  const plan = await planSiteRelease(s.superAdmin, randomUUID(), site.siteId, recovery.items)
  await executeSiteRelease(s.superAdmin, plan.id, 'Confirmed: Publish with sample content.')
  const directory = async () =>
    (await db.as('public', c => c.query('SELECT public_api.chapter_directory($1) AS entries', [site.hostname])))
      .rows[0]!.entries
  expect((await directory()).find((entry: { name: string }) => entry.name === row.config.name)).toMatchObject({
    externalUrl: row.config.externalUrl,
  })
  const unpublished = await getReleaseRecoveryReview(s.superAdmin, first.id)
  if (!unpublished.available) throw new Error(unpublished.reason)
  const remove = await prepareReleaseRecovery(s.superAdmin, randomUUID(), first.id, unpublished.expectedState)
  expect(remove.items[0]!.action).toBe('unpublish')
  const removing = await planSiteRelease(s.superAdmin, randomUUID(), site.siteId, remove.items)
  await executeSiteRelease(s.superAdmin, removing.id, 'Confirmed: Publish with sample content.')
  expect((await directory()).some((entry: { name: string }) => entry.name === row.config.name)).toBe(false)
})
it('upgrades only untouched generated link sections, preserving their values and every authored draft', async () => {
  await db.asUser(s.superAdmin, async c => {
    const entry = CORE_LIBRARY.find(value => value.definition.slug === 'core-on-page-navigation')!
    if (entry.definition.kind !== 'legacy') throw new Error('Expected the shared legacy link section.')
    const old = {
      ...entry,
      definition: {
        ...entry.definition,
        sourceHtml: entry.definition.sourceHtml.replace('<h2>{{heading}}</h2>', ''),
        slots: entry.definition.slots.filter(slot => slot.id !== 'heading'),
      },
    }
    await c.query(
      'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
      coreUpsertArguments(old),
    )
    const source = (await chapterRows(c, site.siteId)).find(row => row.slug === 'peoria')!.config
    const untouched = await saveChapterInTransaction(c, site.siteId, null, '0', 'upgrade-example', {
      ...source,
      name: '[Upgrade chapter]',
      pageId: null,
    })
    const edited = await saveChapterInTransaction(c, site.siteId, null, '0', 'edited-example', {
      ...source,
      name: '[Edited chapter]',
      pageId: null,
    })
    const read = async (id: string) =>
      (
        await c.query(
          'SELECT p.revision,p.draft_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [id],
        )
      ).rows[0]!
    const original = await read(untouched.config.pageId!),
      editing = await read(edited.config.pageId!)
    editing.content.find((section: { label: string }) => section.label === 'About this chapter').values.body =
      '<p>[Authored chapter paragraph]</p>'
    await c.query("SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint','Authored chapter content')", [
      edited.config.pageId,
      editing.revision,
      JSON.stringify(editing.content),
      JSON.stringify(editing.meta),
    ])
    const preserved = await read(edited.config.pageId!)
    await installCoreLibrary(c)
    await ensureChapterDemoPages(c, site.siteId)
    const upgraded = await read(untouched.config.pageId!)
    expect(upgraded.revision).toBe('2')
    expect(upgraded.content.map((section: { values: unknown }) => section.values)).toEqual(
      original.content.map((section: { values: unknown }) => section.values),
    )
    expect(
      upgraded.content.find((section: { label: string }) => section.label === 'Social links').section_def_version,
    ).toBeGreaterThan(
      original.content.find((section: { label: string }) => section.label === 'Social links').section_def_version,
    )
    expect(await read(edited.config.pageId!)).toEqual(preserved)
    await ensureChapterDemoPages(c, site.siteId)
    expect(await read(untouched.config.pageId!)).toEqual(upgraded)
  })
})
it('saves assigned chapter setup through the division service without whole-site update privileges', async () => {
  const row = (await db.asUser(s.superAdmin, c => chapterRows(c, site.siteId))).find(row => row.slug === 'maryland')!
  await db.asUser(s.superAdmin, async c => {
    const division = (
      await c.query("SELECT app.create_chapter_division($1,'Example division (sample)') AS id", [site.siteId])
    ).rows[0]!.id
    await c.query('SELECT app.set_chapter_division_member($1,$2,true)', [division, s.editorB])
    await c.query('SELECT app.assign_chapter_division($1,$2)', [row.id, division])
  })
  const content = async () =>
    (
      await db.asUser(s.superAdmin, c =>
        c.query('SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1', [
          row.config.pageId,
        ]),
      )
    ).rows[0]!.content
  const before = await content()
  const saved = await db.asUser(s.editorB, c =>
    saveChapterInTransaction(c, site.siteId, row.id, row.revision, row.slug, {
      ...row.config,
      sections: { ...row.config.sections, events: false },
    }),
  )
  expect(saved.config.sections.events).toBe(false)
  expect(saved.config.pageId).toBe(row.config.pageId)
  expect((await content()).map((section: { values: unknown }) => section.values)).toEqual(
    before.map((section: { values: unknown }) => section.values),
  )
  expect(
    (await db.asUser(s.editorB, c => c.query('SELECT app.has_site_access($1) AS access', [site.siteId]))).rows[0]!
      .access,
  ).toBe(false)
  await expect(
    db.asUser(s.contributorA, c =>
      saveChapterInTransaction(c, site.siteId, saved.id, saved.revision, saved.slug, saved.config),
    ),
  ).rejects.toThrow()
})

it('builds a complete draft for a new division-owned chapter without granting site access', async () => {
  const division = await db.asUser(s.superAdmin, async c => {
    const id = (
      await c.query("SELECT app.create_chapter_division($1,'Another division (sample)') AS id", [site.siteId])
    ).rows[0]!.id
    await c.query('SELECT app.set_chapter_division_member($1,$2,true)', [id, s.editorB])
    return id
  })
  const source = (await db.asUser(s.superAdmin, c => chapterRows(c, site.siteId))).find(row => row.slug === 'maryland')!
  const row = await db.asUser(s.editorB, c =>
    saveChapterInTransaction(
      c,
      site.siteId,
      null,
      '0',
      'new-division-chapter',
      { ...source.config, pageId: null, name: '[New chapter] (sample)' },
      4,
      division,
    ),
  )
  expect(row.divisionId).toBe(division)
  expect(row.pagePublished).toBe(false)
  const head = (
    await db.asUser(s.editorB, c =>
      c.query('SELECT p.slug,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1', [
        row.config.pageId,
      ]),
    )
  ).rows[0]!
  expect(head.slug).toBe('chapters/new-division-chapter')
  expect(head.content.length).toBeGreaterThan(4)
  expect(
    head.content.filter((section: { values: Record<string, unknown> }) =>
      ['what', 'join'].includes(String(section.values.__cms_chapter_part)),
    ),
  ).toHaveLength(2)
  expect(
    (await db.asUser(s.editorB, c => c.query('SELECT app.has_site_access($1) AS access', [site.siteId]))).rows[0]!
      .access,
  ).toBe(false)
  await expectSqlState(
    db.asUser(s.editorB, c => c.query("SELECT app.create_page($1,'not-a-chapter','[Page]')", [site.siteId])),
    'CMS02',
  )
  const before = (await db.asUser(s.editorB, c => c.query('SELECT count(*) FROM pages'))).rows[0]!.count
  await expect(
    db.asUser(s.editorB, c =>
      saveChapterInTransaction(c, site.siteId, null, '1', 'stale-new', { ...source.config, pageId: null }, 4, division),
    ),
  ).rejects.toThrow('changed')
  expect((await db.asUser(s.editorB, c => c.query('SELECT count(*) FROM pages'))).rows[0]!.count).toBe(before)
})

it('lets the assigned division replace an external destination with its own new CMS page', async () => {
  const division = (
    await db.asUser(s.superAdmin, c =>
      c.query("SELECT app.create_chapter_division($1,'Another division (sample)') AS id", [site.siteId]),
    )
  ).rows[0]!.id
  const source = (await db.asUser(s.superAdmin, c => chapterRows(c, site.siteId))).find(row => row.slug === 'detroit')!
  const external = await db.asUser(s.editorB, c =>
    saveChapterInTransaction(
      c,
      site.siteId,
      null,
      '0',
      'external-conversion',
      { ...source.config, name: '[External chapter] (sample)', pageId: null },
      4,
      division,
    ),
  )
  expect(external.config.pageId).toBeNull()
  const attached = await db.asUser(s.editorB, c =>
    saveChapterInTransaction(c, site.siteId, external.id, external.revision, external.slug, {
      ...external.config,
      destination: 'page',
    }),
  )
  expect(attached.config.pageId).toBeTypeOf('string')
  expect(attached.pagePublished).toBe(false)
  const head = (
    await db.asUser(s.editorB, c =>
      c.query('SELECT p.slug,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1', [
        attached.config.pageId,
      ]),
    )
  ).rows[0]!
  expect(head.slug).toBe('chapters/external-conversion')
  expect(head.content.length).toBeGreaterThan(4)
  expect(
    (await db.asUser(s.editorB, c => c.query('SELECT app.has_site_access($1) AS access', [site.siteId]))).rows[0]!
      .access,
  ).toBe(false)
})
