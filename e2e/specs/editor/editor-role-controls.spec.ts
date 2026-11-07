import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn, saveDraft } from '../helpers.ts'
test('native content roles keep content editing and card creation while section and style controls belong to administrators', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/editor-role-controls/' + info.project.name)
  await mkdir(folder, { recursive: true })
  try {
    const home = (
        await f.pool.query("SELECT id,published_version_id FROM pages WHERE site_id=$1 AND slug=''", [f.siteId])
      ).rows[0]!,
      c = await f.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE cms_authenticated_user')
      await c.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
      for (const [email, role] of [
        ['editor@example.test', 'editor'],
        ['contributor@example.test', 'contributor'],
      ]) {
        const user = (await c.query('SELECT id FROM app_users WHERE email=$1', [email])).rows[0]!.id
        await c.query('SELECT app.set_site_membership($1,$2,$3)', [user, f.siteId, role])
      }
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    const capture = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 1000 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
        }
      },
      rail = page.getByRole('complementary', { name: 'Page structure' }),
      inspector = page.getByRole('complementary', { name: 'Inspector' }),
      frame = page.frameLocator('iframe[title="Page canvas"]')
    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + home.id)
    await expect(frame.getByRole('heading', { name: 'What We Do', exact: true })).toBeVisible()
    await expect(rail).toBeVisible()
    await expect(rail.getByRole('button', { name: /Add at end/ })).toHaveCount(0)
    await capture('editor-before-selection')
    await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await rail.getByRole('button', { name: 'What We Do', exact: true }).click()
    await expect(inspector.getByRole('button', { name: 'Add a card', exact: true })).toBeVisible()
    for (const name of ['Content', 'Style', 'Visibility', 'Advanced'])
      await expect(inspector.getByRole('tab', { name, exact: true })).toHaveCount(0)
    await expect(inspector.getByRole('button', { name: /^Layout:/ })).toHaveCount(0)
    await expect(inspector.getByRole('button', { name: 'Add section below', exact: true })).toHaveCount(0)
    await expect(page.getByRole('toolbar', { name: 'Selected section actions', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await expect(rail.getByRole('button', { name: /^Move |^Hide |^Show |^Add a section/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Close Structure', exact: true }).click()
    await expect(inspector.getByRole('button', { name: 'HTML source', exact: true })).toHaveCount(0)
    await capture('editor-after-selection')
    await inspector.getByRole('button', { name: 'Add a card', exact: true }).click()
    await inspector.getByLabel('Title', { exact: true }).fill('[Editor content]')
    await expect(frame.getByText('[Editor content]', { exact: true })).toBeVisible()
    await inspector.getByRole('button', { name: 'Done', exact: true }).click()
    await saveDraft(page)
    const saved = (
      await f.pool.query(
        'SELECT p.published_version_id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [home.id],
      )
    ).rows[0]!
    expect(saved.published_version_id).toBe(home.published_version_id)
    expect(saved.content[1].values.cards.items).toHaveLength(6)
    expect(saved.content[1].values.cards__i6__title).toBe('[Editor content]')
    const contributor = await browser.newContext()
    try {
      const p = await contributor.newPage()
      await signIn(p, 'contributor@example.test')
      await p.goto('/pages/' + home.id + '?section=1')
      const i = p.getByRole('complementary', { name: 'Inspector' })
      await expect(i.getByRole('button', { name: 'Add a card', exact: true })).toBeVisible()
      await expect(i.getByRole('tablist', { name: 'Section settings', exact: true })).toHaveCount(0)
      await expect(p.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
      await expect(p.getByRole('button', { name: /Send for approval|Submit for review/ })).toBeVisible()
    } finally {
      await contributor.close()
    }
    const admin = await browser.newContext()
    try {
      const p = await admin.newPage()
      await signIn(p, 'root@example.test')
      await p.goto('/pages/' + home.id + '?section=1')
      const i = p.getByRole('complementary', { name: 'Inspector' })
      for (const name of ['Content', 'Style', 'Visibility', 'Advanced'])
        await expect(i.getByRole('tab', { name, exact: true })).toBeVisible()
      await expect(i.getByRole('button', { name: 'Add section below', exact: true })).toBeVisible()
      await expect(
        p
          .getByRole('complementary', { name: 'Page structure' })
          .getByRole('button', { name: 'Add at end', exact: true }),
      ).toBeVisible()
      await expect(p.getByRole('toolbar', { name: 'Selected section actions', exact: true })).toBeVisible()
      for (const width of [1440, 1024]) {
        await p.setViewportSize({ width, height: 1000 })
        const tools = await p.getByRole('toolbar', { name: 'Selected section actions', exact: true }).boundingBox(),
          canvas = await p.locator('iframe[title="Page canvas"]').boundingBox()
        expect(tools!.y + tools!.height).toBeLessThanOrEqual(canvas!.y + 1)
        await p.screenshot({ path: resolve(folder, 'superadmin-' + width + '.png') })
      }
    } finally {
      await admin.close()
    }
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
