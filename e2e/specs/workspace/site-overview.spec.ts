import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'

test('native Site overview shows factual work cards, usable role actions and retained page management', async ({
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/site-overview/' + info.project.name)
  let sourceReads = 0
  try {
    await mkdir(folder, { recursive: true })
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    for (const [email, role] of [
      ['editor@example.test', 'editor'],
      ['contributor@example.test', 'contributor'],
    ]) {
      const user = (await f.client.query('SELECT id FROM app_users WHERE email=$1', [email])).rows[0]!.id
      await f.client.query('SELECT app.set_site_membership($1,$2,$3)', [user, f.siteId, role])
    }
    await f.client.query('SELECT app.provision_user($1,$2)', [
      'overview-unassigned-' + Date.now() + '@example.test',
      '[Unassigned account]',
    ])
    await f.client.query('COMMIT')
    const before = (
      await f.pool.query(
        'SELECT id,draft_version_id,published_version_id,revision FROM pages WHERE site_id=$1 ORDER BY id',
        [f.siteId],
      )
    ).rows
    for (const account of [
      { email: 'root@example.test', role: 'superadmin' },
      { email: 'editor@example.test', role: 'editor' },
      { email: 'contributor@example.test', role: 'contributor' },
    ]) {
      const context = await browser.newContext()
      try {
        const page = await context.newPage(),
          errors: string[] = []
        page.on('pageerror', e => errors.push(e.message))
        await page.route(/https:\/\/(www\.)?sawso\.org\//, async route => {
          sourceReads++
          await route.abort()
        })
        await signIn(page, account.email)
        await page.goto('/sites/' + f.siteId)
        const main = page.getByRole('main'),
          attention = main.getByRole('region', { name: 'Needs attention', exact: true }),
          lists = main.getByRole('region', { name: 'Lists', exact: true })
        await expect(main.getByRole('heading', { name: /^SAWSO(?: |$)/, level: 1 })).toBeVisible()
        await expect(main.getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
        await expect(attention.getByText(/pages? (has|have) changes not live/)).toBeVisible()
        await expect(lists).toBeVisible()
        await expect(main.getByRole('heading', { name: 'Recent changes', exact: true })).toBeVisible()
        await expect(main.getByRole('table', { name: 'Pages', exact: true })).toBeVisible()
        await expect(
          main
            .getByRole('table', { name: 'Pages', exact: true })
            .getByRole('link', { name: 'SAWSO Palu Nursing Dormitory, Indonesia', exact: true }),
        ).toHaveCount(0)
        const home = (await f.pool.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [f.siteId])).rows[0]!.id
        await expect(main.getByRole('link', { name: 'Edit home page', exact: true })).toHaveAttribute(
          'href',
          '/pages/' + home,
        )
        await expect(main.getByRole('link', { name: 'Change site look', exact: true })).toHaveCount(
          account.role === 'superadmin' ? 1 : 0,
        )
        await expect(main.getByRole('button', { name: 'Add a page', exact: true })).toHaveCount(
          account.role === 'contributor' ? 0 : 1,
        )
        if (account.role === 'superadmin') {
          const people = main.getByRole('region', { name: 'People', exact: true })
          await expect(people).toContainText('You')
          await expect(people).not.toContainText('[Unassigned account]')
        } else {
          await expect(main.getByRole('region', { name: 'People', exact: true })).toHaveCount(0)
          await expect(main.getByRole('region', { name: 'Your access', exact: true })).toContainText(
            account.role === 'editor' ? 'Site editor' : 'Content creator',
          )
        }
        if (account.role === 'contributor') {
          await expect(attention.getByRole('link', { name: 'Open page', exact: true })).toBeVisible()
          await expect(main.getByRole('link', { name: 'Publish', exact: true })).toHaveCount(0)
          await expect(main.getByText('Send your saved draft for approval.', { exact: false })).toBeVisible()
        }
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
          await page.evaluate(() => document.fonts.ready)
          await expect
            .poll(async () => {
              const a = await attention.boundingBox(),
                l = await lists.boundingBox()
              return Boolean(a && l && l.x > a.x + a.width)
            })
            .toBe(true)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, account.role + '-' + width + '.png'), animations: 'disabled' })
        }
        if (account.role !== 'contributor') {
          await main.getByRole('button', { name: 'Add a page', exact: true }).click()
          await expect(page.getByRole('dialog', { name: 'New page', exact: true })).toBeVisible()
          await page
            .getByRole('dialog', { name: 'New page', exact: true })
            .getByRole('button', { name: 'Cancel', exact: true })
            .click()
        }
        expect(errors).toEqual([])
      } finally {
        await context.close()
      }
    }
    expect(
      (
        await f.pool.query(
          'SELECT id,draft_version_id,published_version_id,revision FROM pages WHERE site_id=$1 ORDER BY id',
          [f.siteId],
        )
      ).rows,
    ).toEqual(before)
    expect(sourceReads).toBe(0)
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
