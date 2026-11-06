import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { echelonFixture } from './fixtures/echelon.ts'
import { signIn, canvas } from './helpers.ts'
import { rawRequest } from './http.ts'
test.use({ actionTimeout: 15000 })
test('chapter setup preserves page content and publishes social-first and first-eight layouts through normal page releases', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000)
  const setup = await echelonFixture(true, true, true),
    { pool, client, site, pages } = setup,
    folder = resolve('../.r8-progress/echelon/chapters')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      if (name.startsWith('editor')) {
        await expect(page.locator('.canvas-loading')).toHaveCount(0)
        if (name.startsWith('editor-phone')) {
          const visitorView = page.getByRole('button', { name: 'Preview without hidden', exact: true })
          if ((await visitorView.count()) && (await visitorView.isEnabled())) {
            await visitorView.click()
            await expect(visitorView).toBeDisabled()
          }
          await expect(canvas(page).locator('[data-cms-hidden]')).toHaveCount(0)
          await expect(page.locator('.canvas-loading')).toHaveCount(0)
          await expect
            .poll(() =>
              canvas(page)
                .locator('html')
                .evaluate(node => node.clientWidth),
            )
            .toBe(390)
          if (name === 'editor-phone-boston') {
            await expect(canvas(page).locator('.core-chapter-board')).toHaveCount(0)
            await expect(canvas(page).getByRole('heading', { name: 'This year’s events', exact: true })).toHaveCount(0)
          }
        }
        await canvas(page)
          .locator('html')
          .evaluate(() => document.fonts.ready)
      }
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }

  const openPublish = async (titles: string[], includeShared = false) => {
    await page.getByRole('link', { name: 'Publish', exact: true }).click()
    const workspace = page.getByRole('region', { name: 'Changes ready to publish', exact: true })
    await expect(workspace).toBeVisible()
    for (const choice of await workspace.getByRole('checkbox').all()) await choice.uncheck()
    const table = workspace.getByRole('table', { name: 'Saved changes ready to publish', exact: true })
    for (const title of titles) await table.getByRole('checkbox', { name: title, exact: true }).check()
    if (includeShared)
      for (const row of await table.locator('tbody tr').all()) {
        const group = await row.locator('th small').textContent()
        if (group === 'Lists' || group === 'Site look') await row.getByRole('checkbox').check()
      }
  }

  try {
    await mkdir(folder, { recursive: true })
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + site + '/chapters')
    await expect(page.getByRole('table', { name: 'Chapters', exact: true }).locator('tbody tr')).toHaveCount(43)
    await capture('workspace')
    await page
      .getByRole('row')
      .filter({ hasText: 'North Texas Chapter' })
      .getByRole('button', { name: 'North Texas Chapter', exact: true })
      .click()
    await page
      .getByRole('dialog', { name: 'North Texas Chapter', exact: true })
      .getByRole('button', { name: 'Set up', exact: true })
      .click()
    await capture('setup-chapter')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByLabel('Board layout', { exact: true })).toHaveValue('first-eight')
    await page.getByLabel('Board layout', { exact: true }).selectOption('all')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await capture('setup-people')
    await page.getByRole('button', { name: 'Save chapter', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Set up North Texas Chapter', exact: true })).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('Chapter saved as a draft')
    await page
      .getByRole('row')
      .filter({ hasText: 'North Texas Chapter' })
      .getByRole('button', { name: 'North Texas Chapter', exact: true })
      .click()
    await page
      .getByRole('dialog', { name: 'North Texas Chapter', exact: true })
      .getByRole('button', { name: 'Set up', exact: true })
      .click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByLabel('Board layout', { exact: true })).toHaveValue('all')
    await page.getByLabel('Board layout', { exact: true }).selectOption('first-eight')
    await capture('setup-sections')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Save chapter', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Set up North Texas Chapter', exact: true })).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('Chapter saved as a draft')
    const selected = pages
      .filter(row =>
        [
          '',
          'chapters',
          'chapters/peoria',
          'chapters/north-texas',
          'chapters/boston',
          'chapters/indianapolis',
        ].includes(row.slug),
      )
      .map(row => row.id)
    await openPublish(
      ['Home', 'Find a chapter', 'Peoria Chapter', 'North Texas Chapter', 'Boston Chapter', 'Indianapolis Chapter'],
      true,
    )
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Release preview prepared. The live site is unchanged.' }),
    ).toBeVisible({ timeout: 30000 })
    await page.getByRole('checkbox', { name: /Publish with sample content/ }).check()
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    const applying = page.waitForResponse(
      response => response.request().method() === 'POST' && response.url().includes('/sites/' + site + '/publishing'),
    )
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    const applied = await applying
    expect(applied.status()).toBe(200)
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    expect(
      (await pool.query('SELECT id FROM pages WHERE site_id=$1 AND published_version_id IS NOT NULL', [site])).rows
        .map(row => row.id)
        .sort(),
    ).toEqual([...selected].sort())
    const directory = await rawRequest({ host: setup.hostname, path: '/chapters' })
    expect(directory.body).toContain('/chapters/peoria')
    expect(directory.body).not.toContain('/chapters/maryland')
    expect(directory.body).not.toContain('/chapters/rebuilding-sample')
    const visitor = await browser.newContext({ javaScriptEnabled: false }),
      view = await visitor.newPage()
    try {
      for (const slug of ['peoria', 'north-texas', 'boston'])
        for (const width of [1440, 1024, 390]) {
          await view.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
          expect((await view.goto('http://' + setup.hostname + `:${E2E_PORTS.site}/chapters/` + slug))?.status()).toBe(
            200,
          )
          const board = view.locator('.core-chapter-board')
          await expect(board.locator('img')).toHaveCount(0)
          await expect(view.locator('.core-gallery img')).toHaveCount(0)
          if (slug === 'north-texas') {
            await expect(board.locator('article:visible')).toHaveCount(8)
            await expect(board.getByText('Show all 16 board members', { exact: true })).toBeVisible()
          }
          if (slug === 'boston') {
            await expect(board).toHaveCount(0)
            const social = view.getByRole('navigation', { name: 'Related links', exact: true })
            await expect(social).toBeVisible()
            await expect(social.getByRole('link', { name: 'Instagram', exact: true })).toBeVisible()
            await expect(social.getByRole('link', { name: 'Facebook', exact: true })).toBeVisible()
            expect((await view.locator('main h2').allTextContents())[0]).toBe('Connect with our chapter')
            await expect(view.getByRole('heading', { name: 'This year’s events', exact: true })).toHaveCount(0)
          }
          expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await view.screenshot({ path: resolve(folder, slug + '-' + width + '.png'), fullPage: true })
          if (slug === 'north-texas') {
            await board.getByText('Show all 16 board members', { exact: true }).click()
            await expect(board.locator('article:visible')).toHaveCount(16)
            await view.screenshot({ path: resolve(folder, slug + '-expanded-' + width + '.png'), fullPage: true })
          }
        }
    } finally {
      await visitor.close()
    }
    const texas = pages.find(row => row.slug === 'chapters/north-texas')!.id
    const recoveryReady = page.waitForResponse(
      response => response.request().method() === 'GET' && response.url().includes('/api/pages/' + texas + '/recovery'),
    )
    await page.goto('/pages/' + texas)
    expect((await recoveryReady).status()).toBe(200)
    await expect(
      page.getByText('Could not confirm this page and its section versions are available.', { exact: false }),
    ).toHaveCount(0)
    await expect(canvas(page).getByText('Show all 16 board members', { exact: true })).toBeVisible()
    await capture('editor')
    await page.getByRole('button', { name: 'Phone', exact: true }).click()
    await expect(canvas(page).getByText('Show all 16 board members', { exact: true })).toBeVisible()
    await capture('editor-phone')
    for (const slug of ['peoria', 'boston']) {
      await page.goto('/pages/' + pages.find(row => row.slug === 'chapters/' + slug)!.id)
      await page.getByRole('button', { name: 'Phone', exact: true }).click()
      await expect(
        canvas(page).getByRole('heading', {
          level: 1,
          name: slug === 'peoria' ? 'Peoria Chapter' : 'Boston Chapter',
          exact: true,
        }),
      ).toBeVisible()
      expect(
        await canvas(page)
          .locator('html')
          .evaluate(node => node.scrollWidth <= node.clientWidth),
      ).toBe(true)
      await capture('editor-phone-' + slug)
    }
    await page.goto('/sites/' + site + '/chapters')
    await page.getByRole('button', { name: '[A rebuilding chapter]', exact: true }).click()
    await page
      .getByRole('dialog', { name: '[A rebuilding chapter]', exact: true })
      .getByRole('button', { name: 'Set up', exact: true })
      .click()
    await page.getByRole('radio', { name: 'This chapter page', exact: true }).check()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await capture('turn-listing-on')
    await page.getByRole('button', { name: 'Save chapter', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('saved as a draft')
    expect((await rawRequest({ host: setup.hostname, path: '/chapters' })).body).not.toContain(
      '/chapters/rebuilding-sample',
    )
    await openPublish(['[A rebuilding chapter]'])
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Release preview prepared. The live site is unchanged.' }),
    ).toBeVisible({ timeout: 30000 })
    await page.getByRole('checkbox', { name: /Publish with sample content/ }).check()
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    expect((await rawRequest({ host: setup.hostname, path: '/chapters' })).body).toContain(
      '/chapters/rebuilding-sample',
    )
    await page.goto('/sites/' + site + '/chapters')
    await page
      .getByRole('row')
      .filter({ hasText: 'Boston Chapter' })
      .getByRole('button', { name: 'Boston Chapter', exact: true })
      .click()
    await page
      .getByRole('dialog', { name: 'Boston Chapter', exact: true })
      .getByRole('button', { name: 'Set up', exact: true })
      .click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel('This year’s events', { exact: true }).check()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Save chapter', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('saved as a draft')
    expect((await rawRequest({ host: setup.hostname, path: '/chapters/boston' })).body).not.toContain(
      'This year’s events',
    )
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page
      .getByRole('navigation', { name: 'Settings tabs', exact: true })
      .getByRole('link', { name: 'Advanced', exact: true })
      .click()
    const backupLimit = page.getByText('Chapter setup, private contacts and form messages stay in the database.', {
      exact: false,
    })
    await expect(backupLimit).toBeVisible()
    await backupLimit.scrollIntoViewIfNeeded()
    await capture('settings-backup-scope')
    expect(errors).toEqual([])
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    if (site) await pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [site])
    client.release()
    await pool.end()
  }
})
