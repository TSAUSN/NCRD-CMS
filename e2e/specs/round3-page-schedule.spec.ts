import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { signIn } from './helpers.ts'
test('page editor saves before Schedule, reviews only that page, and keeps publication private until the timer', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const pool = new Pool({
      connectionString: `postgres://cms:cms@127.0.0.1:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
    }),
    c = await pool.connect(),
    worker = 'page-schedule-' + randomUUID(),
    folder = resolve('../.r8-progress/round3/page-schedule/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let pageId = '',
    siteId = ''
  try {
    await c.query('BEGIN')
    const actor = (await c.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    siteId = (await c.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const def = (
        await c.query(
          "SELECT d.id,max(v.version) AS current_version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='hero' AND d.site_id IS NULL GROUP BY d.id",
        )
      ).rows[0]!,
      content = (heading: string) =>
        JSON.stringify([
          {
            section_def_id: def.id,
            section_def_version: def.current_version,
            values: { heading, intro: '[Local scheduling description]' },
            hidden: false,
            hidden_at: [],
            label: 'Hero',
          },
        ])
    pageId = (
      await c.query('SELECT app.create_page($1,$2,$3) AS id', [
        siteId,
        'schedule-' + randomUUID().slice(0, 8),
        '[Schedule page]',
      ])
    ).rows[0]!.id
    await c.query('SELECT app.save_page_draft($1,0,$2,$3)', [
      pageId,
      content('[Before scheduling]'),
      JSON.stringify({ description: '[Local page description]' }),
    ])
    await c.query("SELECT app.publish_page($1,1,2,NULL,'[]')", [pageId])
    await c.query('SELECT app.save_page_draft($1,2,$2,$3)', [
      pageId,
      content('[Saved draft]'),
      JSON.stringify({ description: '[Local page description]' }),
    ])
    await c.query('COMMIT')
    await pool.query("INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','synthetic-e2e')", [worker])
    const pulse = setInterval(() => {
      void pool.query('UPDATE job_heartbeats SET last_seen_at=now() WHERE worker_id=$1', [worker]).catch(() => {})
    }, 5000)
    try {
      await signIn(page, 'editor@example.test')
      await page.goto('/pages/' + pageId + '?section=0')
      await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Schedule', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
      const capture = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 900 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
        }
      }
      await capture('editor-actions')
      await page.getByLabel('Heading', { exact: true }).fill('[Chosen scheduled heading]')
      await page.getByRole('button', { name: 'Schedule', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Publish later', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('1 selected change')
      await capture('schedule-review')
      const releaseId = new URL(page.url()).searchParams.get('release')!,
        release = (await pool.query('SELECT status,snapshot FROM site_releases WHERE id=$1', [releaseId])).rows[0]!,
        head = (await pool.query('SELECT draft_version_id,published_version_id FROM pages WHERE id=$1', [pageId]))
          .rows[0]!
      expect(release.status).toBe('planned')
      expect(release.snapshot).toHaveLength(1)
      expect(release.snapshot[0]).toMatchObject({ type: 'page', id: pageId, versionId: head.draft_version_id })
      expect(head.draft_version_id).not.toBe(head.published_version_id)
      expect(
        (await pool.query('SELECT count(*)::int AS n FROM scheduled_actions WHERE item_id=$1', [releaseId])).rows[0]!.n,
      ).toBe(0)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await page.getByRole('button', { name: 'Publish later…', exact: true }).click()
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Tomorrow 9:00 AM', exact: true }).click()
      await dialog.getByRole('button', { name: 'Schedule selected changes', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('Scheduling request saved')
      const job = (await pool.query('SELECT id,status FROM scheduled_actions WHERE item_id=$1', [releaseId])).rows[0]!
      expect(job.status).toBe('pending')
      expect(
        (await pool.query('SELECT published_version_id FROM pages WHERE id=$1', [pageId])).rows[0]!
          .published_version_id,
      ).toBe(head.published_version_id)
      const contributor = await browser.newContext({ baseURL: new URL(page.url()).origin })
      try {
        const view = await contributor.newPage()
        await signIn(view, 'contributor@example.test')
        await view.goto('/pages/' + pageId)
        await expect(view.getByRole('button', { name: 'Schedule', exact: true })).toHaveCount(0)
        await expect(view.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
        await expect(view.getByRole('button', { name: 'Submit for review', exact: true })).toBeVisible()
      } finally {
        await contributor.close()
      }
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE cms_authenticated_user')
      await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
      await c.query('SELECT app.cancel_page_schedule($1)', [job.id])
      await c.query('COMMIT')
    } finally {
      clearInterval(pulse)
    }
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [worker])
    if (pageId) await pool.query('UPDATE pages SET archived_at=now() WHERE id=$1', [pageId])
    c.release()
    await pool.end()
  }
})
