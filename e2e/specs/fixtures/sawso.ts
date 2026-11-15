import { ensureSawsoRedirects } from '../../../apps/admin/src/lib/redirects.ts'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { ensureSawsoFrame } from '../../../apps/admin/src/lib/sawso-frame.ts'
import { ensureSawsoPublicPages } from '../../../apps/admin/src/lib/sawso-pages.ts'
import { ensureSawsoCorePages } from '../../../apps/admin/src/lib/sawso-pages.ts'
import { ensureSawsoSite } from '../../../apps/admin/src/lib/sawso-site.ts'
export async function sawsoFixture(core = false, publicPages = false, storyReferenceDay?: string) {
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
    // Coverage journeys retain their reviewed timeline as the calendar moves.
    // Only this disposable fixture changes; approved source dates stay immutable.
    if (storyReferenceDay) {
      const today = new Date().toISOString().slice(0, 10)
      const offset = Date.parse(today) - Date.parse(storyReferenceDay)
      if (!Number.isFinite(offset)) throw new Error('Use an ISO day for the story fixture timeline.')
      const head = (await client.query('SELECT entry_revision FROM collections WHERE id=$1', [site.collectionId]))
        .rows[0]!
      const rows = (
        await client.query(
          'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index,e.id',
          [site.collectionId],
        )
      ).rows
      await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        site.collectionId,
        head.entry_revision,
        JSON.stringify(
          rows.map(row => ({
            id: row.id,
            stableKey: row.stable_key,
            values: {
              ...row.values,
              published_date: new Date(Date.parse(row.values.published_date) + offset).toISOString().slice(0, 10),
            },
          })),
        ),
      ])
    }
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
