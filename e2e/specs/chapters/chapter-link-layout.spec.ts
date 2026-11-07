import { test, expect } from '@playwright/test'
import { echelonFixture } from '../fixtures/echelon.ts'
import { signIn } from '../helpers.ts'

for (const width of [1440, 1024]) {
  test(`linked chapter details stay inside their panel at ${width}`, async ({ page }) => {
    const f = await echelonFixture(),
      address = 'https://personal-review.example.test/chapters/detroit?review=' + 'a'.repeat(110)
    try {
      await f.client.query('BEGIN')
      await f.client.query('SET LOCAL ROLE cms_authenticated_user')
      await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
      const chapter = (
        await f.client.query(
          "SELECT c.id,c.revision,c.slug,v.config FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.site_id=$1 AND c.slug='detroit'",
          [f.site],
        )
      ).rows[0]!
      await f.client.query('SELECT * FROM app.save_chapter_setup($1,$2,$3,$4,$5)', [
        f.site,
        chapter.id,
        chapter.revision,
        chapter.slug,
        JSON.stringify({ ...chapter.config, externalUrl: address }),
      ])
      await f.client.query('COMMIT')
      await page.setViewportSize({ width, height: 1000 })
      await signIn(page, 'root@example.test')
      await page.goto('/sites/' + f.site + '/chapters')
      await page.getByRole('button', { name: 'Detroit Chapter', exact: true }).click()
      const detail = page.getByRole('dialog', { name: 'Detroit Chapter', exact: true })
      await expect(detail.getByText('No chapter editors are assigned.', { exact: true })).toBeVisible()
      await expect(detail.getByRole('link', { name: 'Open saved address', exact: true })).toHaveAttribute(
        'href',
        address,
      )
      await expect(detail.getByText(address, { exact: true })).toBeVisible()
      await expect(detail).toContainText('Address not checked automatically.')
      await expect(detail).not.toContainText('local demo')
      expect(
        await detail.locator('dl').evaluate(node => {
          const panel = node.closest('[role="dialog"]')!.getBoundingClientRect(),
            facts = node.getBoundingClientRect()
          return facts.right <= panel.right && facts.left >= panel.left
        }),
      ).toBe(true)
      expect(
        await detail.evaluate(
          node =>
            [...node.querySelectorAll('*')].filter(element => {
              const style = getComputedStyle(element)
              return ['auto', 'scroll'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1
            }).length,
        ),
      ).toBe(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    } finally {
      await f.client.query('ROLLBACK')
      f.client.release()
      await f.pool.end()
    }
  })
}

for (const width of [1440, 1024]) {
  test(`chapter setup handles invalid links and switching back to a page at ${width}`, async ({ page }) => {
    const f = await echelonFixture(true)
    try {
      await page.setViewportSize({ width, height: 1000 })
      await signIn(page, 'root@example.test')
      await page.goto('/sites/' + f.site + '/chapters')
      await page.getByRole('button', { name: 'Atlanta Chapter', exact: true }).click()
      await page
        .getByRole('dialog', { name: 'Atlanta Chapter', exact: true })
        .getByRole('button', { name: 'Set up', exact: true })
        .click()
      const form = page.getByRole('dialog', { name: 'Set up Atlanta Chapter', exact: true })
      await form.getByRole('radio', { name: 'Their division’s page', exact: true }).check()
      await form.getByRole('textbox', { name: 'Page address required', exact: true }).fill('not a URL')
      await form.getByRole('button', { name: 'Save draft', exact: true }).click()
      await expect(form).toContainText('Use the full https address for the division page.')
      await expect(form.getByRole('alert')).toBeInViewport()
      await expect(form.getByRole('alert')).toBeFocused()
      await expect(form.getByRole('textbox', { name: 'Page address required', exact: true })).toHaveValue('not a URL')
      await form.getByRole('textbox', { name: 'Page address required', exact: true }).fill('')
      await form.getByRole('radio', { name: 'This chapter page', exact: true }).check()
      await expect(form.getByRole('alert')).toHaveCount(0)
      await form.getByRole('button', { name: 'Continue', exact: true }).click()
      await form.getByRole('button', { name: 'Continue', exact: true }).click()
      await form.getByRole('button', { name: 'Save chapter', exact: true }).click()
      await expect(form).toBeHidden()
      await page.reload()
      await page.getByRole('button', { name: 'Atlanta Chapter', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Atlanta Chapter', exact: true })).toContainText(
        'This chapter page',
      )
      const saved = (
        await f.pool.query(
          "SELECT v.config FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.site_id=$1 AND c.slug='atlanta'",
          [f.site],
        )
      ).rows[0]!.config
      expect(saved.destination).toBe('page')
      expect(saved.externalUrl).toBeNull()
    } finally {
      f.client.release()
      await f.pool.end()
    }
  })
}
