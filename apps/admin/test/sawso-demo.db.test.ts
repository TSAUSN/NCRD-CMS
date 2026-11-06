vi.mock('server-only', () => ({}))
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { beforeAll, afterAll, it, expect, vi } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { mapErrors } from '@cms/domain'
import type { MediaStore } from '@cms/platform'
import { renderPage } from '@cms/renderer'
let db: TestDatabase, s: Scenario
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import { ensureSawsoDemo } from '../src/lib/sawso-demo.ts'
import { processMediaUpload } from '../../worker/src/media.ts'
import { createPostgresMediaProcessingRepository } from '../../worker/src/media-repository.ts'
import { listReleaseCandidates, planSiteRelease, executeSiteRelease } from '../src/lib/releases.ts'
import { DEMO_SITES, reviewedDemoArchive, demoReadinessOverride, importSite } from '../scripts/demo-data.ts'
const objects = new Map<string, Uint8Array>(),
  media: MediaStore = {
    get: async key => objects.get(key) ?? null,
    put: async (key, body, contentType) => {
      objects.set(key, body)
      return { objectKey: key, bytes: body.length, contentType }
    },
    remove: async key => {
      objects.delete(key)
    },
    createSignedUpload: async () => {
      throw Error('unused')
    },
  }
beforeAll(async () => {
  db = await TestDatabase.create('sawso_demo')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
it('restores the exact offline SAWSO demo through native setup, normal Media and publishing with shared native behaviour', async () => {
  const fixture = DEMO_SITES[0],
    bytes = readFileSync(new URL('../../../demo/sites/' + fixture.file, import.meta.url))
  expect(reviewedDemoArchive(fixture, bytes)).toBe(true)
  const archive = JSON.parse(gunzipSync(bytes).toString()),
    repository = createPostgresMediaProcessingRepository(db.pool('worker'), 'demo-test'),
    result = await ensureSawsoDemo(s.superAdmin, archive.photos, media, intent =>
      processMediaUpload(intent, { media, repository }),
    ),
    id = result.id
  const plan = await planSiteRelease(s.superAdmin, randomUUID(), id, await listReleaseCandidates(s.superAdmin, id))
  await executeSiteRelease(s.superAdmin, plan.id, demoReadinessOverride(fixture, plan.preview_report))
  const routes = (
    await db.as('public', c => c.query('SELECT * FROM public_api.site_routes($1)', ['sawso.staging.localhost']))
  ).rows
  expect(routes).toHaveLength(49)
  const route = async (path: string) =>
    (
      await db.as('public', c =>
        c.query('SELECT * FROM public_api.resolve_route($1,$2)', ['sawso.staging.localhost', path]),
      )
    ).rows[0]!
  const news = await route('/newsroom'),
    html = renderPage({
      manifest: news.render_manifest,
      shell: news.shell_payload,
      isStaging: true,
      options: { newsroom: { sector: 'education' } },
    }).html
  expect(html.match(/class="core-story-card"/g)).toHaveLength(7)
  expect(html).toContain('Our Stories in Education')
  expect(html).toContain('data-cms-story-view="sectors"')
  const health = await route('/ways-we-help/health'),
    stories = health.render_manifest.sections.find((s: any) => s.def.slug === 'core-stories').instance.values.stories
      .entries
  expect(stories).toHaveLength(6)
  expect(stories.every((s: any) => s.values.photo.src.startsWith('/media/'))).toBe(true)
  const mediaCount = (
    await db.as('owner', c => c.query("SELECT count(*)::int AS n FROM media WHERE site_id=$1 AND status='ready'", [id]))
  ).rows[0]!.n
  expect(mediaCount).toBe(40)
  expect(objects.size).toBe(160)
  const before = (
    await db.asUser(s.superAdmin, c => c.query('SELECT entry_revision FROM collections WHERE site_id=$1', [id]))
  ).rows[0]!.entry_revision
  expect(
    await ensureSawsoDemo(s.superAdmin, archive.photos, media, async () => {
      throw Error('released sites must remain untouched')
    }),
  ).toEqual({ id, created: false })
  expect(
    (await db.asUser(s.superAdmin, c => c.query('SELECT entry_revision FROM collections WHERE site_id=$1', [id])))
      .rows[0]!.entry_revision,
  ).toBe(before)
  const old = (
    await db.as('public', c =>
      c.query('SELECT public_api.resolve_redirect($1,$2) AS path', [
        'sawso.staging.localhost',
        '/sawso/story/life-in-ukraine-years-into-war',
      ]),
    )
  ).rows[0]!.path
  expect(old).toBe('/stories/life-in-ukraine-years-into-war')
  // A retained installation may predate writing stories in the CMS. Restarting
  // upgrades only the unchanged legacy schema, without recreating its content.
  await db.asUser(s.superAdmin, async c => {
    const list = (
      await c.query(
        'SELECT c.id,c.revision,v.fields,v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.site_id=$1',
        [id],
      )
    ).rows[0]!
    const legacy = list.fields.map((field: { key: string }) =>
      field.key === 'old_address' ? { ...field, required: true } : field,
    )
    const saved = (
      await c.query('SELECT * FROM app.save_collection_schema($1,$2,$3,$4)', [
        list.id,
        list.revision,
        JSON.stringify(legacy),
        JSON.stringify(list.sort),
      ])
    ).rows[0]!
    await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [list.id, saved.revision])
  })
  const pageHeads = (
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [id]),
    )
  ).rows
  expect(await importSite(s.superAdmin, fixture)).toEqual({ id, created: false })
  const updated = (
    await db.asUser(s.superAdmin, c =>
      c.query(
        'SELECT c.entry_revision,v.fields FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.site_id=$1',
        [id],
      ),
    )
  ).rows[0]!
  expect(updated.fields.find((field: { key: string }) => field.key === 'old_address').required).toBe(false)
  expect(updated.entry_revision).toBe(before)
  expect(
    (
      await db.asUser(s.superAdmin, c =>
        c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [id]),
      )
    ).rows,
  ).toEqual(pageHeads)
}, 240000)
