import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'
test('site admin navigation offers Keep, Discard and Save draft and leave, preserving failures and private frame heads', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/draft-leave/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let release = () => {},
    nativeDialogs = 0
  page.on('dialog', async dialog => {
    nativeDialogs++
    await dialog.dismiss()
  })
  const heads = async () =>
    (
      await f.pool.query(
        'SELECT kind,draft_version_id,published_version_id FROM global_elements WHERE site_id=$1 ORDER BY kind',
        [f.siteId],
      )
    ).rows
  try {
    const admin = (await f.pool.query("SELECT id FROM app_users WHERE email='contributor@example.test'")).rows[0]!.id
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    await f.client.query("SELECT app.set_site_membership($1,$2,'site_admin')", [admin, f.siteId])
    await f.client.query('COMMIT')
    await signIn(page, 'contributor@example.test')
    await page.goto('/sites/' + f.siteId + '/header')
    await page.getByRole('tab', { name: 'Logo', exact: true }).click()
    const description = page.getByLabel(/^Description \(for screen readers\)/),
      original = await description.inputValue(),
      before = await heads()
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      }
    }
    await description.fill('[Unsaved logo description]')
    await page.getByRole('link', { name: 'Footer', exact: true }).click()
    const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toBeVisible()
    await expect(leave).toContainText('Header & menu')
    await capture('header-choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(description).toHaveValue('[Unsaved logo description]')
    await page.getByRole('link', { name: 'Footer', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(leave).toHaveCount(0)
    await expect(description).toHaveValue('[Unsaved logo description]')
    await page.getByRole('link', { name: 'Footer', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/sites/' + f.siteId + '/footer$'))
    expect(await heads()).toEqual(before)
    await page.getByRole('link', { name: 'Header & menu', exact: true }).click()
    await page.getByRole('tab', { name: 'Logo', exact: true }).click()
    await expect(description).toHaveValue(original)
    await description.fill('')
    await page.getByRole('link', { name: 'Footer', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Choose a logo and add its description.')
    await expect(page).toHaveURL(new RegExp('/sites/' + f.siteId + '/header$'))
    await capture('save-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await description.fill('[Saved logo description]')
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let gated = false
    await page.route('**/sites/' + f.siteId + '/header', async route => {
      if (route.request().method() === 'POST' && !gated) {
        gated = true
        await gate
      }
      await route.continue()
    })
    await page.getByRole('link', { name: 'Footer', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('status')).toContainText('Saving your draft')
    await expect(leave.getByRole('button', { name: 'Keep editing', exact: true })).toBeDisabled()
    await capture('saving-before-leaving')
    release()
    await expect(page).toHaveURL(new RegExp('/sites/' + f.siteId + '/footer$'))
    await expect(leave).toHaveCount(0)
    const headerSaved = await heads()
    expect(headerSaved.find(row => row.kind === 'header').draft_version_id).not.toBe(
      before.find(row => row.kind === 'header').draft_version_id,
    )
    expect(headerSaved.find(row => row.kind === 'footer')).toEqual(before.find(row => row.kind === 'footer'))
    for (const row of headerSaved)
      expect(row.published_version_id).toBe(before.find(old => old.kind === row.kind).published_version_id)
    await page.getByText('Words beside the logo', { exact: true }).click()
    await page.getByLabel('Site name', { exact: true }).fill('[Saved footer name]')
    await page.getByRole('link', { name: 'Settings · Social accounts', exact: true }).click()
    await expect(leave).toContainText('Footer')
    await capture('footer-choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page.getByLabel('Site name', { exact: true })).toHaveValue('[Saved footer name]')
    await page.getByRole('link', { name: 'Settings · Social accounts', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/sites/' + f.siteId + '/settings/social$'))
    const footerSaved = await heads()
    expect(footerSaved.find(row => row.kind === 'header')).toEqual(headerSaved.find(row => row.kind === 'header'))
    expect(footerSaved.find(row => row.kind === 'footer').draft_version_id).not.toBe(
      before.find(row => row.kind === 'footer').draft_version_id,
    )
    for (const row of footerSaved)
      expect(row.published_version_id).toBe(before.find(old => old.kind === row.kind).published_version_id)
    await page.getByRole('link', { name: 'Header & menu', exact: true }).click()
    await page.getByRole('tab', { name: 'Logo', exact: true }).click()
    await expect(description).toHaveValue('[Saved logo description]')
    expect(nativeDialogs).toBe(0)
  } finally {
    release()
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})

test('preset Footer Social accounts links use the same three leave choices and keep publication private', async ({
  page,
}, info) => {
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/footer-social-guard/' + info.project.name)
  let native = 0
  page.on('dialog', async dialog => {
    native++
    await dialog.dismiss()
  })
  try {
    await mkdir(folder, { recursive: true })
    const heads = async () =>
        (
          await f.pool.query(
            "SELECT draft_version_id,published_version_id FROM global_elements WHERE site_id=$1 AND kind='footer'",
            [f.site],
          )
        ).rows[0]!,
      before = await heads()
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/footer')
    await page.getByText('Legal and accessibility links', { exact: true }).click()
    const copyright = page.getByLabel('Copyright line', { exact: true }),
      link = page.getByRole('link', { name: 'Settings · Social accounts', exact: true }).last(),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await copyright.fill('[Private footer words]')
    await link.click()
    await expect(leave).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await page.screenshot({ path: resolve(folder, 'preset-footer-leave-' + width + '.png') })
    }
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL('/sites/' + f.site + '/settings/social')
    expect(await heads()).toEqual(before)
    await page.goto('/sites/' + f.site + '/footer')
    await page.getByText('Legal and accessibility links', { exact: true }).click()
    await copyright.fill('[Saved private footer words]')
    await link.click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL('/sites/' + f.site + '/settings/social')
    const saved = await heads()
    expect(saved.draft_version_id).not.toBe(before.draft_version_id)
    expect(saved.published_version_id).toBe(before.published_version_id)
    expect(native).toBe(0)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
