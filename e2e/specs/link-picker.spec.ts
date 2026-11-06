import { expect, test } from '@playwright/test'
import { canvas, saveDraft, signIn, treeLabels } from './helpers.ts'

test.describe('same-site link chooser', () => {
  test('chooses published pages, preserves manual addresses, and excludes drafts', async ({ page }) => {
    await signIn(page, 'editor@example.test')
    await page.getByRole('link', { name: 'Demo site', exact: true }).click()

    const draftTitle = `Unpublished destination ${Date.now()}`
    await page.getByRole('button', { name: 'Add a page' }).click()
    const draft = page.getByRole('dialog', { name: 'New page', exact: true })
    await draft.getByLabel('Page title', { exact: true }).fill(draftTitle)
    await draft.getByRole('button', { name: 'Create draft', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Page structure' })).toBeVisible()

    await page.getByRole('link', { name: 'Demo site', exact: true }).click()
    await page.getByRole('link', { name: 'A page served by cms-v2', exact: true }).click()
    await treeLabels(page).filter({ hasText: 'Call to action' }).click()

    await page
      .getByRole('complementary', { name: 'Inspector' })
      .getByRole('button', { name: 'Change', exact: true })
      .click()
    const destinationType = page.getByRole('group', { name: 'Link destination type' })
    const pageMode = destinationType.getByRole('button', { name: 'Page on this site' })
    const addressMode = destinationType.getByRole('button', { name: 'Email', exact: true })
    const target = page.getByRole('combobox', { name: 'Page' })

    await expect(pageMode).toHaveAttribute('aria-pressed', 'true')
    await expect(target).toHaveValue(/.+/)
    await expect(target.locator('option')).toContainText(['Choose a published page…', 'A page served by cms-v2 — /'])
    await expect(target.locator('option', { hasText: draftTitle })).toHaveCount(0)

    await addressMode.click()
    const address = page.getByRole('textbox', { name: 'Email address', exact: true })
    await address.fill('help@example.test')
    await expect(canvas(page).locator('.cta-action a')).toHaveAttribute('href', 'mailto:help@example.test')

    await pageMode.click()
    await target.selectOption({ label: 'A page served by cms-v2 — /' })
    await expect(canvas(page).locator('.cta-action a')).toHaveAttribute('href', '/')
    await page
      .getByRole('dialog', { name: 'Change link', exact: true })
      .getByRole('button', { name: 'Done', exact: true })
      .click()
    await saveDraft(page)

    await page.reload()
    await treeLabels(page).filter({ hasText: 'Call to action' }).click()
    await page
      .getByRole('complementary', { name: 'Inspector' })
      .getByRole('button', { name: 'Change', exact: true })
      .click()
    await expect(page.getByRole('button', { name: 'Page on this site' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('combobox', { name: 'Page' })).toHaveValue(/.+/)
  })
})
