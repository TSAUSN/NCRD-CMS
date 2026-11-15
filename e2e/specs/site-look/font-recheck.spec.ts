import { test, expect } from '@playwright/test'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'

test('rechecking the font kit keeps the editor choices and only saves a private draft', async ({ page }) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true)
  const read = async () =>
    (
      await f.pool.query(
        'SELECT h.draft_version_id,h.published_version_id,v.tokens FROM themes h JOIN theme_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
        [f.siteId],
      )
    ).rows[0]!
  try {
    const before = await read()
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/design/fonts')
    await page.getByRole('button', { name: 'Check kit', exact: true }).click()
    const heading = page.getByLabel('Headings', { exact: true })
    const body = page.getByLabel('Body text', { exact: true })
    const headingChoice = await heading
      .locator('option')
      .evaluateAll(options =>
        options
          .find(option => option.textContent === 'Proxima Nova' && (option as HTMLOptionElement).value)
          ?.getAttribute('value'),
      )
    const bodyChoice = await body
      .locator('option')
      .evaluateAll(options =>
        options
          .find(option => option.textContent === 'Proxima Nova Condensed' && (option as HTMLOptionElement).value)
          ?.getAttribute('value'),
      )
    expect(headingChoice).toBeTruthy()
    expect(bodyChoice).toBeTruthy()
    await heading.selectOption(headingChoice!)
    await body.selectOption(bodyChoice!)
    const recheck = page.getByRole('button', { name: 'Check again', exact: true }).first()
    await expect(recheck).toBeEnabled({ timeout: 25000 })
    await recheck.click()
    await expect(heading).toHaveValue(headingChoice!)
    await expect(body).toHaveValue(bodyChoice!)
    const save = page.getByRole('button', { name: 'Save draft', exact: true })
    await expect(save).toBeEnabled({ timeout: 25000 })
    await save.click()
    await expect(page.getByRole('status')).toContainText('Design draft saved')
    const saved = await read()
    expect(saved.tokens.fonts.heading).toBe(headingChoice)
    expect(saved.tokens.fonts.body).toBe(bodyChoice)
    expect(saved.published_version_id).toBe(before.published_version_id)
    await page.reload()
    await expect(heading).toHaveValue(headingChoice!)
    await expect(body).toHaveValue(bodyChoice!)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
