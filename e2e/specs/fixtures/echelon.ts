import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { echelonSiteSetup } from '@cms/seeds/echelon-site'
import { createSiteFromSetupInTransaction } from '../../../apps/admin/src/lib/site-creation.ts'
import { ensureEchelonChapterSetups, prepareEchelonDemoPhotos } from '../../../apps/admin/src/lib/echelon-site.ts'
import { ensureChapterDemoPages } from '../../../apps/admin/src/lib/chapters.ts'
export async function echelonFixture(withChapters = false, withSetups = true, offlineDemoPhotos = false) {
  const pool = new Pool({
      connectionString: `postgres://cms:cms@127.0.0.1:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
    }),
    client = await pool.connect()
  try {
    await client.query('BEGIN')
    const actor = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query('SET LOCAL ROLE cms_authenticated_user')
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    await installCoreLibrary(client)
    const setup = { ...echelonSiteSetup(), slug: 'ech-' + randomUUID().slice(0, 8) },
      site = await createSiteFromSetupInTransaction(client, randomUUID(), setup, setup.slug + '.staging.localhost')
    await client.query('SELECT app.enable_chapters($1)', [site.siteId])
    if (withSetups) await ensureEchelonChapterSetups(client, site.siteId)
    const nav = (
      await client.query(
        'SELECT n.revision,v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
        [site.siteId],
      )
    ).rows[0]!
    await client.query("SELECT * FROM app.save_navigation_draft($1,$2,$3,'manual')", [
      site.siteId,
      nav.revision,
      JSON.stringify(nav.tree),
    ])
    if (offlineDemoPhotos) await prepareEchelonDemoPhotos(client, site.siteId)
    if (withChapters) await ensureChapterDemoPages(client, site.siteId)
    const pages = (await client.query('SELECT id,slug FROM pages WHERE site_id=$1', [site.siteId])).rows
    await client.query('COMMIT')
    // Removing fixture image files must not leave an active Home card pointing at them.
    async function archive() {
      await pool.query("UPDATE sites SET status='archived',archived_at=COALESCE(archived_at,now()) WHERE id=$1", [
        site.siteId,
      ])
    }
    return { pool, client, actor, site: site.siteId, hostname: site.hostname, pages, archive }
  } catch (error) {
    await client.query('ROLLBACK')
    client.release()
    await pool.end()
    throw error
  }
}
