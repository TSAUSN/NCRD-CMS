import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { SAWSO_THEME } from '../../../packages/seeds/src/core-themes.ts'
import { signIn } from '../helpers.ts'
test('a Site admin turns on an empty Stories library, names tags, retries safely and saves its draft review policy', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(),
    suffix = randomUUID().slice(0, 8),
    adminEmail = 'setup-admin-' + suffix + '@example.test',
    editorEmail = 'setup-editor-' + suffix + '@example.test',
    folder = resolve('../.r8-progress/round3/stories-setup/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let siteId = ''
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    siteId = (
      await f.client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        'setup-' + suffix,
        '[Story site]',
        'resource',
        'setup-' + suffix + '.staging.localhost',
        JSON.stringify(SAWSO_THEME),
        '[]',
      ])
    ).rows[0]!.id
    for (const [email, role] of [
      [adminEmail, 'site_admin'],
      [editorEmail, 'editor'],
    ]) {
      const id = (await f.client.query('SELECT app.provision_user($1,$2) AS id', [email, '[Name]'])).rows[0]!.id
      await f.client.query('SELECT app.set_site_membership($1,$2,$3)', [id, siteId, role])
      await f.client.query('UPDATE app_users SET auth_subject=$1 WHERE id=$2', ['local|' + email, id])
    }
    await f.client.query('COMMIT')
    const base = '/sites/' + siteId
    await signIn(page, adminEmail)
    await page.goto(base + '/settings?tab=publishing')
    await expect(
      page.getByRole('navigation', { name: 'Sections of the CMS' }).getByRole('link', { name: 'Stories', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('link', { name: 'Turn on Stories', exact: true }).click()
    await capture('setup')
    await page.getByRole('textbox', { name: /^Main tag group name/ }).fill('Topics')
    await page.getByRole('textbox', { name: /^Secondary tag group name/ }).fill('Places')
    let fail = true
    await page.route('**/stories/setup', async route => {
      if (fail && route.request().method() === 'POST') {
        fail = false
        await route.abort('failed')
      } else await route.continue()
    })
    await page.getByRole('button', { name: 'Turn on Stories', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'result could not be confirmed' })).toBeVisible()
    await capture('setup-error')
    await page.getByRole('button', { name: 'Turn on Stories', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'No stories yet', exact: true })).toBeVisible()
    await capture('empty')
    await expect(page.getByRole('combobox', { name: 'Topics', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Places', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Manage tags', exact: true })).toBeVisible()
    await page.goto(base + '/stories/setup')
    await expect(page.getByRole('heading', { name: 'Stories is on', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Turn on Stories', exact: true })).toHaveCount(0)
    await page.goto(base + '/settings?tab=publishing')
    const settings = page.getByRole('region', { name: 'Stories', exact: true })
    await expect(
      settings.getByRole('checkbox', { name: 'Include unreviewed stories in feeds', exact: true }),
    ).toBeChecked()
    await settings.getByRole('checkbox', { name: 'Include unreviewed stories in feeds', exact: true }).uncheck()
    await settings.getByRole('button', { name: 'Save Stories setting', exact: true }).click()
    await expect(settings.getByRole('status')).toContainText('saved as a draft')
    await settings.scrollIntoViewIfNeeded()
    await capture('policy')
    await page.reload()
    await expect(page.getByRole('region', { name: 'Stories', exact: true }).getByRole('checkbox')).not.toBeChecked()
    const state = (
      await f.client.query(
        "SELECT c.published_schema_version_id,v.sort,(SELECT count(*)::int FROM collection_entries e WHERE e.collection_id=c.id) AS entries FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.site_id=$1 AND c.reader_key='stories'",
        [siteId],
      )
    ).rows
    expect(state).toHaveLength(1)
    expect(state[0]).toMatchObject({
      published_schema_version_id: null,
      entries: 0,
      sort: {
        stories: {
          mainLabel: 'Topics',
          secondaryLabel: 'Places',
          source: 'none',
          publishUnreviewed: false,
          mainTags: [],
          secondaryTags: [],
        },
      },
    })
    const restricted = await browser.newContext(),
      editor = await restricted.newPage()
    try {
      await signIn(editor, editorEmail)
      expect((await editor.goto(base + '/stories/setup'))?.status()).toBe(404)
      await editor.goto(base + '/settings?tab=publishing')
      await expect(editor.getByRole('region', { name: 'Stories', exact: true })).toHaveCount(0)
      await editor.goto(base + '/stories')
      await expect(editor.getByRole('heading', { name: 'No stories yet', exact: true })).toBeVisible()
      await expect(editor.getByRole('link', { name: 'Manage tags', exact: true })).toHaveCount(0)
    } finally {
      await restricted.close()
    }
    await page.context().clearCookies()
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/stories')
    await expect(page.getByRole('combobox', { name: 'Project Sectors', exact: true })).toBeVisible()
    await expect(page.getByRole('article')).toHaveCount(34)
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    if (siteId) await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [siteId])
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
