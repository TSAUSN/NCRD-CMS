import { expect, test } from '@playwright/test'
import { signIn } from './helpers.ts'

test('filters history and rejects malformed filters with useful feedback', async ({ page }) => {
  await signIn(page, 'editor@example.test')
  await page.goto('/activity')
  await expect(page.getByRole('heading', { name: 'Activity history', exact: true })).toBeVisible()
  await page.getByLabel('Site', { exact: true }).selectOption({ label: 'Demo site' })
  await page.getByLabel('Actor type', { exact: true }).selectOption('user')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page).toHaveURL(/actorType=user/)
  await expect(page.getByRole('list', { name: 'Activity entries' })).toBeVisible()
  await page.goto('/activity?from=2026-02-30')
  await expect(page.getByRole('alert').filter({ hasText: 'valid date range' })).toBeVisible()
  await page.getByRole('link', { name: 'Clear filters' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'valid date range' })).toHaveCount(0)
})

test('activity controls and details fit a tablet without horizontal scrolling', async ({ page }) => {
  await signIn(page, 'editor@example.test')
  await page.setViewportSize({ width: 900, height: 1000 })
  await page.goto('/activity')
  await expect(page.getByRole('button', { name: 'Apply filters' })).toBeVisible()
  const details = page.getByText('Recorded details', { exact: true }).first()
  if (await details.count()) await details.click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
