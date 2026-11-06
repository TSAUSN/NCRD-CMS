import { test, expect } from '@playwright/test'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn, treeLabels } from './helpers.ts'
test('added feature-card title and rich text stay inside the inspector', async ({ page }) => {
  test.setTimeout(90000)
  const f = await sawsoFixture(true, true)
  try {
    const home = (await f.pool.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [f.siteId])).rows[0].id
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + home)
    await treeLabels(page).nth(1).click()
    await page
      .getByRole('complementary', { name: 'Inspector', exact: true })
      .getByRole('button', { name: 'Add a card', exact: true })
      .click()
    const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true }),
      card = inspector.getByRole('heading', { name: 'New card', exact: true }).locator('..').locator('..')
    await expect(card).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await expect
        .poll(() =>
          card.evaluate(node => {
            const box = node.getBoundingClientRect(),
              panel = node.closest('.inspector')!.getBoundingClientRect()
            if (box.right > panel.right + 1) return false
            return [...node.querySelectorAll('input,textarea,.rich-editor')].every(field => {
              const b = field.getBoundingClientRect()
              return b.width === 0 || (b.left >= box.left - 1 && b.right <= box.right + 1)
            })
          }),
        )
        .toBe(true)
      await page.screenshot({ path: `../.r8-progress/card-field-bounds-${width}.png` })
    }
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
