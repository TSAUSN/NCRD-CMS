import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'

test('site setup leave keeps only a recoverable private browser draft and never creates a site', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/site-setup-leave/' + info.project.name),
    root = (await f.pool.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
    key = 'cms.site-wizard.v1:' + root,
    slug = 'local-setup-' + randomUUID().slice(0, 8)
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
    }
  }
  const rows = async () => (await f.pool.query('SELECT * FROM sites ORDER BY id')).rows
  try {
    await mkdir(folder, { recursive: true })
    const before = await rows(),
      pages = (await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages ORDER BY id')).rows
    await signIn(page, 'root@example.test')
    await page.goto('/sites/new')
    const name = page.getByLabel('Site name', { exact: true }),
      address = page.getByLabel('Short address', { exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      cancel = () => page.getByRole('link', { name: 'Cancel setup', exact: true }).click(),
      saved = page.getByRole('status').filter({ hasText: 'Progress saved in this browser at' })
    await cancel()
    await expect(page).toHaveURL(/\/$/)
    await expect(leave).toHaveCount(0)
    await page.goto('/sites/new')
    await name.fill('[Local setup]')
    await address.fill(slug)
    await expect(saved).toBeVisible()
    await capture('saved')
    await cancel()
    await expect(leave).toContainText('Site setup (saved only in this browser)')
    await expect(leave.getByRole('button', { name: 'Keep draft and leave', exact: true })).toBeVisible()
    await capture('leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('[Local setup]')
    await page.getByRole('link', { name: 'Import an existing site', exact: true }).click()
    await leave.getByRole('button', { name: 'Keep draft and leave', exact: true }).click()
    await expect(page).toHaveURL(/\/sites\/import$/)
    expect(await rows()).toEqual(before)
    await page.goto('/sites/new')
    await expect(name).toHaveValue('[Local setup]')
    await expect(address).toHaveValue(slug)
    await capture('restored')
    // Recovery is local to this browser; another context starts clean for the same account.
    const isolated = await browser.newContext({ baseURL: new URL(page.url()).origin }),
      other = await isolated.newPage()
    try {
      await signIn(other, 'root@example.test')
      await other.goto('/sites/new')
      await expect(other.getByLabel('Site name', { exact: true })).toHaveValue('')
    } finally {
      await isolated.close()
    }
    await address.fill('Bad address!')
    await expect(page.getByRole('status').filter({ hasText: 'Current changes are not saved' })).toBeVisible()
    await cancel()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Use lowercase words separated by hyphens')
    await capture('invalid')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(address).toHaveValue('Bad address!')
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).setup.slug, key)).toBe(slug)
    expect(await rows()).toEqual(before)
    await address.fill(slug)
    await expect(saved).toBeVisible()
    await page.evaluate(() => {
      ;(window as any).__setupSet = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('cms.site-wizard.v1:')) throw new Error('local storage unavailable')
        return (window as any).__setupSet.call(this, key, value)
      }
    })
    await name.fill('[Unstored setup]')
    await expect(page.getByRole('status').filter({ hasText: 'This browser could not save the setup.' })).toBeVisible()
    await cancel()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('This browser could not save the setup.')
    await capture('storage-error')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('[Unstored setup]')
    expect(await rows()).toEqual(before)
    await page.evaluate(() => {
      Storage.prototype.setItem = (window as any).__setupSet
    })
    await cancel()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/sites/new')
    await expect(name).toHaveValue('[Unstored setup]')
    await expect(saved).toBeVisible()
    await page.evaluate(() => {
      ;(window as any).__setupRemove = Storage.prototype.removeItem
      Storage.prototype.removeItem = function (key) {
        if (key.startsWith('cms.site-wizard.v1:')) throw new Error('local storage unavailable')
        return (window as any).__setupRemove.call(this, key)
      }
    })
    await cancel()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('could not clear this setup')
    await capture('discard-error')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('[Unstored setup]')
    await page.evaluate(() => {
      Storage.prototype.removeItem = (window as any).__setupRemove
    })
    await cancel()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/sites/new')
    await expect(name).toHaveValue('')
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
    expect(await rows()).toEqual(before)
    expect((await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages ORDER BY id')).rows).toEqual(
      pages,
    )
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
