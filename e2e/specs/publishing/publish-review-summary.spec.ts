import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'

test('a large selected review stays compact in Publish and Publish later, with all page previews behind one disclosure', async ({
  page,
}, info) => {
  test.setTimeout(180000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    worker = 'review-summary-' + randomUUID()
  let pulse: ReturnType<typeof setInterval> | undefined
  try {
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const source = (
      await c.query(
        'SELECT content,meta FROM page_versions WHERE id=(SELECT draft_version_id FROM pages WHERE id=$1)',
        [f.pages[0]],
      )
    ).rows[0]!
    for (let i = 1; i <= 48; i++) {
      const id = (await c.query('SELECT app.create_page($1,$2,$3) AS id', [f.site, 'review-' + i, 'Review page ' + i]))
        .rows[0]!.id
      await c.query('SELECT app.save_page_draft($1,0,$2,$3)', [
        id,
        JSON.stringify(source.content),
        JSON.stringify(source.meta),
      ])
    }
    await c.query('COMMIT')
    await f.pool.query("INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','synthetic-e2e')", [
      worker,
    ])
    pulse = setInterval(() => {
      void f.pool.query('UPDATE job_heartbeats SET last_seen_at=now() WHERE worker_id=$1', [worker]).catch(() => {})
    }, 5000)
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/publishing')
    await page.getByRole('button', { name: /^Publish selected \(/ }).click()
    const review = page.getByLabel('Selected changes review', { exact: true })
    await expect(review.getByRole('status')).toHaveText(/50 pages checked, all ready/)
    await expect(review.getByRole('link', { name: 'Preview all selected changes', exact: true })).toHaveCount(1)
    await expect(review.getByText('Ready to publish.', { exact: true })).toHaveCount(0)
    const checked = review.locator('details').filter({ hasText: 'Checked pages (50)' })
    await expect(checked).not.toHaveAttribute('open', '')
    await checked.locator('summary').click()
    await expect(checked.getByRole('link', { name: 'Review page 48', exact: true })).toBeVisible()
    await checked.locator('summary').click()
    const folder = resolve('../.r8-progress/round3/publish-review-summary/' + info.project.name)
    await mkdir(folder, { recursive: true })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await review.scrollIntoViewIfNeeded()
      await page.screenshot({ path: resolve(folder, 'review-' + width + '.png') })
    }
    await review.getByRole('button', { name: 'Publish later…', exact: true }).click()
    const later = page.getByRole('dialog', { name: 'Publish later', exact: true })
    await expect(later.getByRole('status')).toHaveText('50 pages checked, all ready')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: resolve(folder, 'later-' + width + '.png') })
    }
    await later.getByRole('button', { name: 'Cancel', exact: true }).click()
  } finally {
    if (pulse) clearInterval(pulse)
    await c.query('ROLLBACK')
    await f.pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [worker])
    c.release()
    await f.pool.end()
  }
})
