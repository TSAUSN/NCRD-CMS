import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
test('World View hub previews owned settings, survives errors and adds one private section only after confirmation', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/world-hub/' + info.project.name),
    email = 'world-' + randomUUID().slice(0, 8) + '@example.test'
  await mkdir(folder, { recursive: true })
  let sourceReads = 0
  await page.route('https://sawso.org/**', async route => {
    sourceReads++
    await route.abort()
  })
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const editor = (await f.client.query('SELECT app.provision_user($1,$2) AS id', [email, '[Name]'])).rows[0]!.id
    await f.client.query("SELECT app.set_site_membership($1,$2,'editor')", [editor, f.siteId])
    await f.client.query('COMMIT')
    const target = (
        await f.pool.query(
          "SELECT p.id,p.revision,p.published_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug=''",
          [f.siteId],
        )
      ).rows[0]!,
      base = '/sites/' + f.siteId + '/stories',
      frame = page.frameLocator('iframe[title="World View draft preview"]')
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 1000 })
        await expect
          .poll(() =>
            page
              .locator('iframe[title="World View draft preview"]')
              .evaluate(
                el => Math.abs(el.getBoundingClientRect().width - el.parentElement!.parentElement!.clientWidth) < 2,
              ),
          )
          .toBe(true)
        await expect(frame.locator('[data-cms-stories-widget]')).toBeVisible()
        await expect(page.getByText('Loading preview…', { exact: true })).toBeHidden()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), fullPage: true })
      }
    }
    await signIn(page, 'root@example.test')
    await page.goto(base)
    await page.getByRole('link', { name: 'World View', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'World View section', exact: true })).toBeVisible()
    await capture('default')
    await page.getByLabel('Heading above the map', { exact: true }).fill('[Chosen map heading]')
    await page.getByLabel('Region shown when the page opens', { exact: true }).selectOption('africa')
    await page.getByLabel('Stories per region', { exact: true }).selectOption('3')
    await page.locator('details').getByText('All', { exact: true }).click()
    await page.getByLabel('Health', { exact: true }).check()
    await page.getByLabel('Only these project sectors', { exact: true }).click()
    await expect(frame.getByRole('heading', { name: 'Our Stories from Africa', exact: true })).toBeVisible()
    await expect(frame.locator('.core-story-card')).toHaveCount(3)
    await capture('configured')
    await frame.locator('a.cms-story-map-region[data-cms-story-region=asia]').focus()
    await frame.locator('a.cms-story-map-region[data-cms-story-region=asia]').press('Enter')
    await expect(frame.getByRole('heading', { name: 'Our Stories from Asia', exact: true })).toBeVisible()
    await frame.getByRole('link', { name: 'Read More', exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Back to map preview', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Back to map preview', exact: true }).click()
    await expect(frame.getByRole('heading', { name: 'Our Stories from Africa', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Heading above the map', { exact: true })).toHaveValue('[Chosen map heading]')
    await expect(frame.getByRole('heading', { name: '[Chosen map heading]', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Add to a page…', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add World View to a page', exact: true })
    await expect(dialog.getByLabel('Page', { exact: true })).toBeEnabled()
    await dialog.getByLabel('Page', { exact: true }).selectOption(target.id)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: resolve(folder, 'page-picker-1440.png') })
    await page.setViewportSize({ width: 1024, height: 1000 })
    await page.screenshot({ path: resolve(folder, 'page-picker-1024.png') })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect((await f.pool.query('SELECT revision FROM pages WHERE id=$1', [target.id])).rows[0]!.revision).toBe(
      target.revision,
    )
    await page.getByRole('button', { name: 'Add to a page…', exact: true }).click()
    await dialog.getByLabel('Page', { exact: true }).selectOption(target.id)
    await dialog.getByRole('button', { name: 'Add as draft', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Open page', exact: true })).toHaveAttribute(
      'href',
      '/pages/' + target.id,
    )
    await capture('added')
    const after = (
      await f.pool.query(
        'SELECT p.revision,p.published_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [target.id],
      )
    ).rows[0]!
    expect(after.content.slice(0, -1)).toEqual(target.content)
    expect(after.content.at(-1).values).toMatchObject({
      heading: '[Chosen map heading]',
      start_region: 'africa',
      per_region: '3',
      stories: { selection: { storyTags: { main: ['health'], secondary: [] } } },
    })
    expect(after.published_version_id).toBe(target.published_version_id)
    expect(Number(after.revision)).toBe(Number(target.revision) + 1)
    await page.route('**/preview/stories/**', route =>
      route.fulfill({ status: 503, contentType: 'text/html', body: '<p>Preview unavailable</p>' }),
    )
    await page.getByLabel('Stories per region', { exact: true }).selectOption('6')
    await expect(
      page.getByText('The preview could not be opened. Your choices are still here.', { exact: false }),
    ).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: resolve(folder, 'preview-error-' + width + '.png') })
    }
    await page.unroute('**/preview/stories/**')
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(frame.locator('[data-cms-stories-widget]')).toBeVisible()
    const restricted = await browser.newContext(),
      view = await restricted.newPage()
    try {
      await signIn(view, email)
      await view.goto(base + '?view=world')
      await expect(view.getByRole('button', { name: 'Add to a page…', exact: true })).toHaveCount(0)
      await expect(view.getByRole('link', { name: 'Manage tags', exact: true })).toHaveCount(0)
      await expect(view.getByText('A Site admin can add this section to a page.', { exact: true })).toBeVisible()
      await expect(
        view.frameLocator('iframe[title="World View draft preview"]').locator('[data-cms-stories-widget]'),
      ).toBeVisible()
      for (const width of [1440, 1024]) {
        await view.setViewportSize({ width, height: 1000 })
        await view.screenshot({ path: resolve(folder, 'editor-role-' + width + '.png') })
      }
      await restricted.clearCookies()
      await signIn(view, 'editor@example.test')
      expect((await view.request.get('/preview/stories/' + f.siteId + '?widget=world')).status()).toBe(404)
    } finally {
      await restricted.close()
    }
    expect(sourceReads).toBe(0)
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
