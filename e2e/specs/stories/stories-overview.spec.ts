import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'
test('Overview keeps zero-count tags, separates current and live coverage, links story titles and exposes missing tags and 30-day expiry', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    email = 'coverage-' + randomUUID().slice(0, 8) + '@example.test',
    folder = resolve('../.r8-progress/round3/stories-overview/' + info.project.name)
  await mkdir(folder, { recursive: true })
  const title = 'Primary Health Care to Support the Growing Chikankata Community',
    base = '/sites/' + f.siteId + '/stories'
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const editor = (await f.client.query('SELECT app.provision_user($1,$2) AS id', [email, '[Name]'])).rows[0]!.id
    await f.client.query("SELECT app.set_site_membership($1,$2,'editor')", [editor, f.siteId])
    await f.client.query('UPDATE app_users SET auth_subject=$1 WHERE id=$2', ['local|' + email, editor])
    const head = (await f.client.query('SELECT revision,entry_revision FROM collections WHERE id=$1', [f.collectionId]))
        .rows[0]!,
      rows = (
        await f.client.query(
          'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index,e.id',
          [f.collectionId],
        )
      ).rows,
      untagged = rows.find(row => row.values.title === title)!,
      leaving = rows.find(
        row => row.id !== untagged.id && String(row.values.tags).includes('disaster-relief-recovery'),
      )!,
      date = new Date(Date.now() - 388 * 86400000).toISOString().slice(0, 10)
    const healthTitle = String(
      rows.find(
        row =>
          row.id !== untagged.id &&
          String(row.values.tags).split(',').includes('health') &&
          String(row.values.published_date) >= '2026-01-01',
      )!.values.title,
    )
    const saved = (
      await f.client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        f.collectionId,
        head.entry_revision,
        JSON.stringify(
          rows.map(row => ({
            id: row.id,
            stableKey: row.stable_key,
            values: row.id === leaving.id ? { ...row.values, published_date: date } : row.values,
          })),
        ),
      ])
    ).rows[0]!
    await f.client.query('SELECT * FROM app.publish_collection_schema($1,$2)', [f.collectionId, head.revision])
    await f.client.query('SELECT * FROM app.publish_collection_entries($1,$2)', [f.collectionId, saved.entry_revision])
    const publishedHead = (await f.client.query('SELECT entry_revision FROM collections WHERE id=$1', [f.collectionId]))
      .rows[0]!
    await f.client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      f.collectionId,
      publishedHead.entry_revision,
      JSON.stringify(
        rows.map(row => ({
          id: row.id,
          stableKey: row.stable_key,
          values:
            row.id === untagged.id
              ? { ...row.values, tags: '', region: '', regions: '' }
              : row.id === leaving.id
                ? { ...row.values, published_date: date }
                : row.values,
        })),
      ),
    ])
    await f.client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto(base + '?view=gaps')
    await expect(page.getByRole('table', { name: 'Stories by main tag', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
    const health = page.locator('[data-coverage-id="health"]')
    await expect(health).toHaveAttribute('data-current-count', '10')
    await expect(health).toHaveAttribute('data-live-count', '11')
    await expect(health.getByRole('link', { name: '/ways-we-help/health', exact: true })).toBeVisible()
    await expect(page.locator('[data-coverage-id="family-care"]')).toHaveAttribute('data-current-count', '0')
    await expect(page.locator('[data-coverage-id="livelihoods"]')).toContainText('No stories')
    await expect(page.locator('[data-coverage-id="__none"]')).toContainText('Needs tag')
    await capture('overview')
    await page.getByRole('button', { name: 'Stories tagged Health', exact: true }).click()
    await expect(page.getByRole('link', { name: healthTitle, exact: true })).toBeVisible()
    await capture('titles')
    await page.getByRole('button', { name: 'Stories tagged Family Care', exact: true }).click()
    await expect(
      page.getByText('No current stories carry this tag. Add a story or tag one in Stories.', { exact: true }),
    ).toBeVisible()
    await capture('zero')
    await page.getByRole('button', { name: 'Stories tagged No project sector', exact: true }).click()
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
    await page.getByRole('link', { name: title, exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/stories/' + untagged.id + '$'))
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(title)
    await page.goto(base + '?view=gaps')
    await page.getByText('Leaving soon', { exact: true }).click()
    await expect(page.getByRole('link', { name: String(leaving.values.title), exact: true })).toBeVisible()
    await expect(page.getByText(/Last day in feeds:/).first()).toBeVisible()
    await capture('leaving')
    await page.getByRole('link', { name: 'Review missing tags', exact: true }).click()
    await expect(page.getByRole('article', { name: title, exact: true })).toBeVisible()
    await expect(page.getByRole('article')).toHaveCount(1)
    await capture('missing')
    const restricted = await browser.newContext(),
      view = await restricted.newPage()
    try {
      await signIn(view, email)
      await view.goto(base + '?view=gaps')
      await expect(view.getByRole('table', { name: 'Stories by main tag', exact: true })).toBeVisible()
      await expect(view.getByRole('link', { name: 'Manage tags', exact: true })).toHaveCount(0)
      await restricted.clearCookies()
      await signIn(view, 'editor@example.test')
      expect((await view.goto(base + '?view=gaps'))?.status()).toBe(404)
    } finally {
      await restricted.close()
    }
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
