import type { Queryable } from '@cms/platform'
import { isDeepStrictEqual } from 'node:util'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { echelonSiteSetup } from '@cms/seeds/echelon-site'
import { echelonChapterSetups, withEchelonMedia } from '@cms/seeds/echelon-chapters'
import type { SectionInstance } from '@cms/schema'
import { createSiteFromSetupInTransaction } from './site-creation.ts'
/** Identity-scoped caller transaction. A retry never rewrites existing content. */
export async function ensureEchelonSite(
  client: Queryable,
  requestId: string,
): Promise<{ siteId: string; hostname: string }> {
  if (!(await client.query('SELECT app.is_super_admin() AS allowed')).rows[0]?.allowed)
    throw new Error('Only a Super Admin can set up the chapters site.')
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('cms-echelon-chapters-setup',8))")
  const setup = echelonSiteSetup(),
    existing = (await client.query('SELECT id,staging_hostname FROM sites WHERE slug=$1', [setup.slug])).rows[0]
  if (existing) {
    await client.query('SELECT app.enable_chapters($1)', [existing.id])
    await installCoreLibrary(client)
    await keepChapterNavigationExplicit(client, existing.id)
    await ensureEchelonChapterSetups(client, existing.id)
    return { siteId: existing.id, hostname: existing.staging_hostname }
  }
  await installCoreLibrary(client)
  const site = await createSiteFromSetupInTransaction(client, requestId, setup, setup.slug + '.staging.localhost')
  await client.query('SELECT app.enable_chapters($1)', [site.siteId])
  await keepChapterNavigationExplicit(client, site.siteId)
  await ensureEchelonChapterSetups(client, site.siteId)
  return site
}
async function keepChapterNavigationExplicit(client: Queryable, siteId: string) {
  const head = (
    await client.query(
      'SELECT n.mode,n.revision,v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
      [siteId],
    )
  ).rows[0]
  if (head?.mode === 'auto')
    await client.query("SELECT * FROM app.save_navigation_draft($1,$2,$3,'manual')", [
      siteId,
      head.revision,
      JSON.stringify(head.tree),
    ])
}
export async function ensureEchelonChapterSetups(client: Queryable, siteId: string): Promise<void> {
  if (!(await client.query('SELECT app.is_super_admin() AS allowed')).rows[0]?.allowed)
    throw new Error('Only a Super Admin can set up chapters.')
  for (const row of echelonChapterSetups()) {
    const existing = (
      await client.query(
        'SELECT c.id,c.revision,v.config FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.site_id=$1 AND c.slug=$2',
        [siteId, row.slug],
      )
    ).rows[0]
    if (existing) {
      // Upgrade only the untouched, private sample setup from the earlier hour.
      if (
        row.slug === 'boston' &&
        existing.revision === '1' &&
        existing.config.pageId === null &&
        existing.config.destination === 'external' &&
        existing.config.externalUrl === 'https://example.test/chapters/boston' &&
        isDeepStrictEqual({ ...existing.config, destination: 'page', externalUrl: null }, row.config)
      )
        await client.query('SELECT * FROM app.save_chapter_setup($1,$2,$3,$4,$5)', [
          siteId,
          existing.id,
          existing.revision,
          row.slug,
          JSON.stringify(row.config),
        ])
      continue
    }
    await client.query('SELECT * FROM app.save_chapter_setup($1,NULL,0,$2,$3)', [
      siteId,
      row.slug,
      JSON.stringify(row.config),
    ])
  }
}

/** A fresh offline demo has no approved chapter photo pack. Leave optional
 * pictures unselected; never rewrite authored or already released pages. */
export async function prepareEchelonDemoPhotos(client: Queryable, siteId: string): Promise<number> {
  const initial = (
    await client.query('SELECT initial_release_required AND chapters_enabled AS prepare FROM sites WHERE id=$1', [
      siteId,
    ])
  ).rows[0]?.prepare
  if (!initial) return 0
  const pages = (
    await client.query<{ id: string; revision: string; content: SectionInstance[]; meta: unknown }>(
      `SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id
     WHERE p.site_id=$1 AND p.archived_at IS NULL AND p.published_version_id IS NULL AND p.revision=1 ORDER BY p.id`,
      [siteId],
    )
  ).rows
  let changed = 0
  for (const page of pages) {
    const content = page.content.map(section => ({ ...section, values: withEchelonMedia(section.values, {}) }))
    if (isDeepStrictEqual(content, page.content)) continue
    await client.query(
      "SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint','Left optional demo pictures unselected')",
      [page.id, page.revision, JSON.stringify(content), JSON.stringify(page.meta)],
    )
    changed++
  }
  return changed
}
