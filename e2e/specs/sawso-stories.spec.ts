import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
test('a new site admin checks story coverage, tags a story, publishes it and removes the tag', async ({
  page,
  browser,
}) => {
  test.setTimeout(240000)
  const f = await sawsoFixture(true, true),
    email = 'stories-' + randomUUID().slice(0, 8) + '@example.test',
    folder = resolve('../.r8-progress/sawso/stories')
  await mkdir(folder, { recursive: true })
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const admin = (await f.client.query('SELECT app.provision_user($1,$2) AS id', [email, 'Story admin (sample)']))
      .rows[0]!.id
    await f.client.query('SELECT app.set_site_membership($1,$2,$3)', [admin, f.siteId, 'site_admin'])
    await f.client.query('UPDATE app_users SET auth_subject=$1 WHERE id=$2', ['local|' + email, admin])
    await f.client.query('COMMIT')
    await signIn(page, email)
    const base = '/sites/' + f.siteId + '/stories',
      title = 'Primary Health Care to Support the Growing Chikankata Community'
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      }
      await page.setViewportSize({ width: 1440, height: 900 })
    }
    await page.goto(base)
    await expect(page.locator('[data-story-id]')).toHaveCount(34)
    await expect(page.getByText('0 live · 34 need review · Feed not checked yet', { exact: true })).toBeVisible()
    await expect(page.getByText('These tags decide which pages show each story.', { exact: true })).toBeVisible()
    await capture('all')
    await page
      .getByRole('navigation', { name: 'Story views', exact: true })
      .getByRole('link', { name: 'Overview', exact: true })
      .click()
    for (const [label, count] of [
      ['Disaster Relief & Recovery', 17],
      ['Health', 11],
      ['Education', 7],
      ['Business & Economic Development', 5],
      ['Anti-Human Trafficking', 3],
      ['Capacity Building', 1],
      ['Family Care', 0],
      ['Livelihoods', 0],
    ] as const)
      await expect(page.getByRole('progressbar', { name: label + ' current stories' })).toHaveAttribute(
        'aria-valuenow',
        String(count),
      )
    await capture('gaps')
    await page.getByText('Leaving soon', { exact: true }).click()
    await expect(page.getByText(/13 months within 30 days/)).toBeVisible()
    await capture('soon')
    await page
      .getByRole('navigation', { name: 'Story views', exact: true })
      .getByRole('link', { name: 'Stories', exact: true })
      .click()
    await page.getByRole('link', { name: title, exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Details', exact: true })).toBeVisible()
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(title)
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(
      page.frameLocator('iframe[title="Saved story preview"]').getByRole('heading', { level: 1 }),
    ).toHaveText(title, { timeout: 30000 })
    await page
      .getByRole('dialog', { name: 'Saved story preview', exact: true })
      .getByRole('button', { name: 'Done', exact: true })
      .click()
    await capture('details')
    const publish = async () => {
      await page.getByRole('main').getByRole('button', { name: 'Publish', exact: true }).click()
      const first = page.getByRole('button', { name: 'Review first site publication', exact: true })
      await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true }).or(first)).toBeVisible({
        timeout: 90000,
      })
      if (await first.isVisible()) {
        await first.click()
        await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
        await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible({
          timeout: 90000,
        })
      }
      const button = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
      const sample = page.getByRole('checkbox', { name: /Publish with sample content/ })
      if (await sample.isVisible()) await sample.check()
      const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
      if (await reason.isVisible()) await reason.fill('Reviewing local sample Story changes and their feed pages.')
      await button.click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 60000 })
    }
    await page.getByRole('button', { name: 'Education', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Education', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Story draft saved')
    const detail = page.url()
    await publish()
    const context = await browser.newContext({ javaScriptEnabled: false }),
      view = await context.newPage(),
      origin = 'http://' + f.hostname + `:${E2E_PORTS.site}`
    try {
      for (const path of ['/ways-we-help/education', '/newsroom?sector=education']) {
        await view.goto(origin + path)
        await expect(view.getByRole('heading', { name: title, exact: true })).toBeVisible()
      }
      await page.goto(detail)
      await page.getByRole('button', { name: 'Education', exact: true }).click()
      await page.getByRole('button', { name: 'Save draft', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('Story draft saved')
      await publish()
      for (const path of ['/ways-we-help/education', '/newsroom?sector=education']) {
        await view.goto(origin + path)
        await expect(view.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
      }
    } finally {
      await context.close()
    }
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
