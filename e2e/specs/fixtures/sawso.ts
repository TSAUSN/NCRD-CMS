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
