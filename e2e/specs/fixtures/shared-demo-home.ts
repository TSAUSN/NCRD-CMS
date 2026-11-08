import { test as base } from '@playwright/test'
import { Client } from 'pg'
import { e2eTarget } from '../../test-target.ts'

interface PageHead {
  id: string
  site_id: string
  draft_version_id: string | null
  published_version_id: string | null
  status: string
}

interface SharedDemoHome {
  afterRestore(check: () => Promise<void>): void
}

export const test = base.extend<{ sharedDemoHome: SharedDemoHome }>({
  sharedDemoHome: [
    async ({}, use) => {
      const { database, host, port } = e2eTarget()
      const client = new Client({
        connectionString: `postgres://cms:cms@${host}:${port}/${database}`,
        statement_timeout: 5000,
      })
      await client.connect()
      const checks: Array<() => Promise<void>> = []
      try {
        const page = (
          await client.query<PageHead>(
            `SELECT p.id,p.site_id,p.draft_version_id,p.published_version_id,p.status
               FROM pages p JOIN sites s ON s.id=p.site_id WHERE s.slug='demo' AND p.slug=''`,
          )
        ).rows[0]
        if (!page) throw new Error('The seeded Demo home page is missing.')
        const route = (
          await client.query<{ receipt: string }>(
            "SELECT row_to_json(r)::text AS receipt FROM published_routes r WHERE site_id=$1 AND path='/'",
            [page.site_id],
          )
        ).rows[0]?.receipt

        try {
          await use({ afterRestore: check => checks.push(check) })
        } finally {
          // Playwright tears down the browser fixtures first, so a closed editor
          // cannot autosave over the restored head after a failed assertion.
          await client.query('BEGIN')
          try {
            await client.query(
              `UPDATE pages SET draft_version_id=$2,published_version_id=$3,status=$4,revision=revision+1
                WHERE id=$1 AND (draft_version_id,published_version_id,status)
                IS DISTINCT FROM ($2::uuid,$3::uuid,$4::page_status)`,
              [page.id, page.draft_version_id, page.published_version_id, page.status],
            )
            if (route) {
              await client.query(
                `INSERT INTO published_routes SELECT * FROM json_populate_record(NULL::published_routes,$1)
                   ON CONFLICT (site_id,path) DO UPDATE SET
                     page_id=EXCLUDED.page_id,page_version_id=EXCLUDED.page_version_id,
                     shell_revision=EXCLUDED.shell_revision,render_manifest=EXCLUDED.render_manifest,
                     updated_at=EXCLUDED.updated_at
                   WHERE published_routes.page_version_id IS DISTINCT FROM EXCLUDED.page_version_id`,
                [route],
              )
            } else {
              await client.query("DELETE FROM published_routes WHERE site_id=$1 AND path='/'", [page.site_id])
            }
            await client.query('COMMIT')
          } catch (error) {
            await client.query('ROLLBACK')
            throw error
          }
          for (const check of checks) await check()
        }
      } finally {
        await client.end()
      }
    },
    { auto: true },
  ],
})
