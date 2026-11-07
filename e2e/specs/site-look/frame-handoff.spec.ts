import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn, saveDraft } from '../helpers.ts'
async function capture(page: Page, name: string, engine: string) {
  const folder = resolve('../.r8-progress/round3/frame-handoff', engine)
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
}
test('Site admins open shared areas in another tab and return with their page edits intact; page details cannot change the menu', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true)
  try {
    const admin = (await f.pool.query("SELECT id FROM app_users WHERE email='contributor@example.test'")).rows[0]!.id
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    await f.client.query('SELECT app.set_site_membership($1,$2,$3)', [admin, f.siteId, 'site_admin'])
    await f.client.query('COMMIT')
    const home = (
        await f.pool.query("SELECT id,published_version_id FROM pages WHERE site_id=$1 AND slug=''", [f.siteId])
      ).rows[0]!,
      before = {
        menu: (await f.pool.query('SELECT * FROM navigations WHERE site_id=$1', [f.siteId])).rows,
        frame: (await f.pool.query('SELECT * FROM global_elements WHERE site_id=$1 ORDER BY id', [f.siteId])).rows,
      }
    await signIn(page, 'contributor@example.test')
    await page.goto('/pages/' + home.id + '?section=0')
    const frame = page.frameLocator('iframe[title="Page canvas"]'),
      inspector = page.getByRole('complementary', { name: 'Inspector' })
    await inspector.getByRole('button', { name: /^1\./ }).click()
    await inspector.getByLabel('Title', { exact: true }).fill('[Page edit kept through shared-area handoff]')
    await expect(frame.getByText('[Page edit kept through shared-area handoff]', { exact: true })).toBeVisible()
    await frame.locator('header').click()
    const note = page.getByRole('complementary', { name: 'Site-wide settings', exact: true })
    await expect(note.getByText(/Header: on all \d+ pages/)).toBeVisible()
    await expect(note.getByRole('button', { name: 'Edit header', exact: true })).toHaveCount(0)
    await expect(frame.getByLabel('Add page to menu', { exact: true })).toHaveCount(0)
    await expect(note.getByRole('textbox')).toHaveCount(0)
    await capture(page, 'header-note', info.project.name)
    const opened = page.context().waitForEvent('page')
    await note.getByRole('link', { name: 'Open Header & menu', exact: true }).click()
    const header = await opened
    try {
      await expect(header).toHaveURL(new RegExp('/sites/' + f.siteId + '/header$'))
      await expect(header.getByRole('heading', { name: 'Header & menu', level: 1, exact: true })).toBeVisible()
    } finally {
      await header.close()
    }
    await page.bringToFront()
    await note.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(frame.getByText('[Page edit kept through shared-area handoff]', { exact: true })).toBeVisible()
    await frame.locator('footer').click()
    await expect(note.getByText(/Footer: on all \d+ pages/)).toBeVisible()
    await expect(note.getByRole('link', { name: 'Open Footer', exact: true })).toHaveAttribute(
      'href',
      '/sites/' + f.siteId + '/footer',
    )
    await capture(page, 'footer-note', info.project.name)
    await page.keyboard.press('Escape')
    await expect(note).toHaveCount(0)
    await page.getByRole('button', { name: 'More page actions', exact: true }).click()
    await page.getByRole('button', { name: 'Page settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Page settings', exact: true })
    await expect(settings.getByRole('checkbox', { name: 'Show in menu', exact: true })).toHaveCount(0)
    await expect(settings.getByText(/Change the menu in Header & menu/)).toBeVisible()
    await expect(settings.getByRole('link', { name: 'Header & menu', exact: true })).toHaveAttribute('target', '_blank')
    await capture(page, 'page-details', info.project.name)
    await page.keyboard.press('Escape')
    await saveDraft(page)
    expect((await f.pool.query('SELECT * FROM navigations WHERE site_id=$1', [f.siteId])).rows).toEqual(before.menu)
    expect((await f.pool.query('SELECT * FROM global_elements WHERE site_id=$1 ORDER BY id', [f.siteId])).rows).toEqual(
      before.frame,
    )
    const saved = (
      await f.pool.query(
        'SELECT p.published_version_id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [home.id],
      )
    ).rows[0]!
    expect(saved.published_version_id).toBe(home.published_version_id)
    expect(saved.content[0].values.slides__i1__title).toBe('[Page edit kept through shared-area handoff]')
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
test('Editors get the shared-area note without site controls or a Header route', async ({ page }, info) => {
  const f = await sawsoFixture(true, true)
  try {
    const editor = (await f.pool.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    await f.client.query('SELECT app.set_site_membership($1,$2,$3)', [editor, f.siteId, 'editor'])
    await f.client.query('COMMIT')
    const home = (await f.pool.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [f.siteId])).rows[0]!.id
    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + home)
    await page.frameLocator('iframe[title="Page canvas"]').locator('header').click()
    const note = page.getByRole('complementary', { name: 'Site-wide settings', exact: true })
    await expect(note.getByText(/Header: on all/)).toBeVisible()
    await expect(note.getByRole('link')).toHaveCount(0)
    await expect(note.getByRole('textbox')).toHaveCount(0)
    await expect(note).toContainText('A Site admin can change this shared area.')
    await capture(page, 'editor-note', info.project.name)
    await note.getByRole('button', { name: 'Back', exact: true }).click()
    expect((await page.goto('/sites/' + f.siteId + '/header'))?.status()).toBe(404)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
