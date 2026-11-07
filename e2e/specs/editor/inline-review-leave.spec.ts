import { test, expect, type Page, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'

test('inline Publish reviews keep both private comments through leave choices and storage failures', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/inline-review-leave/' + info.project.name)
  const root = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
    author = (await c.query("SELECT id FROM app_users WHERE email='contributor@example.test'")).rows[0]!.id
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
  const capture = async (active: Page, name: string, focus?: Locator) => {
    for (const width of [1440, 1024]) {
      await active.setViewportSize({ width, height: 950 })
      if (focus) await focus.evaluate(node => node.scrollIntoView({ block: 'center' }))
      expect(await active.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await active.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
    }
  }
  try {
    await mkdir(folder, { recursive: true })
    const pageRequest = await as(author, async () => {
      const before = (
        await c.query(
          'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.pages[0]],
        )
      ).rows[0]!
      before.content[0].values.heading = '[Saved page heading]'
      const saved = (
        await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          f.pages[0],
          before.revision,
          JSON.stringify(before.content),
          JSON.stringify(before.meta),
        ])
      ).rows[0]!
      return (
        await c.query('SELECT * FROM app.submit_page_for_review($1,$2,$3)', [
          f.pages[0],
          saved.revision,
          '[Page review note]',
        ])
      ).rows[0]!.submission_id
    })
    const list = await as(root, async () => {
      const id = (
        await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
          f.site,
          'review-notes',
          '[Review notes]',
          'review_notes_' + randomUUID().slice(0, 8),
          JSON.stringify([
            { key: 'name', label: 'Name', type: 'text', required: true },
            { key: 'role', label: 'Role', type: 'text', required: false },
          ]),
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
        JSON.stringify([{ id: null, stableKey: 'current', values: { name: '[Current item]', role: 'Before review' } }]),
      ])
      await c.query('SELECT app.publish_collection_schema($1,1)', [id])
      await c.query('SELECT app.publish_collection_entries($1,1)', [id])
      return id
    })
    const listRequest = await as(author, async () => {
      const head = (await c.query('SELECT revision,entry_revision FROM collections WHERE id=$1', [list])).rows[0]!,
        rows = (
          await c.query(
            'SELECT e.id,e.stable_key AS "stableKey",v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL',
            [list],
          )
        ).rows
      rows[0]!.values.role = 'After review'
      const saved = (
        await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
          list,
          head.entry_revision,
          JSON.stringify(rows),
        ])
      ).rows[0]!
      return (
        await c.query('SELECT app.submit_collection_for_review($1,$2,$3,$4) id', [
          list,
          head.revision,
          saved.entry_revision,
          '[List review note]',
        ])
      ).rows[0]!.id
    })
    const heads = (
      await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [f.site])
    ).rows
    const address = '/sites/' + f.site + '/publishing?review=' + pageRequest + '&collectionReview=' + listRequest
    const open = () => page.goto(address),
      pageReview = page
        .locator('.review-board')
        .filter({ has: page.getByRole('heading', { name: 'Welcome', exact: true }) }),
      listReview = page.getByRole('region', { name: 'List reviews', exact: true })
    const pageComment = pageReview.getByLabel('Add a comment', { exact: true }),
      listComment = listReview.getByLabel('Add a comment', { exact: true }),
      history = () =>
        page
          .getByRole('tablist', { name: 'Publish', exact: true })
          .getByRole('tab', { name: 'History', exact: true })
          .click()
    await signIn(page, 'editor@example.test')
    await open()
    await pageComment.fill('[Private page comment]')
    await listComment.fill('[Private list comment]')
    await history()
    const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toContainText('your page review comment')
    await expect(leave).toContainText('your list review comment')
    await capture(page, 'both-comments-leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(pageComment).toHaveValue('[Private page comment]')
    await expect(listComment).toHaveValue('[Private list comment]')
    await history()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(/tab=history$/)
    expect((await c.query('SELECT count(*)::int n FROM comments WHERE item_id=$1', [f.pages[0]])).rows[0]!.n).toBe(0)
    expect(
      (await c.query('SELECT count(*)::int n FROM collection_review_comments WHERE review_id=$1', [listRequest]))
        .rows[0]!.n,
    ).toBe(0)
    await open()
    await expect(pageComment).toHaveValue('[Private page comment]')
    await expect(listComment).toHaveValue('[Private list comment]')
    await capture(page, 'page-restored', pageReview.locator('.review-comment-compose'))
    await capture(page, 'list-restored', listReview.locator('#collection-review-comment'))
    await pageComment.fill('[Changed page words]')
    await listComment.fill('[Changed list words]')
    await history()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(/tab=history$/)
    await open()
    await expect(pageComment).toHaveValue('[Private page comment]')
    await expect(listComment).toHaveValue('[Private list comment]')
    const failedContext = await browser.newContext()
    try {
      await failedContext.addInitScript(() => {
        const original = Storage.prototype.setItem
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith('cms.comment-draft.'))
            throw new DOMException('Private storage unavailable', 'QuotaExceededError')
          return original.call(this, key, value)
        }
      })
      const failed = await failedContext.newPage()
      await signIn(failed, 'editor@example.test')
      await failed.goto(address)
      const failedPage = failed.locator('#review-comment'),
        failedList = failed.locator('#collection-review-comment')
      await expect(failedPage).toHaveValue('')
      await expect(failedList).toHaveValue('')
      await failedPage.fill('[Keep page words]')
      await failedList.fill('[Keep list words]')
      await failed
        .getByRole('tablist', { name: 'Publish', exact: true })
        .getByRole('tab', { name: 'History', exact: true })
        .click()
      const prompt = failed.getByRole('alertdialog', { name: 'Before you leave', exact: true })
      await prompt.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
      await expect(prompt.getByRole('alert')).toContainText('This browser could not save your comment draft.')
      await capture(failed, 'storage-error')
      await prompt.getByRole('button', { name: 'Keep editing', exact: true }).click()
      await expect(failedPage).toHaveValue('[Keep page words]')
      await expect(failedList).toHaveValue('[Keep list words]')
    } finally {
      await failedContext.close()
    }
    await listReview.getByRole('button', { name: 'Add comment', exact: true }).click()
    await expect(listComment).toHaveValue('')
    await expect(pageComment).toHaveValue('[Private page comment]')
    await pageComment.fill('[Words for a closed review]')
    const decisions = pageReview.locator('.review-decision-bar')
    await capture(page, 'page-ready', decisions)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await decisions.evaluate(node => node.scrollIntoView({ block: 'center' }))
      for (const control of await decisions.getByRole('button').all()) {
        const box = await control.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width - 12)
      }
    }
    await pageReview.getByRole('button', { name: 'Return with feedback', exact: true }).click()
    await expect(leave).toBeVisible()
    await capture(page, 'decision-leave')
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    const returned = page.getByRole('dialog', { name: 'Return this page for changes?', exact: true })
    await returned.getByLabel('What should change?', { exact: true }).fill('[Please check the page.]')
    await returned.getByRole('button', { name: 'Return with feedback', exact: true }).click()
    await expect(pageReview.getByRole('heading', { name: 'Your unsent comment', exact: true })).toBeVisible()
    await expect(pageReview).toContainText('[Words for a closed review]')
    await capture(
      page,
      'closed-private-comment',
      pageReview.getByRole('heading', { name: 'Your unsent comment', exact: true }),
    )
    await pageReview.getByRole('button', { name: 'Discard comment draft', exact: true }).click()
    await expect(pageReview.getByRole('heading', { name: 'Your unsent comment', exact: true })).toHaveCount(0)
    expect((await c.query('SELECT count(*)::int n FROM comments WHERE item_id=$1', [f.pages[0]])).rows[0]!.n).toBe(0)
    expect(
      (await c.query('SELECT count(*)::int n FROM collection_review_comments WHERE review_id=$1', [listRequest]))
        .rows[0]!.n,
    ).toBe(1)
    expect(
      (
        await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(heads)
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
