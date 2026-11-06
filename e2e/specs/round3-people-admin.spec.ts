import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'

test('People keeps its factual list beside a bounded account panel and protects pending and unfinished changes', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/people-admin/' + info.project.name)
  let release = () => {}
  try {
    await mkdir(folder, { recursive: true })
    const user = (await f.pool.query("SELECT id,status,auth_subject FROM app_users WHERE email='editor@example.test'"))
        .rows[0]!,
      before = (
        await f.pool.query('SELECT site_id,role FROM site_memberships WHERE user_id=$1 ORDER BY site_id', [user.id])
      ).rows,
      heads = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows
    await signIn(page, 'root@example.test')
    await page.goto('/people')
    await expect(page.getByRole('heading', { name: 'People', level: 1, exact: true })).toBeVisible()
    await expect(page.getByRole('main').getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Invite a person', exact: true })).toHaveText('Invite someone')
    await expect(page.getByRole('heading', { name: 'Access at a glance', exact: true })).toBeVisible()
    const table = page.getByRole('table', { name: 'People and access', exact: true }),
      person = table.getByRole('row').filter({ hasText: 'editor@example.test' }),
      capture = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 1000 })
          await page.evaluate(() => document.fonts.ready)
          await page
            .getByRole('heading', { name: 'People', level: 1, exact: true })
            .evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }))
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
        }
      }
    await capture('people')
    await person.getByRole('button', { name: 'Edit access for editor@example.test', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Edit account access', exact: true }),
      region = page.getByRole('region', { name: 'Edit account access', exact: true })
    await expect(panel).toHaveAttribute('aria-modal', 'false')
    await expect(region.getByRole('button', { name: 'Save account access', exact: true })).toBeVisible()
    await capture('account')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect
        .poll(async () => {
          const box = await region.getByRole('button', { name: 'Save account access', exact: true }).boundingBox()
          return box!.y + box!.height <= 1000
        })
        .toBe(true)
      if (width === 1024) {
        await expect(table.getByRole('columnheader', { name: 'Role', exact: true })).toBeHidden()
        await expect(table.getByRole('columnheader', { name: 'Can edit', exact: true })).toBeHidden()
      }
      for (const row of await table.locator('tbody tr').all()) await expect(row.getByRole('button')).toHaveCount(1)
      const list = await table.boundingBox(),
        details = await panel.boundingBox()
      expect(details!.x).toBeGreaterThanOrEqual(list!.x + list!.width)
    }
    await region.getByLabel('Name', { exact: true }).fill('[Unsaved account label]')
    await panel.getByRole('button', { name: 'Close Edit account access', exact: true }).click()
    const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(region.getByLabel('Name', { exact: true })).toHaveValue('[Unsaved account label]')
    await capture('keep-editing')
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    await page.route('**/people', async route => {
      if (route.request().method() === 'POST') {
        await held
        await route.continue()
      } else await route.continue()
    })
    await region.getByRole('button', { name: 'Save account access', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'Close Edit account access', exact: true })).toBeDisabled()
    await expect(page.getByRole('searchbox', { name: 'Find a person', exact: true })).toBeDisabled()
    await capture('pending')
    release()
    await expect(panel).toBeHidden()
    await expect(person).toContainText('[Unsaved account label]')
    await page.getByRole('button', { name: 'Invite a person', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Invite a person', exact: true })).toBeVisible()
    await capture('invite')
    await page
      .getByRole('dialog', { name: 'Invite a person', exact: true })
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await page.getByRole('searchbox', { name: 'Find a person', exact: true }).fill('no-person-matches-this')
    await expect(page.getByRole('heading', { name: 'No people match', exact: true })).toBeVisible()
    await capture('empty')
    expect(
      (await f.pool.query('SELECT site_id,role FROM site_memberships WHERE user_id=$1 ORDER BY site_id', [user.id]))
        .rows,
    ).toEqual(before)
    expect((await f.pool.query('SELECT id,status,auth_subject FROM app_users WHERE id=$1', [user.id])).rows[0]).toEqual(
      user,
    )
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(heads)
  } finally {
    release()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
