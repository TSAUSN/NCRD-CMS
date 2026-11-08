import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'

test('Lists review keeps exact changed values and decisions together while protecting private comments', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    suffix = randomUUID().slice(0, 8),
    folder = resolve('../.r8-progress/round3/list-reviews-admin/' + info.project.name)
  const authorEmail = 'list-author-' + suffix + '@example.test',
    reviewerEmail = 'list-reviewer-' + suffix + '@example.test',
    users: string[] = [],
    lists: {
      id: string
      request: string
      entries: { id: string; stableKey: string; values: Record<string, unknown> }[]
    }[] = []
  const root = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
  async function as<T>(actor: string, run: () => Promise<T>) {
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    try {
      const result = await run()
      await c.query('COMMIT')
      return result
    } catch (error) {
      await c.query('ROLLBACK')
      throw error
    }
  }
  const capture = async (active: Page, name: string) => {
    for (const width of [1440, 1024]) {
      await active.setViewportSize({ width, height: 950 })
      expect(await active.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await active.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
    }
  }
  const open = (id: string) => page.goto('/inbox?collectionReview=' + id)
  const discussion = () => page.getByRole('tab', { name: /^Discussion/ }).click()
  try {
    await mkdir(folder, { recursive: true })
    await as(root, async () => {
      for (const [email, role] of [
        [authorEmail, 'contributor'],
        [reviewerEmail, 'site_admin'],
      ]) {
        const id = (await c.query('SELECT app.provision_user($1,$2) id', [email, '[Name]'])).rows[0]!.id
        users.push(id)
        await c.query('SELECT app.set_site_membership($1,$2,$3)', [id, f.site, role])
      }
    })
    for (const [index, email] of [authorEmail, reviewerEmail].entries())
      await f.pool.query('UPDATE app_users SET auth_subject=$1 WHERE id=$2', ['local|' + email, users[index]])
    await signIn(page, reviewerEmail)
    await page.goto('/inbox?area=lists')
    await expect(page.getByRole('heading', { name: 'No list submissions yet', exact: true })).toBeVisible()
    await capture(page, 'empty')
    const pageHeads = (
      await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [f.site])
    ).rows
    const fields = [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'role', label: 'Role', type: 'text', required: false },
      { key: 'body', label: 'Details', type: 'richtext', required: false },
    ]
    for (const [index, title] of ['[First list]', '[Second list]'].entries()) {
      const id = await as(root, async () => {
        const id = (
          await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
            f.site,
            'review-list-' + index,
            title,
            'review_items_' + index,
            JSON.stringify(fields),
            JSON.stringify({
              schemaVersion: 1,
              titleField: 'name',
              subtitleField: 'role',
              imageField: null,
              groupField: null,
            }),
          ])
        ).rows[0]!.collection_id
        await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
          id,
          JSON.stringify([
            {
              id: null,
              stableKey: 'current',
              values: { name: '[Current item]', role: 'Before review', body: '<p><strong>Saved detail</strong></p>' },
            },
            { id: null, stableKey: 'removed', values: { name: '[Removed item]', role: 'Earlier role' } },
          ]),
        ])
        await c.query('SELECT app.publish_collection_schema($1,1)', [id])
        await c.query('SELECT app.publish_collection_entries($1,1)', [id])
        return id
      })
      const old = (
        await c.query(
          'SELECT e.id,e.stable_key AS "stableKey",v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index',
          [id],
        )
      ).rows
      const entries = [
        { ...old[0]!, values: { ...old[0]!.values, role: 'After review' } },
        { id: null, stableKey: 'added', values: { name: '[Added item]', role: 'New role' } },
      ]
      const request = await as(users[0]!, async () => {
        const head = (await c.query('SELECT revision,entry_revision FROM collections WHERE id=$1', [id])).rows[0]!
        const saved = (
          await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
            id,
            head.entry_revision,
            JSON.stringify(entries),
          ])
        ).rows[0]!
        return (
          await c.query('SELECT app.submit_collection_for_review($1,$2,$3,$4) id', [
            id,
            head.revision,
            saved.entry_revision,
            '[Please review the saved list.]',
          ])
        ).rows[0]!.id
      })
      const saved = (
        await c.query(
          'SELECT e.id,e.stable_key AS "stableKey",v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index',
          [id],
        )
      ).rows
      lists.push({ id, request, entries: saved })
    }
    await open(randomUUID())
    await expect(page.getByRole('heading', { name: 'This list review is unavailable', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve and publish list', exact: true })).toHaveCount(0)
    await capture(page, 'unavailable')
    await open(lists[0]!.request)
    const changes = page.getByRole('region', { name: 'Saved list changes', exact: true })
    await expect(changes).toContainText('Before review')
    await expect(changes).toContainText('After review')
    await expect(changes).toContainText('[Added item]')
    await expect(changes).toContainText('[Removed item]')
    await expect(page.getByRole('region', { name: 'Submitted list', exact: true })).toBeHidden()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      for (const button of await page
        .getByRole('group', { name: 'List review decision', exact: true })
        .getByRole('button')
        .all()) {
        const box = await button.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x + box!.width).toBeLessThanOrEqual(width - 12)
      }
    }
    await capture(page, 'changes')
    await page.getByText('All saved values', { exact: true }).click()
    const submitted = page.getByRole('region', { name: 'Submitted list', exact: true })
    await expect(submitted).toContainText('Saved detail')
    await submitted.evaluate(node => node.scrollIntoView({ block: 'start' }))
    await capture(page, 'all-values')
    await submitted.getByText('Advanced', { exact: true }).first().click()
    await capture(page, 'field-design')
    await page.getByRole('searchbox', { name: 'Search list review requests', exact: true }).fill('no matching list')
    await expect(page.getByRole('status').filter({ hasText: 'No matching requests.' })).toBeVisible()
    await capture(page, 'search-empty')
    await page.getByRole('searchbox', { name: 'Search list review requests', exact: true }).fill('')
    await discussion()
    await page.getByLabel('Add a comment', { exact: true }).fill('[Unsent list comment]')
    await page.getByRole('link', { name: /^\[Second list\]/ }).click()
    const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toBeVisible()
    await capture(page, 'comment-leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page.getByLabel('Add a comment', { exact: true })).toHaveValue('[Unsent list comment]')
    await page.getByRole('link', { name: /^\[Second list\]/ }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('collectionReview=' + lists[1]!.request))
    expect(
      (await c.query('SELECT count(*)::int n FROM collection_review_comments WHERE review_id=$1', [lists[0]!.request]))
        .rows[0]!.n,
    ).toBe(0)
    await page.getByRole('link', { name: /^\[First list\]/ }).click()
    await expect(page).toHaveURL(new RegExp('collectionReview=' + lists[0]!.request))
    await expect(page.getByRole('heading', { name: '[First list]', exact: true })).toBeVisible()
    await discussion()
    await expect(page.getByLabel('Add a comment', { exact: true })).toHaveValue('[Unsent list comment]')
    await capture(page, 'comment-restored')
    await page.getByRole('button', { name: 'Add comment', exact: true }).click()
    await expect(page.getByLabel('Add a comment', { exact: true })).toHaveValue('')
    await expect(page.getByRole('status').filter({ hasText: 'Comment added.' })).toBeVisible()
    await page.getByRole('button', { name: 'Resolve', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible()
    const fail = '**/inbox*'
    await page.route(fail, async route =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, body: 'A local failure response' })
        : route.continue(),
    )
    await page.getByLabel('Add a comment', { exact: true }).fill('[Keep these words]')
    await page.getByRole('button', { name: 'Add comment', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('The result could not be confirmed.')
    await expect(page.getByLabel('Add a comment', { exact: true })).toHaveValue('[Keep these words]')
    await capture(page, 'comment-error')
    await page.unroute(fail)
    await page.getByLabel('Add a comment', { exact: true }).fill('')
    await page.getByRole('link', { name: /^\[Second list\]/ }).click()
    await expect(page).toHaveURL(new RegExp('collectionReview=' + lists[1]!.request))
    await expect(page.getByRole('heading', { name: '[Second list]', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Return with feedback', exact: true }).click()
    const returned = page.getByRole('dialog', { name: 'Return this list for changes?', exact: true })
    await returned.getByLabel('What should change?', { exact: true }).fill('[Check the saved role.]')
    await capture(page, 'return')
    await returned.getByRole('button', { name: 'Return with feedback', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Returned with feedback.' })).toBeVisible()
    await capture(page, 'returned')
    const resubmitted = await as(users[0]!, async () => {
      const head = (await c.query('SELECT revision,entry_revision FROM collections WHERE id=$1', [lists[1]!.id]))
        .rows[0]!
      return (
        await c.query('SELECT app.submit_collection_for_review($1,$2,$3,$4) id', [
          lists[1]!.id,
          head.revision,
          head.entry_revision,
          '[Ready for another review.]',
        ])
      ).rows[0]!.id
    })
    const expectedLive = (
      await c.query(
        'SELECT id,draft_version_id FROM collection_entries WHERE collection_id=$1 AND archived_at IS NULL ORDER BY id',
        [lists[1]!.id],
      )
    ).rows
    await open(resubmitted)
    await page.getByRole('button', { name: 'Approve and publish list', exact: true }).click()
    const approval = page.getByRole('alertdialog', { name: 'Publish this submitted list?', exact: true })
    await capture(page, 'approval')
    await approval.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Approve and publish list', exact: true }).click()
    await approval.getByRole('button', { name: 'Approve and publish list', exact: true }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Approved and published the submitted list.' }),
    ).toBeVisible()
    await expect(page.getByRole('region', { name: 'Saved list changes', exact: true })).toContainText(
      'Approved submission',
    )
    await capture(page, 'approved')
    expect(
      (
        await c.query(
          'SELECT id,published_version_id FROM collection_entries WHERE collection_id=$1 AND published_archived_at IS NULL ORDER BY id',
          [lists[1]!.id],
        )
      ).rows,
    ).toEqual(expectedLive.map(row => ({ id: row.id, published_version_id: row.draft_version_id })))
    const authorContext = await browser.newContext()
    try {
      const author = await authorContext.newPage()
      await signIn(author, authorEmail)
      await author.goto('/inbox?collectionReview=' + lists[0]!.request)
      await expect(author.getByRole('region', { name: 'Saved list changes', exact: true })).toContainText(
        'After review',
      )
      await expect(author.getByRole('button', { name: 'Approve and publish list', exact: true })).toHaveCount(0)
      await capture(author, 'author')
    } finally {
      await authorContext.close()
    }
    await as(users[0]!, async () => {
      const entries = structuredClone(lists[0]!.entries)
      entries[0]!.values.role = 'Newer private words'
      const head = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [lists[0]!.id])).rows[0]!
      await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        lists[0]!.id,
        head.entry_revision,
        JSON.stringify(entries),
      ])
    })
    await open(lists[0]!.request)
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'The saved list has changed since submission.',
    )
    await expect(page.getByRole('button', { name: 'Approve and publish list', exact: true })).toHaveCount(0)
    expect(
      (await c.query('SELECT status FROM collection_reviews WHERE id=$1', [lists[0]!.request])).rows[0]!.status,
    ).toBe('superseded')
    await expect(changes).toContainText('Current saved draft')
    await expect(changes).toContainText('Newer private words')
    await expect(changes.getByText('After approval', { exact: true })).toHaveCount(0)
    await capture(page, 'stale')
    expect(
      (
        await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(pageHeads)
    expect(
      (await c.query('SELECT count(*)::int n FROM collection_review_comments WHERE review_id=$1', [lists[0]!.request]))
        .rows[0]!.n,
    ).toBe(1)
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    if (users.length) {
      await as(root, async () => {
        for (const id of users) await c.query("SELECT app.set_user_status($1,'disabled')", [id])
      })
      await f.pool.query('DELETE FROM site_memberships WHERE site_id=$1 AND user_id=ANY($2::uuid[])', [f.site, users])
    }
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
