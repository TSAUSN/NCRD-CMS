import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { SAWSO_THEME } from '../../packages/seeds/src/core-themes.ts'
import { signIn } from './helpers.ts'
test('Stories setup and review policy save privately to the requested destination, keep failures and discard without leftovers', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(),
    folder = resolve('../.r8-progress/round3/stories-settings-leave/' + info.project.name),
    suffix = randomUUID().slice(0, 8)
  await mkdir(folder, { recursive: true })
  let siteId = '',
    native = 0
  page.on('dialog', async dialog => {
    native++
    await dialog.dismiss()
  })
  const read = async () =>
    (
      await f.pool.query(
        "SELECT c.id,c.draft_schema_version_id,c.published_schema_version_id,v.sort,(SELECT count(*)::int FROM collection_entries e WHERE e.collection_id=c.id) AS entries FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.site_id=$1 AND c.reader_key='stories'",
        [siteId],
      )
    ).rows
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
    }
  }
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    siteId = (
      await f.client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        'settings-leave-' + suffix,
        '[Story settings site]',
        'resource',
        'settings-leave-' + suffix + '.staging.localhost',
        JSON.stringify(SAWSO_THEME),
        '[]',
      ])
    ).rows[0]!.id
    await f.client.query('COMMIT')
    const base = '/sites/' + siteId,
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      main = page.getByRole('textbox', { name: /^Main tag group name/ }),
      secondary = page.getByRole('textbox', { name: /^Secondary tag group name/ })
    await signIn(page, 'root@example.test')
    await page.goto(base + '/stories/setup')
    await main.fill('[Topics]')
    await secondary.fill('[Places]')
    await page.getByRole('checkbox', { name: 'Include unreviewed stories in feeds', exact: true }).uncheck()
    await page.getByRole('link', { name: 'Cancel', exact: true }).click()
    await expect(leave).toBeVisible()
    await capture('setup-choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(main).toHaveValue('[Topics]')
    await page.getByRole('link', { name: 'Cancel', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(leave).toHaveCount(0)
    await expect(secondary).toHaveValue('[Places]')
    await page.getByRole('link', { name: 'Cancel', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(base + '/settings?tab=publishing')
    expect(await read()).toEqual([])
    await page.goto(base + '/stories/setup')
    await main.fill('')
    await secondary.fill('[Places]')
    await page.getByRole('link', { name: 'Cancel', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Name both tag groups')
    await capture('setup-save-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await main.fill('[Topics]')
    await page.getByRole('checkbox', { name: 'Include unreviewed stories in feeds', exact: true }).uncheck()
    await page.getByRole('link', { name: 'Cancel', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(base + '/settings?tab=publishing')
    const created = await read()
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      published_schema_version_id: null,
      entries: 0,
      sort: { stories: { mainLabel: '[Topics]', secondaryLabel: '[Places]', publishUnreviewed: false } },
    })
    const settings = page.getByRole('region', { name: 'Stories', exact: true }),
      policy = settings.getByRole('checkbox', { name: 'Include unreviewed stories in feeds', exact: true })
    await expect(policy).not.toBeChecked()
    await policy.check()
    await settings.getByRole('link', { name: 'Open Stories', exact: true }).click()
    await capture('policy-choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(policy).toBeChecked()
    await settings.getByRole('link', { name: 'Open Stories', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(base + '/stories')
    expect(await read()).toEqual(created)
    await page.goto(base + '/settings?tab=publishing')
    await expect(policy).not.toBeChecked()
    await policy.check()
    let fail = true
    await page.route('**/sites/' + siteId + '/settings?tab=publishing', async route => {
      if (route.request().method() === 'POST' && fail) {
        fail = false
        await route.abort('failed')
      } else await route.continue()
    })
    await settings.getByRole('link', { name: 'Open Stories', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('could not be saved')
    await capture('policy-save-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(policy).toBeChecked()
    expect(await read()).toEqual(created)
    await settings.getByRole('link', { name: 'Open Stories', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(base + '/stories')
    const saved = await read()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      id: created[0].id,
      published_schema_version_id: null,
      entries: 0,
      sort: { stories: { publishUnreviewed: true } },
    })
    expect(saved[0].draft_schema_version_id).not.toBe(created[0].draft_schema_version_id)
    expect(native).toBe(0)
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    if (siteId) await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [siteId])
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
