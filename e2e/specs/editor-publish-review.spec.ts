import { test, expect } from '@playwright/test'
import { openSeededPage, signIn, publish } from './helpers.ts'
test('editor Publish asks for review and Cancel leaves the live page unchanged', async ({ page }) => {
  await signIn(page, 'editor@example.test')
  await openSeededPage(page)
  const notices = page.getByText('Published. The live page now shows these changes.', { exact: true })
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Publish this page', exact: true })
  await expect(dialog).toBeVisible()
  await expect(notices).toHaveCount(0)
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: `../.r8-progress/polish-publish-${width}.png` })
  }
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(notices).toHaveCount(0)
  await publish(page)
})
