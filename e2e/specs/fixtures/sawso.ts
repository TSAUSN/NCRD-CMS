import { ensureSawsoRedirects } from '../../../apps/admin/src/lib/redirects.ts'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { ensureSawsoFrame } from '../../../apps/admin/src/lib/sawso-frame.ts'
import { ensureSawsoPublicPages } from '../../../apps/admin/src/lib/sawso-pages.ts'
import { ensureSawsoCorePages } from '../../../apps/admin/src/lib/sawso-pages.ts'
import { ensureSawsoSite } from '../../../apps/admin/src/lib/sawso-site.ts'
export async function sawsoFixture(core = false, publicPages = false) {
  const pool = new Pool({
      connectionString: `postgres://cms:cms@127.0.0.1:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
    }),
    client = await pool.connect()
  try {
    await client.query('BEGIN')
    const actor = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query('SET LOCAL ROLE cms_authenticated_user')
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const site = await ensureSawsoSite(client, randomUUID(), 'sawso-' + randomUUID().slice(0, 8))
    if (core) await ensureSawsoCorePages(client, site.siteId)
    if (publicPages) {
      await ensureSawsoPublicPages(client, site.siteId)
      await ensureSawsoFrame(client, site.siteId)
      await ensureSawsoRedirects(client, site.siteId)
    }
    await client.query('COMMIT')
    return { pool, client, actor, ...site }
  } catch (error) {
    await client.query('ROLLBACK')
    client.release()
    await pool.end()
    throw error
  }
}

/** Reserve the historical slug without altering another test's archived fixture. */
export async function reserveSawsoSlug(pool: Pool, siteId: string): Promise<() => Promise<void>> {
  const client = await pool.connect()
  const parked = 'archived-sawso-' + randomUUID()
  try {
    await client.query('BEGIN')
    const original = (await client.query<{ slug: string }>('SELECT slug FROM sites WHERE id=$1', [siteId])).rows[0]
    if (!original) throw new Error('The temporary site no longer exists.')
    const displaced = (
      await client.query<{ id: string }>(
        "UPDATE sites SET slug=$1 WHERE slug='sawso' AND id<>$2 AND archived_at IS NOT NULL RETURNING id",
        [parked, siteId],
      )
    ).rows[0]
    await client.query("UPDATE sites SET slug='sawso' WHERE id=$1", [siteId])
    await client.query('COMMIT')
    return async () => {
      const restore = await pool.connect()
      try {
        await restore.query('BEGIN')
        await restore.query('UPDATE sites SET slug=$2 WHERE id=$1', [siteId, original.slug])
        if (displaced)
          await restore.query("UPDATE sites SET slug='sawso' WHERE id=$1 AND slug=$2", [displaced.id, parked])
        await restore.query('COMMIT')
      } catch (error) {
        await restore.query('ROLLBACK')
        throw error
      } finally {
        restore.release()
      }
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
