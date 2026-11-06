import { expect, test } from '@playwright/test'
import { signIn } from './helpers.ts'

// V1 kept the site wizard's progress in the browser (reference 25: “Progress
// saved in this browser … You can come back to it. Clear saved draft”). V2
// keeps it per signed-in account, restores it on return, and forgets it when
// the site is created or the draft is cleared.
test('keeps wizard progress in this browser until it is cleared or the site is created', async ({ page }) => {
  test.setTimeout(90_000)
  await signIn(page, 'root@example.test')
  await page.goto('/sites/new')
  const notice = page.getByRole('status').filter({ hasText: 'Progress saved in this browser at' })
  await expect(notice).toHaveCount(0)

  const slug = `kept-progress-${Date.now()}`
  await page.getByLabel('Site name', { exact: true }).fill('Kept progress')
  await page.getByLabel('Short address', { exact: true }).fill(slug)
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('You can come back to it.')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Look', exact: true })).toBeVisible()

  // Leaving and coming back returns to the same step with the same answers.
  await page.goto('/')
  await page.goto('/sites/new')
  await expect(page.getByRole('heading', { name: 'Look', exact: true })).toBeVisible()
  await expect(notice).toBeVisible()
  await page.getByRole('button', { name: /^1\s*Name$/ }).click()
  await expect(page.getByLabel('Site name', { exact: true })).toHaveValue('Kept progress')
  await expect(page.getByLabel('Short address', { exact: true })).toHaveValue(slug)

  // Clearing starts again, and stays cleared.
  await notice.getByRole('button', { name: 'Clear saved draft' }).click()
  await expect(page.getByLabel('Site name', { exact: true })).toHaveValue('')
  await expect(notice).toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel('Site name', { exact: true })).toHaveValue('')
  await expect(notice).toHaveCount(0)

  // Creating the site forgets the progress.
  await page.getByLabel('Site name', { exact: true }).fill('Kept progress')
  await page.getByLabel('Short address', { exact: true }).fill(slug)
  for (const step of ['Look', 'Pages', 'Header & footer', 'Review']) {
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByRole('heading', { name: step, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Create site', exact: true }).click()
  await expect(page.getByText('Your new site is private until you publish it.', { exact: false })).toBeVisible()
  await page.goto('/sites/new')
  await expect(page.getByLabel('Site name', { exact: true })).toHaveValue('')
  await expect(notice).toHaveCount(0)
})
