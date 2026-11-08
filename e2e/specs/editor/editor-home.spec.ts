import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'
test('native content Home starts from saved tasks, keeps site context and exposes only role-allowed controls without a source refresh', async ({
  browser,
}, info) => {
  test.setTimeout(150000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/editor-home/' + info.project.name),
    suffix = randomUUID().slice(0, 8),
    accounts = [
      { email: 'home-editor-' + suffix + '@example.test', role: 'editor' },
      { email: 'home-contributor-' + suffix + '@example.test', role: 'contributor' },
    ],
    users: string[] = []
  let sourceReads = 0
  try {
    await mkdir(folder, { recursive: true })
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    for (const account of accounts) {
      const id = (await f.client.query('SELECT app.provision_user($1,$2) AS id', [account.email, '[Name]'])).rows[0]!.id
      users.push(id)
      await f.client.query('SELECT app.set_site_membership($1,$2,$3)', [id, f.siteId, account.role])
      await f.client.query('UPDATE app_users SET auth_subject=$1 WHERE id=$2', ['local|' + account.email, id])
    }
    await f.client.query('COMMIT')
    const before = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.siteId,
        ])
      ).rows,
      sourceChecks = (await f.pool.query('SELECT count(*)::int n FROM story_source_checks')).rows[0]!.n
    for (const account of accounts) {
      const context = await browser.newContext()
      try {
        const active = await context.newPage()
        await active.route(/https:\/\/(www\.)?sawso\.org\//, async route => {
          sourceReads++
          await route.abort()
        })
        await signIn(active, account.email)
        await expect(active.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
        const nav = active.getByRole('navigation', { name: 'Sections of the CMS', exact: true }),
          links = await nav.getByRole('link').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
        expect(links).toEqual(
          account.role === 'editor'
            ? ['Home', 'Pages', 'Stories', 'Media', 'Publish']
            : ['Home', 'Pages', 'Stories', 'Media'],
        )
        await expect(nav.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('href', '/?site=' + f.siteId)
        await expect(active.getByRole('link', { name: 'Edit a page', exact: true })).toHaveAttribute(
          'href',
          '/sites/' + f.siteId + '/pages',
        )
        await expect(active.getByRole('heading', { name: 'Needs attention', exact: true })).toBeVisible()
        await expect(active.getByRole('link', { name: 'Add a story', exact: true })).toBeVisible()
        await expect(active.getByRole('link', { name: 'Add a story', exact: true })).toHaveCount(1)
        for (const width of [1440, 1024]) {
          await active.setViewportSize({ width, height: 950 })
          expect(await active.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await active.screenshot({ path: resolve(folder, account.role + '-home-' + width + '.png') })
        }
        await active.getByRole('link', { name: 'Edit a page', exact: true }).click()
        await expect(active).toHaveURL('/sites/' + f.siteId + '/pages')
        await nav.getByRole('link', { name: 'Home', exact: true }).click()
        await expect(active).toHaveURL('/?site=' + f.siteId)
        await expect(active.getByRole('link', { name: 'SAWSO', exact: true })).toHaveAttribute(
          'href',
          '/sites/' + f.siteId,
        )
        if (account.role === 'editor') {
          await active.getByRole('link', { name: 'See what’s coming up', exact: true }).click()
          await expect(active).toHaveURL('/sites/' + f.siteId + '/stories?view=soon')
          await nav.getByRole('link', { name: 'Home', exact: true }).click()
          await active.getByRole('link', { name: 'Add a story', exact: true }).click()
          await expect(active).toHaveURL('/sites/' + f.siteId + '/stories/new')
        } else {
          await active.getByRole('link', { name: 'Add a story', exact: true }).click()
          await expect(active).toHaveURL('/sites/' + f.siteId + '/stories/new')
        }
        await active.goto('/?site=' + randomUUID())
        await expect(active.getByRole('status').filter({ hasText: 'That site is not available to you.' })).toBeVisible()
        for (const width of [1440, 1024]) {
          await active.setViewportSize({ width, height: 950 })
          await active.screenshot({ path: resolve(folder, account.role + '-unavailable-site-' + width + '.png') })
        }
      } finally {
        await context.close()
      }
    }
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.siteId,
        ])
      ).rows,
    ).toEqual(before)
    expect((await f.pool.query('SELECT count(*)::int n FROM story_source_checks')).rows[0]!.n).toBe(sourceChecks)
    expect(sourceReads).toBe(0)
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    if (users.length) {
      await f.client.query('BEGIN')
      await f.client.query('SET LOCAL ROLE cms_authenticated_user')
      await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
      for (const user of users) await f.client.query("SELECT app.set_user_status($1,'disabled')", [user])
      await f.client.query('COMMIT')
    }
    await f.pool.query('DELETE FROM site_memberships WHERE site_id=$1 AND user_id=ANY($2::uuid[])', [f.siteId, users])
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
