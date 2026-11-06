import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn, saveDraft } from './helpers.ts'
async function capture(page: Page, name: string, engine: string) {
  const folder = resolve('../.r8-progress/round3/title-links', engine)
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
}
test('native section title stays outlined in a focused panel and link settings preview, cancel and save without disturbing cards', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true)
  try {
    const home = (
        await f.pool.query(
          "SELECT p.id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug=''",
          [f.siteId],
        )
      ).rows[0]!,
      original = home.content[1].values.link
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + home.id)
    const frame = page.frameLocator('iframe[title="Page canvas"]'),
      inspector = page.getByRole('complementary', { name: 'Inspector' }),
      root = frame.locator('[data-cms-section="1"]'),
      cards = root.locator('.national-tiles>article')
    await expect(cards).toHaveCount(5)
    await frame.getByRole('heading', { name: 'What We Do', exact: true }).click()
    await expect(inspector.getByRole('heading', { name: 'Section title', exact: true })).toBeVisible()
    await expect(inspector.getByLabel('Title', { exact: true })).toHaveValue('What We Do')
    await expect(inspector.getByRole('button', { name: 'Add a card', exact: true })).toHaveCount(0)
    await expect(inspector.getByRole('tab')).toHaveCount(0)
    await expect(root).toHaveAttribute('data-cms-selected-within', '')
    await capture(page, 'title', info.project.name)
    await inspector.getByLabel('Title', { exact: true }).fill('[What We Do]')
    await expect(frame.getByRole('heading', { name: '[What We Do]', exact: true })).toBeVisible()
    await expect(cards).toHaveCount(5)
    await inspector.getByRole('button', { name: 'Change', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Change link', exact: true }),
      types = dialog.getByRole('group', { name: 'Link destination type', exact: true })
    for (const name of ['Page on this site', 'Website', 'Email', 'Phone'])
      await expect(types.getByRole('button', { name, exact: true })).toBeVisible()
    await types.getByRole('button', { name: 'Website', exact: true }).click()
    await dialog.getByLabel('Address', { exact: true }).fill('https://example.test/preview')
    await dialog.getByLabel('Open in a new tab', { exact: true }).check()
    await dialog.getByLabel(/nofollow/).check()
    await expect(root.locator('.national-block-head a')).toHaveAttribute('href', 'https://example.test/preview')
    await capture(page, 'change-link', info.project.name)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(root.locator('.national-block-head a')).toHaveAttribute('href', original.url)
    await inspector.getByRole('button', { name: 'Change', exact: true }).click()
    await types.getByRole('button', { name: 'Email', exact: true }).click()
    await dialog.getByLabel('Email address', { exact: true }).fill('hello@example.test')
    await expect(root.locator('.national-block-head a')).toHaveAttribute('href', 'mailto:hello@example.test')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(root.locator('.national-block-head a')).toHaveAttribute('href', original.url)
    await inspector.getByRole('button', { name: 'Change', exact: true }).click()
    await types.getByRole('button', { name: 'Phone', exact: true }).click()
    await dialog.getByLabel('Phone number', { exact: true }).fill('+1-202-555-0100')
    await expect(root.locator('.national-block-head a')).toHaveAttribute('href', 'tel:+1-202-555-0100')
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await saveDraft(page)
    const values = (
      await f.pool.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [home.id],
      )
    ).rows[0]!.content[1].values
    expect(values.link).toEqual({ ...original, url: 'tel:+1-202-555-0100' })
    expect(values.cards).toEqual(home.content[1].values.cards)
    expect(values.cards__i1__title).toBe(home.content[1].values.cards__i1__title)
    await inspector.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(inspector.getByRole('button', { name: 'Add a card', exact: true })).toBeVisible()
    await frame.getByRole('heading', { name: '[What We Do]', exact: true }).click()
    await inspector.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(inspector.getByRole('heading', { name: 'This page', exact: true })).toBeVisible()
    await expect(cards).toHaveCount(5)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
