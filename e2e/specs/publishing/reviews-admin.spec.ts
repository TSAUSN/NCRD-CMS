import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'

test('Reviews uses a readable queue and decisions, protects unsent comments and recovers its real loading and error states', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await siteLookFixture(),
    client = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/reviews-admin/' + info.project.name),
    suffix = randomUUID().slice(0, 8),
    accounts = [
      { email: 'reviews-author-' + suffix + '@example.test', role: 'contributor' },
      { email: 'reviews-admin-' + suffix + '@example.test', role: 'site_admin' },
    ],
    users: string[] = [],
    requests: string[] = []
  const root = (await f.pool.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
  let revoked = false
  const capture = async (active: Page, name: string) => {
    for (const width of [1440, 1024]) {
      await active.setViewportSize({ width, height: 950 })
      expect(await active.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await active.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
    }
  }
  async function as<T>(actor: string, run: () => Promise<T>) {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE cms_authenticated_user')
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    try {
      const result = await run()
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
  const open = (id: string) => page.goto('/inbox?review=' + id)
  const discussion = () => page.getByRole('tab', { name: /^Discussion/ }).click()
  try {
    await mkdir(folder, { recursive: true })
    await as(root, async () => {
      for (const account of accounts) {
        const user = (await client.query('SELECT app.provision_user($1,$2) id', [account.email, '[Name]'])).rows[0]!.id
        users.push(user)
        await client.query('SELECT app.set_site_membership($1,$2,$3)', [user, f.site, account.role])
      }
    })
    for (const [index, account] of accounts.entries())
      await f.pool.query('UPDATE app_users SET auth_subject=$1 WHERE id=$2', ['local|' + account.email, users[index]])
    await signIn(page, accounts[1]!.email)
    await page.goto('/inbox')
    await expect(page.getByRole('heading', { name: 'Reviews', exact: true, level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Nothing has been submitted yet', exact: true })).toBeVisible()
    await capture(page, 'empty')
    await open(randomUUID())
    await expect(page.getByRole('heading', { name: 'This review is unavailable', exact: true })).toBeVisible()
    await capture(page, 'unavailable')
    await page.getByRole('link', { name: 'Advanced', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Custom-section requests', exact: true })).toBeVisible()
    await capture(page, 'advanced-empty')
    await as(users[0]!, async () => {
      for (const [index, id] of f.pages.entries()) {
        const current = (
          await client.query(
            'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
            [id],
          )
        ).rows[0]!
        current.content[0].values.heading = index === 0 ? 'Programs for our community' : 'Plan a local visit'
        const saved = (
          await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
            id,
            current.revision,
            JSON.stringify(current.content),
            JSON.stringify(current.meta),
          ])
        ).rows[0]!
        requests.push(
          (
            await client.query('SELECT * FROM app.submit_page_for_review($1,$2,$3)', [
              id,
              saved.revision,
              '[Review note]',
            ])
          ).rows[0]!.submission_id,
        )
      }
    })
    await open(requests[0]!)
    await expect(page.getByRole('region', { name: 'Saved changes', exact: true })).toContainText(
      'Welcome: changed heading',
    )
    await expect(
      page
        .getByRole('region', { name: 'Saved changes', exact: true })
        .getByText('Programs for our community', { exact: true }),
    ).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      const actions = page.getByRole('group', { name: 'Review decision', exact: true }),
        buttons = actions.getByRole('button').or(actions.getByRole('link'))
      for (const control of await buttons.all()) {
        const box = await control.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThan(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width - 12)
      }
    }
    expect(
      await page
        .getByRole('button', { name: 'Approve and publish', exact: true })
        .evaluate(node => getComputedStyle(node).backgroundColor),
    ).toBe('rgb(200, 16, 46)')
    await capture(page, 'changes')
    const separator = page.getByRole('separator', { name: 'Resize Review requests', exact: true })
    await separator.focus()
    await separator.press('ArrowRight')
    await expect(separator).toHaveAttribute('aria-valuenow', '316')
    await page.reload()
    await expect(separator).toHaveAttribute('aria-valuenow', '316')
    await capture(page, 'widened')
    await separator.dblclick()
    await expect(separator).toHaveAttribute('aria-valuenow', '300')
    await page.getByRole('tab', { name: 'Preview', exact: true }).click()
    await expect(
      page.frameLocator('iframe[title^="Submitted version of"]').getByRole('heading', { level: 1 }),
    ).toHaveText('Programs for our community')
    await capture(page, 'preview')
    await discussion()
    await page.getByLabel('Add a comment', { exact: true }).fill('[Unsent review comment]')
    await page.getByRole('link', { name: /^Visit us/ }).click()
    const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toBeVisible()
    await capture(page, 'comment-leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page.getByLabel('Add a comment', { exact: true })).toHaveValue('[Unsent review comment]')
    await page.getByRole('link', { name: /^Visit us/ }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('review=' + requests[1]))
    expect(
      (
        await f.pool.query(
          'SELECT count(*)::int n FROM comments WHERE item_id=(SELECT item_id FROM submissions WHERE id=$1) AND version_id=(SELECT version_id FROM submissions WHERE id=$1)',
          [requests[0]],
        )
      ).rows[0]!.n,
    ).toBe(0)
    await page.getByRole('link', { name: /^Welcome/ }).click()
    await expect(page).toHaveURL(new RegExp('review=' + requests[0]))
    await expect(page.getByRole('heading', { name: 'Welcome', exact: true, level: 2 })).toBeVisible()
    await discussion()
    await expect(page.getByLabel('Add a comment', { exact: true })).toHaveValue('[Unsent review comment]')
    await capture(page, 'comment-restored')
    await page.getByLabel('Add a comment', { exact: true }).fill('[Changed unsent words]')
    await page.getByRole('link', { name: /^Visit us/ }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('review=' + requests[1]))
    await page.getByRole('link', { name: /^Welcome/ }).click()
    await expect(page).toHaveURL(new RegExp('review=' + requests[0]))
    await expect(page.getByRole('heading', { name: 'Welcome', exact: true, level: 2 })).toBeVisible()
    await discussion()
    await expect(page.getByLabel('Add a comment', { exact: true })).toHaveValue('[Unsent review comment]')
    const duplicateRefreshes: string[] = []
    const observeRefresh = (request: import('@playwright/test').Request) => {
      const headers = request.headers()
      if (
        request.method() === 'GET' &&
        new URL(request.url()).pathname === '/inbox' &&
        headers['rsc'] === '1' &&
        headers['next-router-prefetch'] !== '1' &&
        headers['purpose'] !== 'prefetch'
      )
        duplicateRefreshes.push(request.url())
    }
    page.on('request', observeRefresh)
    await page.getByRole('button', { name: 'Add comment', exact: true }).click()
    await expect(page.getByLabel('Add a comment', { exact: true })).toHaveValue('')
    expect(duplicateRefreshes).toEqual([])
    page.off('request', observeRefresh)
    expect(
      (
        await f.pool.query(
          'SELECT count(*)::int n FROM comments WHERE item_id=(SELECT item_id FROM submissions WHERE id=$1) AND version_id=(SELECT version_id FROM submissions WHERE id=$1)',
          [requests[0]],
        )
      ).rows[0]!.n,
    ).toBe(1)
    const authorContext = await browser.newContext()
    try {
      const author = await authorContext.newPage()
      await signIn(author, accounts[0]!.email)
      await author.goto('/inbox?review=' + requests[0])
      await expect(author.getByRole('heading', { name: 'Welcome', exact: true, level: 2 })).toBeVisible()
      await expect(author.getByRole('region', { name: 'Saved changes', exact: true })).toContainText(
        'Programs for our community',
      )
      await expect(author.getByRole('button', { name: 'Approve and publish', exact: true })).toHaveCount(0)
      await expect(author.getByRole('link', { name: 'Advanced', exact: true })).toHaveCount(0)
      await expect(author.getByRole('heading', { name: 'Custom-section requests', exact: true })).toHaveCount(0)
      await capture(author, 'author')
    } finally {
      await authorContext.close()
    }
    const blocker = await f.pool.connect()
    try {
      await blocker.query('BEGIN')
      await blocker.query('LOCK TABLE submissions IN ACCESS EXCLUSIVE MODE')
      await page.goto('/inbox?review=' + requests[0], { waitUntil: 'commit' })
      await expect(page.getByRole('status').filter({ hasText: 'Loading reviews…' })).toBeVisible()
      await capture(page, 'loading')
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
    }
    await expect(page.getByRole('heading', { name: 'Welcome', exact: true, level: 2 })).toBeVisible()
    // Restrict only this isolated test database, then restore its exact permission.
    expect((await f.pool.query('SELECT current_database() name')).rows[0]!.name).toMatch(/^cms_e2e(?:_|$)/)
    await f.pool.query(
      'REVOKE EXECUTE ON FUNCTION app.review_queue(uuid,boolean,integer,uuid,uuid) FROM cms_authenticated_user',
    )
    revoked = true
    try {
      await open(requests[0]!)
      await expect(page.getByRole('heading', { name: 'Reviews could not be loaded', exact: true })).toBeVisible()
      await capture(page, 'error')
    } finally {
      await f.pool.query(
        'GRANT EXECUTE ON FUNCTION app.review_queue(uuid,boolean,integer,uuid,uuid) TO cms_authenticated_user',
      )
      revoked = false
    }
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Welcome', exact: true, level: 2 })).toBeVisible()
    await page.getByRole('button', { name: 'Approve and publish', exact: true }).click()
    const confirmation = page.getByRole('alertdialog', { name: 'Approve and publish this version?', exact: true })
    await capture(page, 'confirmation')
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Approve and publish', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(confirmation).toHaveCount(0)
    await page.getByRole('button', { name: 'Approve and publish', exact: true }).click()
    await confirmation.getByRole('button', { name: 'Approve and publish', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Approved and published' })).toBeVisible()
    await capture(page, 'approved')
    expect((await f.pool.query('SELECT count(*)::int n FROM story_source_checks')).rows[0]!.n).toBe(0)
  } finally {
    if (revoked)
      await f.pool.query(
        'GRANT EXECUTE ON FUNCTION app.review_queue(uuid,boolean,integer,uuid,uuid) TO cms_authenticated_user',
      )
    await client.query('ROLLBACK').catch(() => {})
    if (users.length) {
      await as(root, async () => {
        for (const user of users) await client.query("SELECT app.set_user_status($1,'disabled')", [user])
      })
      await f.pool.query('DELETE FROM site_memberships WHERE site_id=$1 AND user_id=ANY($2::uuid[])', [f.site, users])
    }
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    client.release()
    await f.pool.end()
  }
})
