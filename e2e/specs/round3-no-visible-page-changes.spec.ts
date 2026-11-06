import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'

test('a saved link with unchanged words stays Live and Publish explains its lack of visible changes', async ({
  page,
}, info) => {
  const f = await siteLookFixture(),
    c = await f.pool.connect()
  try {
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    async function save(changed: boolean) {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE cms_authenticated_user')
      await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
      const row = (
        await c.query(
          'SELECT p.revision,p.published_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.pages[0]],
        )
      ).rows[0]!
      row.content[0].values.__cms_data_values = {
        heading: { parts: [{ text: changed ? 'Updated welcome' : 'Welcome' }] },
      }
      await c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
        f.pages[0],
        row.revision,
        JSON.stringify(row.content),
        JSON.stringify(row.meta),
      ])
      await c.query('COMMIT')
      return row.published_version_id
    }
    const live = await save(false)
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site)
    const row = page
      .getByRole('table', { name: 'Pages', exact: true })
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: 'Welcome', exact: true }) })
    await expect(row.getByText('Live', { exact: true })).toBeVisible()
    await expect(row.getByText('Changes not live', { exact: true })).toHaveCount(0)
    const folder = resolve('../.r8-progress/round3/no-visible-page-changes/' + info.project.name)
    await mkdir(folder, { recursive: true })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: resolve(folder, 'overview-' + width + '.png') })
    }
    await page.goto('/sites/' + f.site + '/publishing')
    const change = page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: 'Welcome', exact: true }) })
    await expect(change).toContainText('No visible page changes')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: resolve(folder, 'publish-' + width + '.png') })
    }
    await save(true)
    await page.goto('/sites/' + f.site)
    await expect(row.getByText('Changes not live', { exact: true })).toBeVisible()
    expect(
      (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!.published_version_id,
    ).toBe(live)
  } finally {
    await c.query('ROLLBACK')
    c.release()
    await f.pool.end()
  }
})
