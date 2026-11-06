// Replays the maintainer’s frozen local capture. No live request, reset or direct data write.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { asUser, closePools, configuredMediaStore, poolFor } from '@cms/platform'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { applySawsoOwnerContent, type SawsoOwnerContent } from '../src/lib/sawso-owner-content.ts'
import type { DemoPhoto } from '../src/lib/sawso-demo.ts'
import { processMediaUpload } from '../../worker/src/media.ts'
import { createPostgresMediaProcessingRepository } from '../../worker/src/media-repository.ts'
import { planSiteRelease, executeSiteRelease } from '../src/lib/releases.ts'
const root = new URL('../../../', import.meta.url),
  folder = new URL('demo/sawso-content/', root)
async function main() {
  for (const key of ['DATABASE_URL', 'DATABASE_URL_AUTHENTICATED', 'DATABASE_URL_WORKER']) {
    const url = new URL(process.env[key] ?? '')
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.port !== '54329' ||
      url.pathname !== '/cms_demo'
    )
      throw Error('This owner capture command runs only against the retained local cms_demo database on port54329.')
  }
  if (
    process.env.MEDIA_PROVIDER !== 'filesystem' ||
    process.env.MEDIA_ROOT !== '/private/tmp/cms-v2-live-adaptation-demo/demo-media'
  )
    throw Error('Use the retained demo filesystem Media store; no hosted store is allowed.')
  const receipt = JSON.parse(await readFile(new URL('receipt.json', folder), 'utf8')),
    content = await readFile(new URL('content.json', folder)),
    photos = await readFile(new URL('photos.json.gz', folder))
  for (const [bytes, expected] of [
    [content, receipt.contentSha256],
    [photos, receipt.photosSha256],
  ] as const)
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw Error('Review the frozen owner capture checksum before importing.')
  const actor = (await poolFor('migration').query("SELECT id FROM app_users WHERE email='admin@example.test'")).rows[0]
    ?.id
  if (!actor) throw Error('Start the retained demo first.')
  await asUser({ userId: actor }, client => installCoreLibrary(client))
  const media = configuredMediaStore(),
    repository = createPostgresMediaProcessingRepository(poolFor('worker'), 'sawso-owner-content')
  const result = await applySawsoOwnerContent(
    actor,
    JSON.parse(content.toString()) as SawsoOwnerContent,
    JSON.parse(gunzipSync(photos).toString()).photos as DemoPhoto[],
    media,
    id => processMediaUpload(id, { media, repository }),
  )
  const items = result.releaseItems,
    plan = items.length ? await planSiteRelease(actor, randomUUID(), result.siteId, items) : null
  if (plan) {
    const blockers = plan.preview_report.flatMap(c => c.report.blocking)
    if (blockers.some(f => f.rule !== 'sample_content'))
      throw Error('Normal release requires owner review: ' + blockers.map(f => f.rule + ': ' + f.message).join('; '))
    await executeSiteRelease(
      actor,
      plan.id,
      blockers.length ? 'Confirmed: Publish with sample content.' : '',
      blockers.length > 0,
    )
  }
  if (process.argv.includes('--archive-unused-privacy'))
    await asUser({ userId: actor }, async c => {
      const row = (
        await c.query(
          "SELECT p.id,p.revision,p.draft_version_id,p.published_version_id FROM pages p WHERE p.site_id=$1 AND p.slug='privacy' AND p.archived_at IS NULL FOR UPDATE",
          [result.siteId],
        )
      ).rows[0]
      if (!row) return
      const footer = (
        await c.query(
          "SELECT v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.published_version_id WHERE g.site_id=$1 AND g.kind='footer'",
          [result.siteId],
        )
      ).rows[0]
      const markup = footer?.content?.component?.values?.base
      if (
        typeof markup !== 'string' ||
        !markup.includes('href="https://www.salvationarmyusa.org/usn/privacypolicy"') ||
        markup.includes('href="/privacy"')
      )
        throw Error('The external Privacy link must be live before archiving its unused local page.')
      if (row.draft_version_id !== row.published_version_id)
        throw Error('Preserved unpublished Privacy work; archive requires review.')
      await c.query('SELECT app.archive_page($1,$2)', [row.id, row.revision])
    })
  const output = {
    ...result,
    publishedThroughNormalRelease: true,
    releaseId: plan?.id ?? null,
    releaseItems: items.length,
  }
  await writeFile(new URL('.r8-progress/sawso-owner-content-result.json', root), JSON.stringify(output, null, 2))
  console.log(JSON.stringify(output, null, 2))
}
main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(closePools)
