import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
test('Split View hub uses the real three-view preview, keeps choices and safely appends a private section through conflict recovery', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/split-hub/' + info.project.name),
    email = 'split-' + randomUUID().slice(0, 8) + '@example.test'
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
      frame = page.frameLocator('iframe[title="Split View draft preview"]')
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 1000 })
        await expect(frame.locator('[data-cms-story-kind=split]')).toBeVisible()
        await expect(page.getByText('Loading preview…', { exact: true })).toBeHidden()
        await expect
          .poll(() =>
            page
              .locator('iframe[title="Split View draft preview"]')
              .evaluate(
                el => Math.abs(el.getBoundingClientRect().width - el.parentElement!.parentElement!.clientWidth) < 2,
              ),
          )
          .toBe(true)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), fullPage: true })
      }
    }
    await signIn(page, 'root@example.test')
    await page.goto(base)
    await page.getByRole('link', { name: 'Split View', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Split View section', exact: true })).toBeVisible()
    await expect(frame.locator('.core-story-card')).toHaveCount(12)
    await capture('recent')
    expect(
      await page
        .locator('iframe[title="Split View draft preview"]')
        .evaluate(el => el.parentElement!.parentElement!.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(561)
    await page.getByLabel('Heading', { exact: true }).fill('[Split heading]')
    await page.getByLabel('Introduction', { exact: true }).fill('[Introduction]')
    await page.getByLabel('View shown first', { exact: true }).selectOption('sectors')
    await page.getByLabel('Stories per "Show more"', { exact: true }).selectOption('6')
    await expect(frame.locator('.core-split-sector')).not.toHaveCount(0)
    await capture('sector')
    await page.getByLabel('View shown first', { exact: true }).selectOption('map')
    await expect(frame.locator('.cms-story-map')).toBeVisible()
    await capture('map')
    await page.getByLabel('View shown first', { exact: true }).selectOption('recent')
    await expect(frame.locator('.core-story-card')).toHaveCount(6)
    await page.reload()
    await expect(page.getByLabel('Heading', { exact: true })).toHaveValue('[Split heading]')
    await expect(frame.locator('.core-story-card')).toHaveCount(6)
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const full = page.getByRole('dialog', { name: 'Preview Split View', exact: true })
    await expect(full.locator('iframe')).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect(
        page.frameLocator('iframe[title="Split View full preview"]').locator('.core-story-card'),
      ).toHaveCount(6)
      await page.screenshot({ path: resolve(folder, 'preview-dialog-' + width + '.png') })
    }
    await full.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(full).toHaveCount(0)
    await page.getByRole('button', { name: 'Add to a page…', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add Split View to a page', exact: true })
    await dialog.getByLabel('Page', { exact: true }).selectOption(target.id)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await f.pool.query('SELECT revision FROM pages WHERE id=$1', [target.id])).rows[0]!.revision).toBe(
      target.revision,
    )
    await page.getByRole('button', { name: 'Add to a page…', exact: true }).click()
    await dialog.getByLabel('Page', { exact: true }).selectOption(target.id)
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const changedMeta = { ...target.meta, description: '[Changed elsewhere]' }
    await f.client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      target.id,
      target.revision,
      JSON.stringify(target.content),
      JSON.stringify(changedMeta),
    ])
    await f.client.query('COMMIT')
    await dialog.getByRole('button', { name: 'Add as draft', exact: true }).click()
    await expect(
      dialog.getByText('This page changed. Reload the page choices before adding the section.', { exact: false }),
    ).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: resolve(folder, 'page-conflict-' + width + '.png') })
    }
    await dialog.getByRole('button', { name: 'Reload page choices', exact: true }).click()
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
        'SELECT p.published_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [target.id],
      )
    ).rows[0]!
    expect(after.content.slice(0, -1)).toEqual(target.content)
    expect(after.meta).toEqual(changedMeta)
    expect(after.published_version_id).toBe(target.published_version_id)
    expect(after.content.at(-1).values).toMatchObject({
      heading: '[Split heading]',
      introduction: '[Introduction]',
      start_view: 'recent',
      page_size: '6',
    })
    await page.route('**/preview/stories/**', route =>
      route.fulfill({ status: 503, contentType: 'text/html', body: '<p>Unavailable</p>' }),
    )
    await page.getByLabel('Stories per "Show more"', { exact: true }).selectOption('9')
    await expect(
      page.getByText('The preview could not be opened. Your choices are still here.', { exact: false }),
    ).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: resolve(folder, 'preview-error-' + width + '.png') })
    }
    await page.unroute('**/preview/stories/**')
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(frame.locator('.core-story-card')).toHaveCount(9)
    const restricted = await browser.newContext(),
      view = await restricted.newPage()
    try {
      await signIn(view, email)
      await view.goto(base + '?view=split')
      await expect(view.getByRole('button', { name: 'Add to a page…', exact: true })).toHaveCount(0)
      await expect(view.getByRole('link', { name: 'Manage tags', exact: true })).toHaveCount(0)
      await expect(
        view.frameLocator('iframe[title="Split View draft preview"]').locator('.core-story-card'),
      ).toHaveCount(12)
      for (const width of [1440, 1024]) {
        await view.setViewportSize({ width, height: 1000 })
        await view.screenshot({ path: resolve(folder, 'editor-role-' + width + '.png') })
      }
      await restricted.clearCookies()
      await signIn(view, 'editor@example.test')
      expect((await view.request.get('/preview/stories/' + f.siteId + '?widget=split')).status()).toBe(404)
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
