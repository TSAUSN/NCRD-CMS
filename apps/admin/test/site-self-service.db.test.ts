import { installCoreLibrary } from '@cms/seeds/core-install'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { SiteSetup, clearSampleField, type CollectionEntryDraft } from '@cms/schema'
import { starterSiteSetup } from '@cms/seeds/archetypes'
import { renderPage, type RenderManifest, type SiteShell } from '@cms/renderer'
import { evaluateVersionReadiness } from '@cms/platform'
import { readCollectionBindingOptions } from '../src/lib/collection-binding-options.ts'
import { createSiteFromSetupInTransaction } from '../src/lib/site-creation.ts'
import { publishStarterFixture } from './site-fixture.ts'

let db: TestDatabase
let scenario: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('site_self_service')
  scenario = await seedScenario(db)
  await db.asUser(scenario.superAdmin, client => installCoreLibrary(client))
})
afterAll(async () => {
  await db?.close()
})

async function create(kind: SiteSetup['kind']) {
  const plan = SiteSetup.parse({
    ...starterSiteSetup(kind),
    name: 'Synthetic community project',
    slug: `self-service-${randomUUID().slice(0, 8)}`,
  })
  const host = `${plan.slug}.staging.example.test`
  const result = await db.asUser(scenario.superAdmin, async client => {
    const result = await createSiteFromSetupInTransaction(client, randomUUID(), plan, host)
    await publishStarterFixture(client, result.siteId)
    await client.query('SELECT app.set_site_membership($1,$2,$3)', [scenario.editorA, result.siteId, 'editor'])
    await client.query('SELECT app.set_site_membership($1,$2,$3)', [
      scenario.contributorA,
      result.siteId,
      'contributor',
    ])
    return result
  })
  const collections = await db.asUser(
    scenario.editorA,
    async client =>
      (
        await client.query<{ id: string; reader_key: string }>(
          'SELECT id,reader_key FROM collections WHERE site_id=$1',
          [result.siteId],
        )
      ).rows,
  )
  return {
    ...result,
    host,
    collections: Object.fromEntries(collections.map(collection => [collection.reader_key, collection.id])),
  }
}

async function publicHtml(host: string, path: string) {
  return db.as('public', async client => {
    const row = (
      await client.query<{ render_manifest: RenderManifest; shell_payload: SiteShell; is_staging: boolean }>(
        'SELECT * FROM public_api.resolve_route($1,$2)',
        [host, path],
      )
    ).rows[0]!
    expect(row, 'starter route is publicly resolved in the isolated test database').toBeDefined()
    const routes = (
      await client.query<{ page_id: string; path: string }>('SELECT * FROM public_api.site_routes($1)', [host])
    ).rows
    return renderPage({
      manifest: row.render_manifest,
      shell: row.shell_payload,
      isStaging: row.is_staging,
      navigationPaths: Object.fromEntries(routes.map(route => [route.page_id, route.path])),
    }).html
  })
}

async function save(collectionId: string, revision: number, entries: CollectionEntryDraft[]) {
  return db.asUser(scenario.contributorA, async client =>
    Number(
      (
        await client.query<{ entry_revision: string }>('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
          collectionId,
          revision,
          JSON.stringify(entries),
        ])
      ).rows[0]!.entry_revision,
    ),
  )
}
async function publish(collectionId: string, revision: number) {
  return db.asUser(scenario.editorA, async client =>
    Number(
      (
        await client.query<{ entry_revision: string }>('SELECT * FROM app.publish_collection_entries($1,$2)', [
          collectionId,
          revision,
        ])
      ).rows[0]!.entry_revision,
    ),
  )
}
async function saved(collectionId: string): Promise<CollectionEntryDraft[]> {
  return db.asUser(scenario.editorA, async client =>
    (
      await client.query<{ id: string; stable_key: string; values: Record<string, unknown> }>(
        `SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id
     WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index`,
        [collectionId],
      )
    ).rows.map(row => ({ id: row.id, stableKey: row.stable_key, values: row.values })),
  )
}

describe('new-site self-service through real roles and the production renderer', () => {
  it('lets contributors add speakers and build, reorder, remove and restore sessions without technical schema edits', async () => {
    const site = await create('event')
    const speakers = site.collections['speakers']!,
      program = site.collections['program']!
    expect(await publicHtml(site.host, '/speakers')).toContain('Speaker 1 (sample)')
    expect(await publicHtml(site.host, '/speakers')).toContain('Speaker 2 (sample)')
    let speakerRevision = await save(speakers, 0, [
      {
        id: null,
        stableKey: 'morgan-example',
        values: {
          name: 'Morgan Example',
          role: 'Community researcher',
          bio: '<p>Works with local partners.</p>',
          photo: '',
        },
      },
    ])
    expect(await publicHtml(site.host, '/speakers')).not.toContain('Morgan Example')
    speakerRevision = await publish(speakers, speakerRevision)
    expect(await publicHtml(site.host, '/speakers')).toContain('Morgan Example')
    expect(await publicHtml(site.host, '/speakers')).not.toContain('Speaker 1 (sample)')
    const opening = {
      id: null,
      stableKey: 'opening',
      values: {
        title: 'Opening conversation',
        date: '2026-10-02',
        time: '10 AM ET',
        location: 'Main hall',
        speakers: 'Morgan Example',
        category: 'Community',
        summary: '<p>Welcome.</p>',
        session_url: '',
      },
    }
    const workshop = {
      id: null,
      stableKey: 'workshop',
      values: {
        ...opening.values,
        title: 'Practical workshop',
        time: '11 AM ET',
        session_url: 'https://example.test/session?day=1&track=2#details',
      },
    }
    let revision = await save(program, 0, [opening, workshop])
    expect(await publicHtml(site.host, '/program')).toContain('A welcoming start')
    revision = await publish(program, revision)
    let html = await publicHtml(site.host, '/program')
    expect(html).toContain('2026-10-02')
    expect(html).toContain('Main hall')
    expect(html).toContain('Morgan Example')
    expect(html).toContain('href="https://example.test/session?day=1&amp;track=2#details"')
    expect(html.indexOf('Opening conversation')).toBeLessThan(html.indexOf('Practical workshop'))
    const records = await saved(program)
    revision = await save(program, revision, [...records].reverse())
    expect((await publicHtml(site.host, '/program')).indexOf('Opening conversation')).toBeLessThan(
      (await publicHtml(site.host, '/program')).indexOf('Practical workshop'),
    )
    revision = await publish(program, revision)
    html = await publicHtml(site.host, '/program')
    expect(html.indexOf('Practical workshop')).toBeLessThan(html.indexOf('Opening conversation'))
    revision = await save(program, revision, [records[1]!])
    revision = await publish(program, revision)
    expect(await publicHtml(site.host, '/program')).not.toContain('Opening conversation')
    revision = await save(program, revision, records)
    revision = await publish(program, revision)
    expect(await publicHtml(site.host, '/program')).toContain('Opening conversation')
    const people = await saved(speakers)
    speakerRevision = await save(speakers, speakerRevision, [])
    speakerRevision = await publish(speakers, speakerRevision)
    expect(await publicHtml(site.host, '/speakers')).not.toContain('Morgan Example')
    speakerRevision = await save(speakers, speakerRevision, people)
    speakerRevision = await publish(speakers, speakerRevision)
    expect(await publicHtml(site.host, '/speakers')).toContain('Morgan Example')
  })

  it('renders resource categories, a governed image, rich text and a document URL, keeping replacements private until publication', async () => {
    const site = await create('resource'),
      resources = site.collections['resources']!
    const mediaId = randomUUID()
    await db.as('owner', async client => {
      await client.query(
        `INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,decorative,width,height,bytes,mime_type,status)
        VALUES($1,$2,'synthetic/resource.jpg',$3,'resource.jpg','Volunteers at a community event',false,1200,800,1000,'image/jpeg','ready')`,
        [mediaId, site.siteId, 'a'.repeat(64)],
      )
      await client.query(
        `INSERT INTO media_variants(media_id,kind,object_key,width,height,bytes,mime_type,content_hash)
        VALUES($1,'wide','synthetic/resource.webp',1200,800,900,'image/webp',$2)`,
        [mediaId, 'b'.repeat(64)],
      )
    })
    let revision = await save(resources, 0, [
      {
        id: null,
        stableKey: 'annual-report',
        values: {
          title: 'Annual community report',
          category: 'Research',
          summary: '<p>Evidence <strong>for everyone</strong>.</p>',
          thumbnail: { src: `/media/${mediaId}/wide`, alt: 'Volunteers at a community event', decorative: false },
          resource_url: 'https://example.test/report.pdf?year=2026&lang=en#page=2',
        },
      },
    ])
    expect(await publicHtml(site.host, '/resources')).not.toContain('Annual community report')
    revision = await publish(resources, revision)
    const before = await publicHtml(site.host, '/resources')
    expect(before).toContain('Research')
    expect(before).toContain('alt="Volunteers at a community event"')
    expect(before).toContain('<strong>for everyone</strong>')
    expect(before).toContain('href="https://example.test/report.pdf?year=2026&amp;lang=en#page=2"')
    const records = await saved(resources)
    records[0]!.values['resource_url'] = 'https://example.test/revised.pdf'
    records[0]!.values['category'] = 'Updated research'
    revision = await save(resources, revision, records)
    expect(await publicHtml(site.host, '/resources')).toBe(before)
    revision = await publish(resources, revision)
    expect(await publicHtml(site.host, '/resources')).toContain('href="https://example.test/revised.pdf"')
    expect(await publicHtml(site.host, '/resources')).toContain('Updated research')
  })

  it('offers site-scoped compatible published choices and connects a new page with a manual collection selection', async () => {
    const site = await create('resource'),
      resources = site.collections['resources']!
    let revision = await save(resources, 0, [
      {
        id: null,
        stableKey: 'first-report',
        values: { title: 'First report', resource_url: 'https://example.test/first.pdf' },
      },
      {
        id: null,
        stableKey: 'second-report',
        values: { title: 'Second report', resource_url: 'https://example.test/second.pdf' },
      },
    ])
    const source = await db.asUser(
      scenario.editorA,
      async client =>
        (
          await client.query<{
            content: Array<{ section_def_id: string; section_def_version: number; values: Record<string, unknown> }>
          }>(
            `SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug='resources'`,
            [site.siteId],
          )
        ).rows[0]!.content,
    )
    const listing = source.find(section => Object.hasOwn(section.values, 'resources'))!
    expect(listing).toBeDefined()
    const choices = (user = scenario.contributorA, field = 'resources', definition = listing.section_def_id) =>
      db.asUser(user, client =>
        readCollectionBindingOptions(client, site.siteId, definition, listing.section_def_version, field),
      )
    expect((await choices())?.[0]).toMatchObject({
      id: resources,
      readerKey: 'resources',
      compatible: true,
      entries: [],
    })
    revision = await publish(resources, revision)
    expect((await choices())?.[0]?.entries.map(entry => entry.stableKey)).toEqual(['first-report', 'second-report'])
    expect(await choices(scenario.editorB)).toBeNull()
    expect(await choices(scenario.editorA, 'missing')).toBeNull()
    expect(await choices(scenario.editorA, 'resources', scenario.heroDefId)).toBeNull()
    // Names and saved drafts cannot influence the chosen stable record keys.
    const records = await saved(resources)
    records[0]!.values['title'] = 'Private renamed report'
    revision = await save(resources, revision, records)
    expect((await choices())?.[0]?.entries[0]?.title).toBe('First report')
    const page = await db.asUser(scenario.editorA, async client => {
      const id = (
        await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
          site.siteId,
          'featured-resources',
          'Featured resources',
        ])
      ).rows[0]!.id
      const content = structuredClone([source[0]!, listing])
      content[0]!.values['heading'] = 'Featured resources'
      content[0]!.values = clearSampleField(content[0]!.values, 'heading')
      content[1]!.values['heading'] = 'Selected reports'
      content[1]!.values['resources'] = {
        readerKey: 'resources',
        selection: { mode: 'manual', stableKeys: ['second-report'] },
      }
      content[1]!.values = clearSampleField(clearSampleField(content[1]!.values, 'heading'), 'resources')
      const draft = (
        await client.query<{ version_id: string; revision: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          id,
          0,
          JSON.stringify(content),
          JSON.stringify({ title: 'Featured resources', description: 'Selected community resources.' }),
        ])
      ).rows[0]!
      const readiness = await evaluateVersionReadiness(client, draft.version_id, 'member')
      expect(readiness.ok, JSON.stringify(readiness.findings)).toBe(true)
      return { id, draft, readiness }
    })
    expect(
      (
        await db.as('public', client =>
          client.query('SELECT * FROM public_api.resolve_route($1,$2)', [site.host, '/featured-resources']),
        )
      ).rows,
    ).toEqual([])
    await db.asUser(scenario.editorA, client =>
      client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [
        page.id,
        page.draft.revision,
        page.readiness.policyVersion,
        null,
        JSON.stringify(page.readiness.findings),
      ]),
    )
    const html = await publicHtml(site.host, '/featured-resources')
    expect(html).toContain('Second report')
    expect(html).not.toContain('First report')
    expect(html).not.toContain('Private renamed report')
  })

  it('enforces typed validation, stale revisions, editor schema boundaries and tenant isolation', async () => {
    const site = await create('event'),
      program = site.collections['program']!
    const entry = { id: null, stableKey: 'opening', values: { title: 'Opening', date: '2026-10-02', time: '10 AM ET' } }
    await expectSqlState(save(program, 0, [{ ...entry, values: { ...entry.values, date: '2026-02-30' } }]), 'CMS04')
    const revision = await save(program, 0, [entry])
    await expectSqlState(save(program, 0, []), 'CMS01')
    await expectSqlState(
      db.asUser(scenario.contributorA, client =>
        client.query('SELECT * FROM app.publish_collection_entries($1,$2)', [program, revision]),
      ),
      'CMS02',
    )
    await expectSqlState(
      db.asUser(scenario.editorB, client =>
        client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [program, revision, '[]']),
      ),
      'CMS02',
    )
    expect(
      (await db.asUser(scenario.editorB, client => client.query('SELECT id FROM collections WHERE id=$1', [program])))
        .rows,
    ).toEqual([])
    await expectSqlState(
      db.asUser(scenario.editorA, client =>
        client.query('SELECT * FROM app.save_collection_schema($1,$2,$3,$4)', [program, 1, '[]', '{}']),
      ),
      'CMS02',
    )
  })
})
