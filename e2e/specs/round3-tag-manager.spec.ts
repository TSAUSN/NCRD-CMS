import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
import { STORIES_MODEL } from '../../packages/seeds/src/sawso-stories.ts'
import { SAWSO_THEME } from '../../packages/seeds/src/core-themes.ts'
import { emptyStoriesSettings } from '../../packages/schema/src/content/stories.ts'
import { withStoriesCatalog } from '../../apps/admin/src/lib/stories-catalog.ts'
test('a Site admin manages draft tags, keeps renamed IDs, moves stories and uses region map areas', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(true, true),
    suffix = randomUUID().slice(0, 8),
    email = 'tag-admin-' + suffix + '@example.test',
    editorEmail = 'tag-editor-' + suffix + '@example.test',
    folder = resolve('../.r8-progress/round3/tag-manager/' + info.project.name)
  await mkdir(folder, { recursive: true })
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({
        path: resolve(folder, name + '-' + width + '.png'),
        fullPage: true,
        animations: 'disabled',
      })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    for (const [address, role] of [
      [email, 'site_admin'],
      [editorEmail, 'editor'],
    ]) {
      const id = (await f.client.query('SELECT app.provision_user($1,$2) AS id', [address, '[Name]'])).rows[0]!.id
      await f.client.query('SELECT app.set_site_membership($1,$2,$3)', [id, f.siteId, role])
      await f.client.query('UPDATE app_users SET auth_subject=$1 WHERE id=$2', ['local|' + address, id])
    }
    await f.client.query('COMMIT')
    const base = '/sites/' + f.siteId + '/stories',
      tag = (id: string) => page.locator('[data-tag-id="' + id + '"]')
    const original = (
      await f.client.query(
        'SELECT e.id,v.values,e.published_version_id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.id',
        [f.collectionId],
      )
    ).rows
    await signIn(page, email)
    await page.goto(base)
    await page.getByRole('link', { name: 'Manage tags', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Manage tags', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
    await capture('main')
    await page.getByRole('button', { name: 'Add sector', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'Add a project sector', exact: true })
    await dialog.getByLabel('Name', { exact: true }).fill('Cancelled tag')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Cancelled tag', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Add sector', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Add a project sector', exact: true })
    await dialog.getByLabel('Name', { exact: true }).fill('Anniversary')
    await dialog.getByLabel('Suggest it for stories that mention', { exact: true }).fill('fifty years, anniversary')
    await capture('add')
    await dialog.getByRole('button', { name: 'Add tag', exact: true }).click()
    await expect(tag('anniversary')).toBeVisible()
    await tag('anniversary').getByRole('button', { name: 'Actions for Anniversary', exact: true }).click()
    await tag('anniversary').getByRole('button', { name: 'Rename Anniversary', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Edit Anniversary', exact: true })
    await dialog.getByLabel('Name', { exact: true }).fill('Fifty years')
    await dialog.getByRole('button', { name: 'Save tag', exact: true }).click()
    await expect(tag('anniversary')).toContainText('Fifty years')
    await expect(tag('anniversary').getByRole('button', { name: 'Reorder Fifty years', exact: true })).toBeEnabled()
    await tag('anniversary').getByRole('button', { name: 'Reorder Fifty years', exact: true }).focus()
    await page.keyboard.press('Alt+ArrowUp')
    await expect(page.getByRole('list', { name: 'Project Sectors', exact: true }).locator('li').nth(7)).toHaveAttribute(
      'data-tag-id',
      'anniversary',
    )
    await expect(tag('anniversary').getByRole('button', { name: 'Reorder Fifty years', exact: true })).toBeEnabled()
    await expect(tag('anniversary').getByRole('button', { name: 'Reorder Fifty years', exact: true })).toBeFocused()
    await tag('anniversary')
      .getByRole('button', { name: 'Reorder Fifty years', exact: true })
      .dragTo(tag('education').getByRole('button', { name: 'Reorder Education', exact: true }))
    await expect(page.getByRole('list', { name: 'Project Sectors', exact: true }).locator('li').nth(3)).toHaveAttribute(
      'data-tag-id',
      'anniversary',
    )
    await tag('education').getByRole('button', { name: 'Actions for Education', exact: true }).click()
    await tag('education').getByRole('button', { name: 'Delete Education', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Delete “Education”?', exact: true })
    await dialog.getByLabel('Move stories to', { exact: true }).selectOption('anniversary')
    await capture('delete')
    await dialog.getByRole('button', { name: 'Delete tag', exact: true }).click()
    await expect(tag('education')).toHaveCount(0)
    await expect(tag('anniversary')).toContainText('7 stories')
    await tag('capacity-building').getByRole('button', { name: 'Actions for Capacity Building', exact: true }).click()
    await tag('capacity-building').getByRole('button', { name: 'Delete Capacity Building', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Delete “Capacity Building”?', exact: true })
    await dialog.getByText('Just remove the tag', { exact: true }).click()
    await expect(dialog.getByRole('radio', { name: 'Just remove the tag', exact: true })).toBeChecked()
    await dialog.getByRole('button', { name: 'Delete tag', exact: true }).click()
    await expect(tag('capacity-building')).toHaveCount(0)
    await tag('africa').getByRole('button', { name: 'Actions for Africa', exact: true }).click()
    await tag('africa').getByRole('button', { name: 'Rename Africa', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Edit Africa', exact: true })
    await dialog.getByLabel('Name', { exact: true }).fill('African region')
    await dialog.getByRole('checkbox', { name: 'Africa', exact: true }).uncheck()
    await dialog.getByRole('checkbox', { name: 'North America', exact: true }).check()
    await capture('region-areas')
    await dialog.getByRole('button', { name: 'Save tag', exact: true }).click()
    await expect(tag('africa')).toContainText('African region')
    await page.getByRole('button', { name: 'Re-suggest tags for unreviewed stories', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toContainText('Reviewed stories keep their tags')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    const after = (
      await f.client.query(
        'SELECT e.id,v.values,e.published_version_id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.id',
        [f.collectionId],
      )
    ).rows
    expect(
      after.map(e => [
        e.id,
        e.values.body,
        e.values.photo,
        e.values.old_address,
        e.values.story_url,
        e.published_version_id,
      ]),
    ).toEqual(
      original.map(e => [
        e.id,
        e.values.body,
        e.values.photo,
        e.values.old_address,
        e.values.story_url,
        e.published_version_id,
      ]),
    )
    const moved = after.find(e => String(e.values.tags).split(',').includes('anniversary'))!
    await page.goto(base + '/' + moved.id)
    await expect(page.getByRole('button', { name: 'Fifty years', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'African region', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Asia', exact: true }).click()
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Story draft saved')
    await page.goto(base + '/tags')
    await page.getByRole('link', { name: 'Publish…', exact: true }).click()
    await expect(page).toHaveURL(/\/publishing\?lists=1/)
    await expect(page.getByRole('button', { name: /^Publish selected/ })).toBeVisible()
    const restricted = await browser.newContext(),
      editor = await restricted.newPage()
    try {
      await signIn(editor, editorEmail)
      await editor.goto(base)
      await expect(editor.getByRole('link', { name: 'Manage tags', exact: true })).toHaveCount(0)
      expect((await editor.goto(base + '/tags'))?.status()).toBe(404)
    } finally {
      await restricted.close()
    }
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
test('another site has its own tag names and keywords without changing SAWSO', async ({ page }, info) => {
  const f = await sawsoFixture(),
    suffix = randomUUID().slice(0, 8),
    folder = resolve('../.r8-progress/round3/tag-manager/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let siteId = ''
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    siteId = (
      await f.client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        'topics-' + suffix,
        '[Another site]',
        'resource',
        'topics-' + suffix + '.staging.localhost',
        JSON.stringify(SAWSO_THEME),
        '[]',
      ])
    ).rows[0]!.id
    const model = withStoriesCatalog(STORIES_MODEL, {
      ...emptyStoriesSettings(),
      mainLabel: 'Topics',
      secondaryLabel: 'Divisions',
      mainTags: [{ id: 'service', label: 'Service', keywords: ['volunteer', 'serve'] }],
    })
    await f.client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
      siteId,
      'stories',
      'Stories',
      'stories',
      JSON.stringify(model.fields),
      JSON.stringify(model.presentation),
    ])
    await f.client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + siteId + '/stories/tags')
    await expect(page.getByRole('list', { name: 'Topics', exact: true })).toBeVisible()
    await expect(page.getByText('Project Sectors', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Rename level', exact: true }).first().click()
    const rename = page.getByRole('dialog', { name: 'Rename level', exact: true })
    await rename.getByLabel('Main tag level name', { exact: true }).fill('Focus areas')
    await rename.getByRole('button', { name: 'Save name', exact: true }).click()
    await expect(page.getByRole('list', { name: 'Focus areas', exact: true })).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, 'another-site-' + width + '.png'), fullPage: true })
    }
    await page.goto('/sites/' + f.siteId + '/stories/tags')
    await expect(page.getByRole('list', { name: 'Project Sectors', exact: true })).toBeVisible()
    await expect(page.getByText('Focus areas', { exact: true })).toHaveCount(0)
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    if (siteId) await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [siteId])
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
