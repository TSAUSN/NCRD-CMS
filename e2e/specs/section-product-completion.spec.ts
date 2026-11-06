import { expect, test } from '@playwright/test'
import { addSectionButton, canvas, fetchPublic, publish, saveDraft, signIn, treeLabels } from './helpers.ts'

test('persists personal favourites across library and editor reopening and renders live previews only on request', async ({
  page,
  browser,
}) => {
  await signIn(page, 'root@example.test')
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+$/)
  const siteUrl = page.url()
  await page.goto(`${siteUrl}/sections`)
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.getByRole('button', { name: 'Save Call to action to favourites', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove Call to action from favourites', exact: true })).toBeVisible()
  // The library's filters apply as they change, and the address keeps them.
  await page.getByLabel('My favourites only').check()
  await expect(page.locator('.section-card')).toHaveCount(1)
  await expect(page).toHaveURL(/\/sections\?favourites=1$/)
  const previewResponse = page.waitForResponse(
    response => response.url().includes('/sections/') && response.url().includes('/preview?'),
  )
  await page.getByRole('button', { name: 'Preview Call to action', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Preview Call to action', exact: true })
  await expect(dialog).toBeVisible()
  const preview = dialog.frameLocator('iframe')
  await expect(preview.locator('.cta-action a')).toContainText('Button')
  await dialog.getByRole('button', { name: 'Phone', exact: true }).click()
  await expect(dialog.locator('iframe')).toHaveCSS('width', '390px')
  const response = await previewResponse
  expect(response.headers()['content-security-policy']).toContain("script-src 'none'")
  await page.screenshot({ path: test.info().outputPath('section-phone-preview.png') })
  const anonymous = await browser.newContext()
  expect((await anonymous.request.get(response.url())).status()).toBe(404)
  await anonymous.close()
  await page.keyboard.press('Escape')
  await expect(page.locator('iframe')).toHaveCount(0)

  await page.goto(siteUrl)
  await page.getByRole('link', { name: 'A page served by cms-v2', exact: true }).click()
  await addSectionButton(page).click()
  await page.locator('#editor-panel-library').getByLabel('Category', { exact: true }).selectOption('__favourites')
  await expect(page.locator('#editor-panel-library .section-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Remove Call to action from favourites', exact: true }).click()
  await expect(page.locator('#editor-panel-library .section-card')).toHaveCount(0)
  await page
    .getByRole('dialog', { name: 'Add a section', exact: true })
    .getByRole('button', { name: 'Back', exact: true })
    .click()
  await addSectionButton(page).click()
  await page.locator('#editor-panel-library').getByLabel('Category', { exact: true }).selectOption('__favourites')
  await expect(page.locator('#editor-panel-library .section-card')).toHaveCount(0)
  await page.reload()
  await addSectionButton(page).click()
  await page.locator('#editor-panel-library').getByLabel('Category', { exact: true }).selectOption('__favourites')
  await expect(page.locator('#editor-panel-library .section-card')).toHaveCount(0)
})

test('changes one button through save, reopen, publish, hover and reset without restyling another action', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await signIn(page, 'root@example.test')
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await page.getByRole('link', { name: 'A page served by cms-v2', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Page structure', exact: true })).toBeVisible()
  await treeLabels(page).filter({ hasText: 'Call to action' }).click()
  await page
    .getByRole('complementary', { name: 'Inspector' })
    .getByRole('button', { name: 'Change', exact: true })
    .click()
  await page.getByRole('dialog', { name: 'Change link', exact: true }).getByText('Advanced', { exact: true }).click()
  await page.getByText('Button appearance', { exact: true }).click()
  await page.getByRole('button', { name: 'Customize this button', exact: true }).click()
  await page.getByLabel('Button treatment', { exact: true }).selectOption('outline')
  await page.getByLabel('Button colour', { exact: true }).selectOption('accent')
  await page.getByLabel('Button corners', { exact: true }).selectOption('pill')
  await page.getByLabel('Button hover & keyboard focus', { exact: true }).selectOption('invert')
  const action = canvas(page).locator('.cta-action a')
  await expect(action).toHaveClass(/cms-button-style-outline/)
  await expect(action).toHaveCSS('border-radius', '999px')
  const outline = await action.evaluate(el => ({
    color: getComputedStyle(el).color,
    background: getComputedStyle(el).backgroundColor,
  }))
  await page.screenshot({ path: test.info().outputPath('button-appearance-editor.png') })
  await page
    .getByRole('dialog', { name: 'Change link', exact: true })
    .getByRole('button', { name: 'Done', exact: true })
    .click()
  await saveDraft(page)
  await expect.poll(async () => (await fetchPublic()).body).not.toContain('class="cms-button cms-button-instance')
  await page.reload()
  await treeLabels(page).filter({ hasText: 'Call to action' }).click()
  await page
    .getByRole('complementary', { name: 'Inspector' })
    .getByRole('button', { name: 'Change', exact: true })
    .click()
  await page.getByRole('dialog', { name: 'Change link', exact: true }).getByText('Advanced', { exact: true }).click()
  await expect(page.getByLabel('Button treatment', { exact: true })).toHaveValue('outline')
  await expect(page.getByLabel('Button corners', { exact: true })).toHaveValue('pill')
  await page
    .getByRole('dialog', { name: 'Change link', exact: true })
    .getByRole('button', { name: 'Done', exact: true })
    .click()
  await publish(page)
  const publicHtml = (await fetchPublic()).body
  expect(publicHtml).toContain('class="cms-button cms-button-instance cms-button-color-accent cms-button-style-outline')
  await action.hover()
  await expect(action).toHaveCSS('background-color', outline.color)
  await expect(action).toHaveCSS('color', outline.background)
  await page
    .getByRole('complementary', { name: 'Inspector' })
    .getByRole('button', { name: 'Change', exact: true })
    .click()
  await page.getByRole('dialog', { name: 'Change link', exact: true }).getByText('Advanced', { exact: true }).click()
  await page.getByRole('button', { name: 'Use original button appearance', exact: true }).click()
  await expect(action).not.toHaveClass(/cms-button-instance/)
  await page
    .getByRole('dialog', { name: 'Change link', exact: true })
    .getByRole('button', { name: 'Done', exact: true })
    .click()
  await publish(page)
  expect((await fetchPublic()).body).not.toContain('class="cms-button cms-button-instance')
})
