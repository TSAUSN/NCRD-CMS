import { expect, test } from '@playwright/test'
import { canvas, clickOnCanvas, openSeededPage, signIn, savedState, typeInInspector } from './helpers.ts'

test('an outdated editor stops retrying, protects publish and schedule, and recovers its unsaved draft after reload', async ({
  page,
}) => {
  await signIn(page, 'editor@example.test')
  await openSeededPage(page)
  await clickOnCanvas(page, 'heading')
  let rejectedSaves = 0
  await page.route('**', route => {
    if (route.request().method() !== 'POST' || !route.request().headers()['next-action']) return route.continue()
    rejectedSaves++
    return route.fulfill({
      status: 404,
      headers: { 'x-nextjs-action-not-found': '1' },
      body: 'The server action belongs to an earlier deployment.',
    })
  })
  await typeInInspector(page, 0, 'heading', 'Draft retained across an update')
  const notice = page.getByRole('alert').filter({ hasText: 'The CMS was updated while this page was open.' })
  await expect(notice).toBeVisible()
  await expect(notice).not.toContainText('Server Action')
  await expect(notice).not.toContainText('nextjs.org')
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Schedule', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
  await expect(savedState(page)).toHaveText('Unsaved changes')
  await expect(page.getByRole('status', { name: 'Browser recovery status', exact: true })).toHaveText('Copy kept')
  // Observe beyond two normal autosave delays: a one-request assertion alone misses the retry loop.
  await page.waitForTimeout(3500)
  expect(rejectedSaves).toBe(1)
  await page.unroute('**')
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: /^Review copy from / }).click()
  const recovery = page.getByRole('dialog', { name: 'Review browser recovery', exact: true })
  await expect(recovery.getByText('Draft retained across an update', { exact: true })).toBeVisible()
  await recovery.getByRole('button', { name: 'Apply browser copy', exact: true }).click()
  await expect(
    canvas(page).getByRole('heading', { name: 'Draft retained across an update', exact: true }),
  ).toBeVisible()
  await clickOnCanvas(page, 'heading')
  await expect(page.locator('#slot-0-heading')).toHaveValue('Draft retained across an update')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(savedState(page)).toHaveText('All changes saved')
  await page.reload()
  await clickOnCanvas(page, 'heading')
  await expect(page.locator('#slot-0-heading')).toHaveValue('Draft retained across an update')
})
