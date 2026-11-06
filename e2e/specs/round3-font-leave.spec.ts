import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
test('font leave preserves invalid kit fields and saves connected choices privately before navigating', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true),
    folder = resolve('../.r8-progress/round3/font-leave/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let native = 0,
    release = () => {}
  page.on('dialog', async dialog => {
    native++
    await dialog.dismiss()
  })
  const read = async () =>
    (
      await f.pool.query(
        'SELECT h.draft_version_id,h.published_version_id,v.tokens FROM themes h JOIN theme_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
        [f.siteId],
      )
    ).rows[0]!
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
    }
  }
  try {
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const admin = (await f.client.query("SELECT id FROM app_users WHERE email='contributor@example.test'")).rows[0]!.id
    await f.client.query("SELECT app.set_site_membership($1,$2,'site_admin')", [admin, f.siteId])
    await f.client.query('COMMIT')
    await page.route('https://use.typekit.net/**', route => route.abort())
    await page.route('https://p.typekit.net/**', route => route.abort())
    const before = await read(),
      base = '/sites/' + f.siteId + '/design',
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      kit = page.getByLabel('Kit link', { exact: true })
    await signIn(page, 'contributor@example.test')
    await page.goto(base + '/fonts')
    await kit.fill('https://example.test/fonts.css')
    await page.getByRole('link', { name: 'Colours', exact: true }).click()
    await expect(leave).toBeVisible()
    await capture('kit-choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(kit).toHaveValue('https://example.test/fonts.css')
    await page.getByRole('link', { name: 'Colours', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(leave).toHaveCount(0)
    await page.getByRole('link', { name: 'Colours', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Use the approved kit link')
    await capture('kit-save-refused')
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(base)
    expect(await read()).toEqual(before)
    await page.goto(base + '/fonts')
    await page.getByRole('button', { name: 'Check kit', exact: true }).click()
    await expect(page.getByLabel('Headings', { exact: true })).toHaveValue(
      "'trajan-pro-3', 'Source Serif 4', Georgia, serif",
    )
    await page.getByRole('link', { name: 'Colours', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(base)
    expect(await read()).toEqual(before)
    await page.goto(base + '/fonts')
    await page.getByRole('button', { name: 'Check kit', exact: true }).click()
    await expect(page.getByLabel('Headings', { exact: true })).toBeVisible()
    let fail = true
    await page.route('**/sites/' + f.siteId + '/design/fonts', async route => {
      if (fail && route.request().method() === 'POST') {
        fail = false
        await route.abort('failed')
      } else await route.continue()
    })
    await page.getByRole('link', { name: 'Colours', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('font draft could not be saved')
    await capture('save-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page.getByLabel('Headings', { exact: true })).toHaveValue(
      "'trajan-pro-3', 'Source Serif 4', Georgia, serif",
    )
    expect(await read()).toEqual(before)
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let waiting = false
    await page.route('**/sites/' + f.siteId + '/design/fonts', async route => {
      if (!waiting && route.request().method() === 'POST') {
        waiting = true
        await gate
      }
      await route.fallback()
    })
    await page.getByRole('link', { name: 'Colours', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('status')).toContainText('Saving your draft')
    await capture('saving-before-leaving')
    release()
    await expect(page).toHaveURL(base)
    const saved = await read()
    expect(saved.draft_version_id).not.toBe(before.draft_version_id)
    expect(saved.published_version_id).toBe(before.published_version_id)
    expect(saved.tokens.fonts).toMatchObject({
      heading: "'trajan-pro-3', 'Source Serif 4', Georgia, serif",
      adobeKit: { id: 'euh2hvn', enabled: true },
    })
    expect(saved.tokens.fonts.adobeKit.domains).toContain(f.hostname)
    expect(native).toBe(0)
  } finally {
    release()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
