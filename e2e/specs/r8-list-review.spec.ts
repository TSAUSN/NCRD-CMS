import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { e2eTarget } from '../test-target.ts'
import { signIn } from './helpers.ts'
async function capture(page: Page, name: string) {
  const folder = resolve('../.r8-progress/step-4/list-review-picker')
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await page.screenshot({ path: resolve(folder, `${name}-${width}.png`), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
test('a contributor submits list changes and an editor publishes exactly the reviewed items', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const contributorContext = await browser.newContext(),
    reviewerContext = await browser.newContext()
  const { host, port, database } = e2eTarget(),
    client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  await client.connect()
  try {
    await signIn(page, 'root@example.test')
    await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
    await page.getByRole('link', { name: 'Lists', exact: true }).click()
    await page.getByRole('button', { name: 'New list', exact: true }).click()
    const create = page.getByRole('dialog', { name: 'Create a list', exact: true })
    await create.getByLabel('List name', { exact: true }).fill('Reviewed workshop coordinators ' + Date.now())
    await create.getByRole('button', { name: 'Create list', exact: true }).click()
    await expect(page).toHaveURL(/collection=/)
    const address = page.url(),
      collectionId = new URL(address).searchParams.get('collection')!
    await page.getByRole('button', { name: 'More list actions', exact: true }).click()
    await page.getByRole('button', { name: 'Publish field changes', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'List fields published.' })).toBeVisible()
    await page.getByRole('button', { name: 'Add item', exact: true }).click()
    const add = page.getByRole('dialog', { name: 'Add item', exact: true })
    await add.getByRole('textbox', { name: /^Name(?: required)?$/ }).fill('Workshop coordinator')
    await add.getByLabel('Role or title', { exact: true }).fill('Before review')
    await add.getByRole('button', { name: 'Save item', exact: true }).click()
    await expect(add).toBeHidden()
    await page.getByRole('button', { name: 'Publish list', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish this list', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'item is now live.' })).toBeVisible()
    // Separate people keep separate sessions; do not tear down a streaming save
    // by clearing its cookies and hard-navigating the author's live window.
    page = await contributorContext.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await signIn(page, 'contributor@example.test')
    await page.goto(address)
    await page.getByRole('button', { name: 'Edit Workshop coordinator', exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Edit item', exact: true })
    await edit.getByLabel('Role or title', { exact: true }).fill('After review')
    await edit.getByRole('button', { name: 'Save item', exact: true }).click()
    await expect(edit).toBeHidden()
    const heads = (
      await client.query(
        'SELECT id,draft_version_id,published_version_id FROM collection_entries WHERE collection_id=$1 AND archived_at IS NULL ORDER BY id',
        [collectionId],
      )
    ).rows
    expect(heads).toHaveLength(1)
    expect(heads[0]!.draft_version_id).not.toBe(heads[0]!.published_version_id)
    await page.getByRole('button', { name: 'Submit for review', exact: true }).click()
    const submit = page.getByRole('dialog', { name: 'Submit this list for review?', exact: true })
    await submit
      .getByLabel('What should the reviewer know?', { exact: true })
      .fill('Please check the new role before publishing the saved list.')
    await capture(page, 'list-contributor-submit')
    await submit.getByRole('button', { name: 'Submit for review', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Waiting for review', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Publish list', exact: true })).toHaveCount(0)
    const discussion = await page.getByRole('link', { name: 'View discussion', exact: true }).getAttribute('href')
    expect(discussion).toContain('collectionReview=')
    page = await reviewerContext.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await signIn(page, 'editor@example.test')
    await page.goto(discussion!)
    const submitted = page.getByRole('region', { name: 'Submitted list', exact: true })
    await expect(submitted).toContainText('After review')
    await expect(page.getByRole('region', { name: 'Live when submitted', exact: true })).toContainText('Before review')
    await expect(submitted.getByText(/Record key:/)).toBeHidden()
    await expect(page.locator('time[datetime]').first()).toContainText('Eastern time')
    await capture(page, 'list-editor-review-time')
    await submitted.scrollIntoViewIfNeeded()
    await capture(page, 'list-editor-comparison')
    await page.getByRole('button', { name: 'Approve and publish list', exact: true }).click()
    const approval = page.getByRole('alertdialog', { name: 'Publish this submitted list?', exact: true })
    await expect(approval.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await capture(page, 'list-editor-approval')
    await approval.getByRole('button', { name: 'Approve and publish list', exact: true }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Approved and published the submitted list.' }),
    ).toBeVisible()
    const live = (
      await client.query(
        'SELECT id,published_version_id FROM collection_entries WHERE collection_id=$1 AND archived_at IS NULL ORDER BY id',
        [collectionId],
      )
    ).rows
    expect(live).toEqual(heads.map(row => ({ id: row.id, published_version_id: row.draft_version_id })))
    expect(errors).toEqual([])
    // Review snapshots are immutable history. This uniquely named disposable
    // fixture stays until the next global cms_e2e reset, rather than bypassing it.
  } finally {
    await contributorContext.close()
    await reviewerContext.close()
    await client.end()
  }
})
