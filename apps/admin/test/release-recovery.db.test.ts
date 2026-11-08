import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { seedScenario, heroContent, type Scenario } from '@cms/schema/fixtures'
import { mapErrors } from '@cms/domain'
import { SiteSetup } from '@cms/schema'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { starterSiteSetup } from '@cms/seeds/archetypes'
import { compileSection } from '@cms/renderer'
let db: TestDatabase, s: Scenario
vi.mock('server-only', () => ({}))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import {
  executeSiteRelease,
  listReleaseCandidates,
  planSiteRelease,
  previewSiteReleasePage,
} from '../src/lib/releases.ts'
import {
  getPreparedReleaseRecovery,
  getReleaseRecoveryReview,
  prepareReleaseRecovery,
} from '../src/lib/release-recovery.ts'
import { createSiteFromSetupInTransaction } from '../src/lib/site-creation.ts'

beforeAll(async () => {
  db = await TestDatabase.create('release_recovery')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, client =>
    client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      s.pageA,
      heroContent(s.heroDefId, 'Site home'),
      '{}',
    ]),
  )
  await releasePage(s.pageA)
})
afterAll(async () => {
  await db?.close()
})
async function page(heading = 'Before release', site = s.siteA) {
  return db.asUser(s.superAdmin, async client => {
    const id = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [
        site,
        `recovery-${randomUUID().slice(0, 8)}`,
        'Recovery page',
      ])
    ).rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [id, heroContent(s.heroDefId, heading), '{}'])
    return id
  })
}
async function edit(id: string, heading: string) {
  return db.asUser(s.superAdmin, async client => {
    const head = (await client.query('SELECT revision FROM pages WHERE id=$1', [id])).rows[0]!
    return (
      await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        id,
        head.revision,
        heroContent(s.heroDefId, heading),
        '{}',
      ])
    ).rows[0]!
  })
}
async function releasePage(id: string, site = s.siteA) {
  const items = (await listReleaseCandidates(s.superAdmin, site)).filter(item => item.type === 'page' && item.id === id)
  const receipt = await planSiteRelease(s.superAdmin, randomUUID(), site, items)
  await executeSiteRelease(s.superAdmin, receipt.id, '')
  return receipt
}
async function review(id: string, user = s.superAdmin) {
  const result = await getReleaseRecoveryReview(user, id)
  if (!result.available) throw new Error(result.reason)
  return result
}
async function prepare(id: string, user = s.superAdmin) {
  const value = await review(id, user)
  return prepareReleaseRecovery(user, randomUUID(), id, value.expectedState)
}
async function live(site = s.siteA) {
  return db.asUser(s.superAdmin, async client => ({
    routes: (
      await client.query(
        'SELECT page_id,path,page_version_id,render_manifest FROM published_routes WHERE site_id=$1 ORDER BY path',
        [site],
      )
    ).rows,
    shell: (await client.query('SELECT payload FROM published_site_shells WHERE site_id=$1', [site])).rows,
    private: (await client.query('SELECT initial_release_required FROM sites WHERE id=$1', [site])).rows[0]!
      .initial_release_required,
  }))
}
async function version(id: string) {
  return db.asUser(
    s.superAdmin,
    async client => (await client.query('SELECT * FROM page_versions WHERE id=$1', [id])).rows[0]!,
  )
}
async function privateSite() {
  const slug = `recover-${randomUUID().slice(0, 8)}`
  const setup = SiteSetup.parse({ ...starterSiteSetup('resource'), name: 'Recoverable private site', slug })
  const created = await db.asUser(s.superAdmin, async client => {
    await installCoreLibrary(client)
    const created = await createSiteFromSetupInTransaction(client, randomUUID(), setup, `${slug}.staging.example.test`)
    // Recovery fixtures represent reviewed real content. Sample-consent behavior
    // has its own release and scheduling tests; do not bypass it here.
    const pages = (
      await client.query(
        'SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1',
        [created.siteId],
      )
    ).rows
    for (const page of pages) {
      const content = page.content.map((section: { values: Record<string, unknown> }) => {
        const values = { ...section.values }
        delete values.__cms_sample_fields
        return { ...section, values }
      })
      await client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
        page.id,
        page.revision,
        JSON.stringify(content),
        JSON.stringify(page.meta),
      ])
    }
    return created
  })
  const receipt = await planSiteRelease(
    s.superAdmin,
    randomUUID(),
    created.siteId,
    await listReleaseCandidates(s.superAdmin, created.siteId),
  )
  await executeSiteRelease(s.superAdmin, receipt.id, '')
  return { site: created.siteId, receipt, host: `${slug}.staging.example.test` }
}

describe('coordinated release recovery', () => {
  it('unpublishes a newly published page, restores auto-navigation, and preserves a later draft with idempotent preparation', async () => {
    const id = await page(),
      receipt = await releasePage(id)
    const later = await edit(id, 'Later private work')
    const before = await live(),
      checked = await review(receipt.id, s.editorA),
      request = randomUUID()
    expect(checked.items.map(item => item.type).sort()).toEqual(['navigation', 'page'])
    expect(checked.items.find(item => item.type === 'page')).toMatchObject({ wasUnpublished: true, laterDraft: true })
    const recovery = await prepareReleaseRecovery(s.editorA, request, receipt.id, checked.expectedState)
    expect(await prepareReleaseRecovery(s.editorA, request, receipt.id, checked.expectedState)).toEqual(recovery)
    expect(await getPreparedReleaseRecovery(s.editorA, receipt.id)).toMatchObject(recovery)
    await expect(prepareReleaseRecovery(s.editorA, request, receipt.id, {})).rejects.toMatchObject({
      kind: 'invalid_state',
    })
    expect(await live()).toEqual(before)
    const checkpoint = recovery.preservedDrafts.find(item => item.type === 'page')!
    expect(await version(checkpoint.versionId!)).toMatchObject({
      kind: 'checkpoint',
      content: JSON.parse(heroContent(s.heroDefId, 'Later private work')),
    })
    expect(await version(later.version_id)).toBeDefined()
    expect(recovery.items.find(item => item.type === 'page')?.action).toBe('unpublish')
    const planned = await planSiteRelease(s.editorA, randomUUID(), s.siteA, recovery.items)
    expect((await getPreparedReleaseRecovery(s.editorA, receipt.id))?.plannedReleaseId).toBe(planned.id)
    expect(await live()).toEqual(before)
    await executeSiteRelease(s.editorA, planned.id, '')
    await executeSiteRelease(s.editorA, planned.id, '')
    expect(await getPreparedReleaseRecovery(s.editorA, receipt.id)).toBeNull()
    expect((await live()).routes.some(row => row.page_id === id)).toBe(false)
    expect(
      (
        await db.asUser(s.editorA, client =>
          client.query('SELECT archived_at,draft_version_id FROM pages WHERE id=$1', [id]),
        )
      ).rows[0],
    ).toMatchObject({ archived_at: null, draft_version_id: checkpoint.versionId })
  })

  it('restores a previous publication through a new draft and normal combined preview, without replacing unrelated pages', async () => {
    const id = await page('Original published heading')
    await releasePage(id)
    await edit(id, 'Release changed heading')
    const receipt = await releasePage(id)
    const unrelated = await page('Unrelated public work')
    await releasePage(unrelated)
    const before = await live()
    await edit(id, 'Latest private heading')
    const recovery = await prepare(receipt.id)
    expect(recovery.items).toHaveLength(1)
    const recovered = await version(recovery.items[0]!.versionId!)
    expect(recovered.kind).toBe('restore')
    expect(recovered.content[0].values.heading).toBe('Original published heading')
    const planned = await planSiteRelease(s.superAdmin, randomUUID(), s.siteA, recovery.items)
    const html = await previewSiteReleasePage(s.superAdmin, planned.id, id)
    expect(html).toContain('Original published heading')
    expect(html).not.toContain('Latest private heading')
    expect(await live()).toEqual(before)
    await executeSiteRelease(s.superAdmin, planned.id, '')
    expect((await live()).routes.find(row => row.page_id === unrelated)).toEqual(
      before.routes.find(row => row.page_id === unrelated),
    )
    expect((await live()).routes.find(row => row.page_id === id)?.page_version_id).toBe(recovered.id)
  })

  it('refuses stale review and stale prepared heads without mutating live state', async () => {
    const id = await page(),
      receipt = await releasePage(id),
      checked = await review(receipt.id)
    await edit(id, 'Changed after recovery review')
    const before = await live()
    await expect(
      prepareReleaseRecovery(s.superAdmin, randomUUID(), receipt.id, checked.expectedState),
    ).rejects.toMatchObject({ kind: 'stale_revision' })
    const recovery = await prepare(receipt.id)
    const plan = await planSiteRelease(s.superAdmin, randomUUID(), s.siteA, recovery.items)
    await edit(id, 'Changed after preparation')
    await expect(executeSiteRelease(s.superAdmin, plan.id, '')).rejects.toMatchObject({ kind: 'stale_revision' })
    await expect(planSiteRelease(s.superAdmin, randomUUID(), s.siteA, recovery.items)).rejects.toMatchObject({
      kind: 'stale_revision',
    })
    expect(await live()).toEqual(before)
  })

  it('rejects forged actions and expanded scope, and cannot commit a partial unpublish command', async () => {
    const id = await page(),
      receipt = await releasePage(id),
      recovery = await prepare(receipt.id),
      before = await live()
    for (const forged of [
      recovery.items.slice(0, 1),
      recovery.items.map(item => ({ ...item, action: 'publish' as const })),
      recovery.items.map(item => ({ ...item, versionId: randomUUID() })),
      [...recovery.items, { ...recovery.items[0]!, id: randomUUID(), key: 'forged' }],
    ]) {
      await expect(planSiteRelease(s.superAdmin, randomUUID(), s.siteA, forged)).rejects.toMatchObject({
        kind: 'invalid_state',
      })
    }
    await expectSqlState(
      db.asUser(s.superAdmin, client =>
        client.query('SELECT app.apply_release_recovery_unpublishes($1)', [recovery.recoveryId]),
      ),
      'CMS04',
    )
    expect(await live()).toEqual(before)
  })

  it('reauthorizes review, preparation, private helpers and exact site ownership', async () => {
    const id = await page(),
      receipt = await releasePage(id),
      checked = await review(receipt.id)
    for (const user of [s.contributorA, s.editorB, s.disabled]) {
      await expect(getReleaseRecoveryReview(user, receipt.id)).rejects.toMatchObject({ kind: 'not_authorized' })
      await expect(getPreparedReleaseRecovery(user, receipt.id)).rejects.toMatchObject({ kind: 'not_authorized' })
      await expect(prepareReleaseRecovery(user, randomUUID(), receipt.id, checked.expectedState)).rejects.toMatchObject(
        { kind: 'not_authorized' },
      )
    }
    for (const role of ['public', 'worker'] as const)
      await expectSqlState(
        db.as(role, client => client.query('SELECT app.review_site_release_recovery($1)', [receipt.id])),
        '42501',
      )
    await expectSqlState(
      db.asUser(s.editorA, client => client.query('SELECT app.capture_release_recovery_items($1,$2)', [s.siteB, '[]'])),
      '42501',
    )
    expect(
      (
        await db.asUser(s.editorB, client =>
          client.query('SELECT * FROM site_release_recovery_captures WHERE release_id=$1', [receipt.id]),
        )
      ).rows,
    ).toEqual([])
  })

  it('keeps older receipts without complete captures history-only', async () => {
    const id = await page(),
      receipt = await releasePage(id)
    await db.as('owner', client =>
      client.query('DELETE FROM site_release_recovery_captures WHERE release_id=$1', [receipt.id]),
    )
    expect(await getReleaseRecoveryReview(s.editorA, receipt.id)).toMatchObject({
      available: false,
      reason: expect.stringMatching(/complete/),
    })
    await expect(prepareReleaseRecovery(s.editorA, randomUUID(), receipt.id, {})).rejects.toMatchObject({
      kind: 'invalid_state',
    })
  })

  it('recovers a first release back to private while retaining drafts and requiring a complete next publication', async () => {
    const { site, receipt, host } = await privateSite(),
      before = await live(site),
      checked = await review(receipt.id)
    expect(checked.wasPrivate).toBe(true)
    expect(checked.items.every(item => item.wasUnpublished)).toBe(true)
    const recovery = await prepareReleaseRecovery(s.superAdmin, randomUUID(), receipt.id, checked.expectedState)
    expect(await live(site)).toEqual(before)
    const plan = await planSiteRelease(s.superAdmin, randomUUID(), site, recovery.items)
    expect(await live(site)).toEqual(before)
    await executeSiteRelease(s.superAdmin, plan.id, '')
    expect(await live(site)).toMatchObject({ routes: [], private: true })
    expect(
      (await db.as('public', client => client.query('SELECT * FROM public_api.resolve_host($1)', [host]))).rows,
    ).toEqual([])
    const candidates = await listReleaseCandidates(s.superAdmin, site)
    await expect(
      planSiteRelease(s.superAdmin, randomUUID(), site, candidates.filter(item => item.type === 'page').slice(0, 1)),
    ).rejects.toMatchObject({ kind: 'invalid_state' })
    const next = await planSiteRelease(s.superAdmin, randomUUID(), site, candidates)
    await executeSiteRelease(s.superAdmin, next.id, '')
    expect((await live(site)).private).toBe(false)
  })

  it('refuses first-release recovery that would hide a later unrelated public page', async () => {
    const { site, receipt } = await privateSite(),
      later = await page('Later independent page', site)
    await releasePage(later, site)
    const before = await live(site)
    await expect(prepare(receipt.id)).rejects.toMatchObject({
      kind: 'invalid_state',
      message: expect.stringMatching(/unrelated/),
    })
    expect(await live(site)).toEqual(before)
  })

  it('recovers page, theme, navigation, frame, collection schema and ordered records together while retaining every later draft', async () => {
    const { site } = await privateSite()
    const collection = await db.asUser(s.superAdmin, async client => {
      const head = (await client.query('SELECT * FROM collections WHERE site_id=$1', [site])).rows[0]!
      await client.query('SELECT app.save_collection_entries($1,$2,$3)', [
        head.id,
        head.entry_revision,
        JSON.stringify([
          {
            id: null,
            stableKey: 'first',
            values: { title: 'First original report', resource_url: 'https://example.test/first.pdf' },
          },
          {
            id: null,
            stableKey: 'second',
            values: { title: 'Second original report', resource_url: 'https://example.test/second.pdf' },
          },
        ]),
      ])
      return head.id as string
    })
    const initialEntries = await planSiteRelease(
      s.superAdmin,
      randomUUID(),
      site,
      (await listReleaseCandidates(s.superAdmin, site)).filter(item => item.type === 'collection_entries'),
    )
    await executeSiteRelease(s.superAdmin, initialEntries.id, '')
    const before = await live(site)
    const home = before.routes.find(row => row.path === '/')!.page_id as string
    const baseline = await db.asUser(s.superAdmin, async client => ({
      schema: (
        await client.query(
          'SELECT v.fields,v.sort AS presentation FROM collections c JOIN collection_schema_versions v ON v.id=c.published_schema_version_id WHERE c.id=$1',
          [collection],
        )
      ).rows[0]!,
      entries: (
        await client.query(
          'SELECT e.id,e.stable_key,v."values" FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.published_version_id WHERE e.collection_id=$1 ORDER BY e.published_sort_index',
          [collection],
        )
      ).rows,
    }))
    await db.asUser(s.superAdmin, async client => {
      const theme = (
        await client.query(
          'SELECT h.revision,v.tokens FROM themes h JOIN theme_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
          [site],
        )
      ).rows[0]!
      const tokens = structuredClone(theme.tokens)
      tokens.colors.primary = '#165b43'
      await client.query('SELECT app.save_theme_draft($1,$2,$3)', [site, theme.revision, JSON.stringify(tokens)])
      const nav = (await client.query('SELECT revision FROM navigations WHERE site_id=$1', [site])).rows[0]!
      await client.query('SELECT app.save_navigation_draft($1,$2,$3,$4)', [site, nav.revision, '[]', 'manual'])
      const frame = (
        await client.query(
          'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
          [site],
        )
      ).rows
      const h = frame.find(row => row.kind === 'header')!,
        f = frame.find(row => row.kind === 'footer')!
      h.content.brand.siteName = 'Released frame change'
      f.content.legal.copyright = 'Released copyright change'
      await client.query('SELECT app.save_global_elements_draft($1,$2,$3,$4,$5)', [
        site,
        h.revision,
        f.revision,
        JSON.stringify(h.content),
        JSON.stringify(f.content),
      ])
      const c = (await client.query('SELECT revision,entry_revision FROM collections WHERE id=$1', [collection]))
        .rows[0]!
      await client.query('SELECT app.save_collection_schema($1,$2,$3,$4)', [
        collection,
        c.revision,
        JSON.stringify([
          ...baseline.schema.fields,
          { key: 'edition', label: 'Edition', type: 'text', required: false },
        ]),
        JSON.stringify(baseline.schema.presentation),
      ])
      await client.query('SELECT app.save_collection_entries($1,$2,$3)', [
        collection,
        c.entry_revision,
        JSON.stringify([
          {
            id: baseline.entries[1]!.id,
            stableKey: 'second',
            values: { title: 'Changed second', resource_url: 'https://example.test/second.pdf', edition: 'new' },
          },
          {
            id: null,
            stableKey: 'new-third',
            values: { title: 'Added third', resource_url: 'https://example.test/third.pdf', edition: 'new' },
          },
        ]),
      ])
    })
    await edit(home, 'Released page change')
    const receipt = await planSiteRelease(
      s.superAdmin,
      randomUUID(),
      site,
      await listReleaseCandidates(s.superAdmin, site),
    )
    expect(new Set(receipt.snapshot.map(item => item.type))).toEqual(
      new Set(['page', 'theme', 'navigation', 'frame', 'collection_schema', 'collection_entries']),
    )
    await executeSiteRelease(s.superAdmin, receipt.id, '')
    const released = await live(site)
    await edit(home, 'Later unreleased page work')
    const checked = await review(receipt.id)
    const recovery = await prepareReleaseRecovery(s.superAdmin, randomUUID(), receipt.id, checked.expectedState)
    expect(recovery.preservedDrafts.map(item => item.type).sort()).toEqual([
      'collection_entries',
      'collection_schema',
      'frame',
      'navigation',
      'page',
      'theme',
    ])
    expect(recovery.preservedDrafts.find(item => item.type === 'collection_entries')!.entryVersionIds).toHaveLength(3)
    expect(await live(site)).toEqual(released)
    // A direct database caller cannot bless the transaction-local staging
    // outcome with its own hash and thereby omit the paired publishers.
    await expectSqlState(
      db.asUser(s.superAdmin, async client => {
        const context = (await client.query('SELECT app.release_fingerprint($1) AS hash', [site])).rows[0]!.hash
        await client.query('SAVEPOINT partial_recovery')
        await client.query('SELECT app.apply_release_recovery_unpublishes($1)', [recovery.recoveryId])
        const partial = (await client.query('SELECT app.release_fingerprint($1) AS hash', [site])).rows[0]!.hash
        await client.query('ROLLBACK TO SAVEPOINT partial_recovery')
        await client.query('RELEASE SAVEPOINT partial_recovery')
        const forged = randomUUID()
        await client.query('SELECT app.record_site_release($1,$2,$3,$4,$5,$6)', [
          forged,
          site,
          JSON.stringify(recovery.items),
          context,
          partial,
          '[]',
        ])
        await client.query('SELECT app.apply_release_recovery_unpublishes($1)', [recovery.recoveryId])
        await client.query('SELECT app.finish_site_release($1,false,$2)', [forged, '{}'])
      }),
      'CMS04',
    )
    expect(await live(site)).toEqual(released)
    const plan = await planSiteRelease(s.superAdmin, randomUUID(), site, recovery.items)
    expect(plan.preview_report.every(check => check.report.ok)).toBe(true)
    await executeSiteRelease(s.superAdmin, plan.id, '')
    expect((await live(site)).shell).toEqual(before.shell)
    const restored = await db.asUser(s.superAdmin, async client => ({
      schema: (
        await client.query(
          'SELECT v.fields,v.sort AS presentation FROM collections c JOIN collection_schema_versions v ON v.id=c.published_schema_version_id WHERE c.id=$1',
          [collection],
        )
      ).rows[0]!,
      entries: (
        await client.query(
          'SELECT e.id,e.stable_key,v."values" FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.published_version_id WHERE e.collection_id=$1 AND e.published_archived_at IS NULL ORDER BY e.published_sort_index',
          [collection],
        )
      ).rows,
      pins: (
        await client.query('SELECT DISTINCT kind FROM site_release_version_pins WHERE release_id=$1', [receipt.id])
      ).rows.map(row => row.kind),
    }))
    expect(restored.schema).toEqual(baseline.schema)
    expect(restored.entries).toEqual(baseline.entries)
    expect(restored.pins.sort()).toEqual(['collection_entries', 'collection_schema', 'frame', 'navigation', 'theme'])
  })

  it('keeps live content unchanged when a retained recovery image is no longer available', async () => {
    const media = randomUUID(),
      slug = `recovery-photo-${randomUUID().slice(0, 8)}`
    await db.as('owner', client =>
      client.query(
        "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'recovery.jpg','Recovery photograph',10,10,99,'image/jpeg','ready')",
        [media, s.siteA, `recovery/${media}.jpg`, media.replaceAll('-', '').padEnd(64, 'a')],
      ),
    )
    const slots = [
      { id: 'heading', kind: 'text' as const, label: 'Heading', constraints: {} },
      { id: 'picture', kind: 'image' as const, label: 'Picture', constraints: {} },
    ]
    const html = '<section><h1>{{heading}}</h1>{{picture}}</section>'
    const compiled = compileSection({ sourceHtml: html, sourceCss: '', slots, scopeSelector: `.cms-section--${slug}` })
    const id = await page()
    await db.asUser(s.superAdmin, async client => {
      const definition = (
        await client.query('SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [
          slug,
          slug,
          'Recovery',
          html,
          '',
          '',
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Recovery media fixture',
          false,
        ])
      ).rows[0]!
      const content = [
        {
          section_def_id: definition.section_def_id,
          section_def_version: 1,
          values: {
            heading: 'Retained image heading',
            picture: {
              media_id: media,
              variant: 'original',
              src: `/media/${media}/original`,
              alt: 'Recovery photograph',
              decorative: false,
            },
          },
          hidden: false,
          hidden_at: [],
        },
      ]
      await client.query('SELECT app.save_page_draft($1,1,$2,$3)', [id, JSON.stringify(content), '{}'])
    })
    await releasePage(id)
    await edit(id, 'Current healthy page without the image')
    const receipt = await releasePage(id)
    await db.asUser(s.superAdmin, async client => {
      const row = (await client.query('SELECT revision FROM media WHERE id=$1', [media])).rows[0]!
      await client.query('SELECT app.soft_delete_media($1,$2,true,$3)', [
        media,
        row.revision,
        'Explicit recovery missing-media regression',
      ])
    })
    const head = () =>
      db.asUser(
        s.superAdmin,
        async client => (await client.query('SELECT revision,draft_version_id FROM pages WHERE id=$1', [id])).rows[0],
      )
    const before = await live(),
      draft = await head()
    // Restoring the earlier publication would reference the deleted image, so
    // preparation refuses atomically: no checkpoint or recovery draft survives
    // and the message names the item the author has to repair.
    await expect(prepare(receipt.id)).rejects.toMatchObject({
      kind: 'invalid_state',
      message: expect.stringMatching(/^Recovery is blocked for “Recovery page”: .*deleted/),
    })
    expect(await getPreparedReleaseRecovery(s.superAdmin, receipt.id)).toBeNull()
    expect(await head()).toEqual(draft)
    expect(await live()).toEqual(before)
  })
})
