import { test, expect } from '@playwright/test'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { echelonFixture } from './fixtures/echelon.ts'
import { signIn } from './helpers.ts'

test('phone Chapters keeps the chapter list full width above its details', async ({ page }) => {
  const f = await echelonFixture(true)
  try {
    await signIn(page, 'root@example.test')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/sites/' + f.site + '/chapters')
    const table = page.getByRole('table', { name: 'Chapters', exact: true })
    await expect(table.getByRole('button', { name: 'Peoria Chapter', exact: true })).toBeVisible()
    expect((await table.boundingBox())!.width).toBeGreaterThanOrEqual(300)
    const chapter = table.getByRole('columnheader', { name: 'Chapter', exact: true })
    expect((await chapter.boundingBox())!.width).toBeGreaterThanOrEqual(150)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally {
    f.client.release()
    await f.pool.end()
  }
})

test('phone History keeps version selection available above the selected version', async ({ page }) => {
  const f = await siteLookFixture()
  try {
    await signIn(page, 'root@example.test')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/pages/' + f.pages[0] + '/history')
    const queue = page.getByRole('group', { name: 'Version list', exact: true })
    await expect(queue.getByRole('heading', { name: 'Page history', exact: true })).toBeVisible()
    expect((await queue.boundingBox())!.width).toBeGreaterThanOrEqual(300)
    await expect(queue.getByRole('link').filter({ hasText: 'Version 1' })).toBeVisible()
    const detail = page.getByRole('group', { name: 'History actions', exact: true })
    expect((await detail.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await queue.boundingBox())!.y + (await queue.boundingBox())!.height,
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally {
    await f.pool.end()
  }
})

test('phone Reviews keeps its queue and search available above the decision area', async ({ page }) => {
  await signIn(page, 'root@example.test')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/inbox')
  const queue = page.getByRole('group', { name: 'Review requests', exact: true })
  await expect(queue.getByRole('heading', { name: 'Reviews', exact: true })).toBeVisible()
  expect((await queue.boundingBox())!.width).toBeGreaterThanOrEqual(300)
  await expect(queue.getByRole('searchbox', { name: 'Search review requests', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('archive confirmation wraps its explanation outside the page table on a phone', async ({ page }) => {
  const f = await siteLookFixture()
  try {
    await signIn(page, 'root@example.test')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/sites/' + f.site + '/pages')
    await page.getByRole('button', { name: 'More actions for Visit us', exact: true }).click()
    await page.getByRole('button', { name: 'Archive', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Archive “Visit us”?', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('This page will leave Pages and be removed from the live site and menu.')
    expect(await dialog.evaluate(node => getComputedStyle(node).whiteSpace)).toBe('normal')
    expect(
      await dialog.evaluate(node =>
        [...node.querySelectorAll('p,div')].every(child => child.scrollWidth <= child.clientWidth),
      ),
    ).toBe(true)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Visit us', exact: true })).toBeVisible()
  } finally {
    await f.pool.end()
  }
})
