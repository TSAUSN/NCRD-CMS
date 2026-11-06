import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { echelonFixture } from './fixtures/echelon.ts'
import { echelonFaqContactContent } from '../../packages/seeds/src/echelon-faq-contact.ts'
import { signIn, canvas, publish } from './helpers.ts'
test('Echelon FAQ opens one answer without scripts and its normal-field contact panel keeps existing local message handling', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await echelonFixture(false, false, true),
    folder = resolve('../.r8-progress/round3/echelon-faq-contact/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const defs = (
        await f.client.query(
          "SELECT d.id,d.slug,d.name,v.version,v.slots FROM section_defs d JOIN LATERAL(SELECT version,slots FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.slug IN ('core-echelon-faq','core-echelon-contact','core-page-header')",
        )
      ).rows,
      header = defs.find(row => row.slug === 'core-page-header')!,
      slug = 'faq-contact-' + randomUUID().slice(0, 8),
      id = (await f.client.query('SELECT app.create_page($1,$2,$3) AS id', [f.site, slug, '[Echelon contact]']))
        .rows[0]!.id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      id,
      JSON.stringify([
        {
          section_def_id: header.id,
          section_def_version: header.version,
          values: { heading: '[Echelon contact]', intro: '' },
        },
        ...echelonFaqContactContent('chapter', defs),
      ]),
      JSON.stringify({ description: '[Echelon questions and contact check]' }),
    ])
    await f.client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/publishing')
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('checkbox', { name: /Publish with sample content/ }).check()
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    const live = (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [id])).rows[0]!
        .published_version_id,
      url = 'http://' + f.hostname + `:${E2E_PORTS.site}/` + slug,
      context = await browser.newContext({ javaScriptEnabled: false })
    try {
      const view = await context.newPage()
      for (const width of [1440, 1024, 390]) {
        await view.setViewportSize({ width, height: 950 })
        await view.goto(url)
        await expect(view.locator('.ech-faq-item')).toHaveCount(4)
        await expect(view.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.screenshot({ path: resolve(folder, 'closed-' + width + '.png'), fullPage: true })
        await view.getByText('What is Echelon?', { exact: true }).click()
        await expect(view.locator('.ech-faq-item[open]')).toHaveCount(1)
        await view.getByText('What does Echelon do?', { exact: true }).click()
        await expect(view.locator('.ech-faq-item[open]')).toHaveCount(1)
        await expect(view.locator('.ech-faq-item').first()).not.toHaveAttribute('open')
        await view.screenshot({ path: resolve(folder, 'open-' + width + '.png'), fullPage: true })
      }
      for (const [label, value] of [
        ['First name', '[Name]'],
        ['Last name', '[Name]'],
        ['Email', 'visitor@example.test'],
        ['Phone', '123'],
        ['Message', '[Local Echelon acceptance message]'],
      ])
        await view.getByRole('textbox', { name: label!, exact: true }).fill(value!)
      await view.getByRole('button', { name: 'Send message', exact: true }).click()
      await expect(view.getByRole('status').filter({ hasText: 'Your message has been saved.' })).toBeVisible()
      expect(
        (await f.pool.query('SELECT count(*)::int n FROM contact_messages WHERE site_id=$1', [f.site])).rows[0]!.n,
      ).toBe(1)
    } finally {
      await context.close()
    }
    await page.goto('/pages/' + id + '?section=2')
    await page.locator('.inspector').getByLabel('Introduction', { exact: true }).fill('[Updated Echelon invitation]')
    await expect(canvas(page).getByText('[Updated Echelon invitation]', { exact: true })).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await page.screenshot({ path: resolve(folder, 'editor-' + width + '.png') })
    }
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    expect(
      (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [id])).rows[0]!.published_version_id,
    ).toBe(live)
    await publish(page)
    await page.goto(url)
    await expect(page.getByText('[Updated Echelon invitation]', { exact: true })).toBeVisible()
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    f.client.release()
    await f.pool.end()
  }
})
