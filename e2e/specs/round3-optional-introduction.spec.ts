import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn, saveDraft, canvas } from './helpers.ts'
test('an optional card introduction stays compact until needed and rail selection restores visual editing without publishing', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/optional-introduction/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const home = (
      await f.pool.query("SELECT id,published_version_id FROM pages WHERE site_id=$1 AND slug=''", [f.siteId])
    ).rows[0]!
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const editorId = (await f.client.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    await f.client.query("SELECT app.set_site_membership($1,$2,'editor')", [editorId, f.siteId])
    await f.client.query('COMMIT')
    await signIn(page, 'editor@example.test')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/pages/' + home.id + '?section=1')
      const inspector = page.getByRole('complementary', { name: 'Inspector' }),
        details = inspector
          .locator('details')
          .filter({ has: page.getByText('Introduction (optional)', { exact: true }) }),
        editor = inspector.locator('[data-inspector-slot="intro"] .tiptap')
      await expect(details).not.toHaveAttribute('open', '')
      await expect(editor).toBeHidden()
      await expect(inspector.getByRole('button', { name: /Meeting human need/ })).toBeInViewport()
      await expect(canvas(page).getByRole('heading', { name: 'What We Do', exact: true })).toBeVisible()
      await canvas(page)
        .locator('body')
        .evaluate(() => document.fonts.ready)
      await expect(page.locator('.canvas-loading')).toHaveCount(0)
      await page.screenshot({ path: resolve(folder, 'compact-' + width + '.png') })
      if (width === 1024) await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
      await page
        .getByRole('complementary', { name: 'Page structure' })
        .getByRole('button', { name: 'Introduction', exact: true })
        .click()
      await expect(editor).toBeVisible()
      await editor.fill('[Draft introduction]')
      await expect(canvas(page).getByText('[Draft introduction]', { exact: true })).toBeVisible()
      await page.screenshot({ path: resolve(folder, 'editing-' + width + '.png') })
      await saveDraft(page)
      await page.reload()
      const restored = page
        .getByRole('complementary', { name: 'Inspector' })
        .locator('[data-inspector-slot="intro"] .tiptap')
      await expect(restored).toHaveText('[Draft introduction]')
      await expect(restored).toBeVisible()
      await restored.fill('')
      await saveDraft(page)
      await page.reload()
      await expect(
        page.getByRole('complementary', { name: 'Inspector' }).locator('[data-inspector-slot="intro"] .tiptap'),
      ).toBeHidden()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    expect(
      (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [home.id])).rows[0]!
        .published_version_id,
    ).toBe(home.published_version_id)
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
