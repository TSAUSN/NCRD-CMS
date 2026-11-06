import { expect } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { Pool } from 'pg'
import { asUser, configuredMediaStore, poolFor, closePools } from '../../packages/platform/src/index.ts'
import { ensureSawsoSite } from '../../apps/admin/src/lib/sawso-site.ts'
import { ensureSawsoCorePages, ensureSawsoPublicPages } from '../../apps/admin/src/lib/sawso-pages.ts'
import { ensureSawsoFrame } from '../../apps/admin/src/lib/sawso-frame.ts'
import { applySawsoOwnerContent, type SawsoOwnerContent } from '../../apps/admin/src/lib/sawso-owner-content.ts'
import { listReleaseCandidates, planSiteRelease, executeSiteRelease } from '../../apps/admin/src/lib/releases.ts'
import { processMediaUpload } from '../../apps/worker/src/media.ts'
import { createPostgresMediaProcessingRepository } from '../../apps/worker/src/media-repository.ts'

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }),
    client = await pool.connect()
  let siteId: string | undefined
  try {
    const actor = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE cms_authenticated_user')
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const site = await ensureSawsoSite(client, randomUUID(), 'sawso')
    siteId = site.siteId
    await ensureSawsoCorePages(client, siteId)
    await ensureSawsoPublicPages(client, siteId)
    await ensureSawsoFrame(client, siteId)
    await client.query('COMMIT')
    const initial = await planSiteRelease(actor, randomUUID(), siteId, await listReleaseCandidates(actor, siteId))
    await executeSiteRelease(actor, initial.id, 'Confirmed: Publish with sample content.', true)
    const protectedRows = async () =>
      (
        await client.query(
          "SELECT p.slug,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.archived_at IS NULL AND (p.slug='ways-we-help' OR p.slug LIKE 'ways-we-help/%') ORDER BY p.slug",
          [siteId],
        )
      ).rows
    const before = await protectedRows(),
      payload = JSON.parse(await readFile(resolve('demo/sawso-content/content.json'), 'utf8')) as SawsoOwnerContent
    const bytes = await readFile(resolve('apps/admin/public/cms-samples/r8-landscape.png')),
      sources = [payload.team[0]!.image, payload.reports[0]!.image, payload.illustration!.source]
    const photos = sources.map(source => ({
      source,
      original_name: 'Owner import fixture (sample).png',
      alt_text: 'Landscape illustration (sample)',
      focal: { x: 0.5, y: 0.5 },
      attribution: 'Local CMS test fixture',
      tags: ['sample'],
      mime_type: 'image/png' as const,
      content_hash: createHash('sha256').update(bytes).digest('hex'),
      base64: bytes.toString('base64'),
    }))
    const media = configuredMediaStore(),
      repository = createPostgresMediaProcessingRepository(poolFor('worker'), 'owner-content-spec')
    const result = await applySawsoOwnerContent(actor, payload, photos, media, id =>
      processMediaUpload(id, { media, repository }),
    )
    expect(result.changedStories).toHaveLength(34)
    expect(result.skippedStories).toEqual([])
    expect(result.protectedPages).toBe(9)
    expect(result.pages).toEqual(['our-team', 'annual-reports', 'financial-accountability'])
    expect(result.illustrationChanged).toBe(true)
    expect(result.privacyChanged).toBe(true)
    expect(result.mediaProblems).toEqual([])
    expect(result.releaseItems.every(item => ['page', 'collection_entries', 'frame'].includes(item.type))).toBe(true)
    const plan = await planSiteRelease(actor, randomUUID(), siteId, result.releaseItems)
    expect(plan.preview_report.flatMap(check => check.report.blocking).every(f => f.rule === 'sample_content')).toBe(
      true,
    )
    await executeSiteRelease(actor, plan.id, 'Confirmed: Publish with sample content.', true)
    expect(await protectedRows()).toEqual(before)
    const stored = (
      await client.query(
        "SELECT p.slug,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug IN ('privacy','our-team')",
        [siteId],
      )
    ).rows
    expect(stored.find(p => p.slug === 'privacy').content[1].values.__cms_sample_fields).toContain('body')
    expect(
      stored
        .find(p => p.slug === 'our-team')
        .content.slice(1)
        .filter((s: { values: { __cms_sample_fields?: string[] } }) => s.values.__cms_sample_fields?.includes('photo')),
    ).toHaveLength(payload.team.length - 1)
    const replay = await applySawsoOwnerContent(actor, payload, photos, media, id =>
      processMediaUpload(id, { media, repository }),
    )
    expect(replay.releaseItems).toEqual([])
    console.log(
      JSON.stringify({
        siteId,
        hostname: site.hostname,
        result,
        protectedSame: JSON.stringify(await protectedRows()) === JSON.stringify(before),
      }),
    )
  } finally {
    await client.query('ROLLBACK')
    client.release()
    await pool.end()
    await closePools()
  }
}
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
