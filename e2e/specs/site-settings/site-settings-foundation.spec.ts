import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'
async function publish(page: Page, review = true) {
  const button = page.getByRole('button', { name: 'Publish selected (1)', exact: true })
  await button.click()
  if (review) {
    await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
    await button.click()
  }
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
}
test('site settings stay private, enforce roles and conflicts, and recover the original name without losing later settings', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/site-settings-foundation/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      editor = (await c.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id,
      contributor = (await c.query("SELECT id FROM app_users WHERE email='contributor@example.test'")).rows[0]!.id,
      config = {
        schemaVersion: 1,
        name: '[Reviewed site name]',
        general: {
          description: '[Site description]',
          country: 'United States',
          language: 'en-US',
          email: 'contact@example.test',
          phone: '[Phone]',
          address: '[Address]',
        },
        search: {
          verification: [{ name: 'google-site-verification', content: 'local-token' }],
          hints: '[Optional hints]',
        },
        social: [
          { service: 'instagram', url: 'https://www.instagram.com/account/', handle: '@account', inFooter: true },
        ],
      }
    const head = async () => (await c.query('SELECT * FROM site_settings WHERE site_id=$1', [f.site])).rows[0]!,
      shell = async () =>
        (await c.query('SELECT payload FROM published_site_shells WHERE site_id=$1', [f.site])).rows[0]!.payload,
      before = await shell()
    async function command(user: string, sql: string, args: unknown[]) {
      await c.query('BEGIN')
      try {
        await c.query('SET LOCAL ROLE cms_authenticated_user')
        await c.query("SELECT set_config('app.user_id',$1,true)", [user])
        const result = await c.query(sql, args)
        await c.query('COMMIT')
        return result
      } catch (error) {
        await c.query('ROLLBACK')
        throw error
      }
    }
    for (const user of [editor, contributor])
      await expect(
        command(user, 'SELECT app.save_site_settings_draft($1,0,$2)', [f.site, JSON.stringify(config)]),
      ).rejects.toMatchObject({ code: 'CMS02' })
    for (const bad of [
      { ...config, analytics: {} },
      { ...config, name: '' },
      {
        ...config,
        social: [{ service: 'instagram', url: 'https://user:password@example.test/', handle: '', inFooter: true }],
      },
      { ...config, search: { hints: '', verification: [{ name: 'script', content: 'anything' }] } },
      { ...config, search: { hints: '', verification: [{ name: 'google-site-verification', content: '<script>' }] } },
    ])
      await expect(
        command(actor, 'SELECT app.save_site_settings_draft($1,0,$2)', [f.site, JSON.stringify(bad)]),
      ).rejects.toMatchObject({ code: 'CMS04' })
    expect((await head()).revision).toBe('0')
    await command(actor, 'SELECT app.save_site_settings_draft($1,0,$2)', [f.site, JSON.stringify(config)])
    const draft = await head()
    expect(draft.revision).toBe('2')
    expect(draft.draft_version_id).not.toBe(draft.published_version_id)
    expect(await shell()).toEqual(before)
    expect((await c.query('SELECT name FROM sites WHERE id=$1', [f.site])).rows[0]!.name).toBe('Shared site look')
    expect(
      (await c.query('SELECT settings FROM site_setting_versions WHERE id=$1', [draft.published_version_id])).rows[0]!
        .settings,
    ).toEqual({ name: 'Shared site look' })
    await command(actor, 'SELECT app.save_site_settings_draft($1,2,$2)', [f.site, JSON.stringify(config)])
    expect(await head()).toEqual(draft)
    await expect(
      command(actor, 'SELECT app.save_site_settings_draft($1,0,$2)', [f.site, JSON.stringify(config)]),
    ).rejects.toMatchObject({ code: 'CMS01' })
    await expect(command(editor, 'SELECT app.publish_site_settings($1,2)', [f.site])).rejects.toMatchObject({
      code: 'CMS02',
    })
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/publishing')
    await expect(
      page
        .getByRole('table', { name: 'Saved changes ready to publish', exact: true })
        .getByRole('row')
        .filter({ has: page.getByRole('checkbox', { name: 'Site settings', exact: true }) }),
    ).toContainText('Site settings')
    await expect(page.getByText(/Site name: changed/).first()).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, 'settings-ready-' + width + '.png') })
    }
    await publish(page)
    expect((await shell()).settings).toEqual(config)
    expect((await c.query('SELECT name FROM sites WHERE id=$1', [f.site])).rows[0]!.name).toBe(config.name)
    const live = await head(),
      later = {
        ...config,
        name: '[Later private name]',
        general: { ...config.general, address: '[Later private address]' },
      }
    await command(actor, 'SELECT app.save_site_settings_draft($1,$2,$3)', [
      f.site,
      live.revision,
      JSON.stringify(later),
    ])
    const laterHead = await head()
    await page.getByRole('tab', { name: 'History', exact: true }).click()
    await page
      .getByRole('tabpanel')
      .getByRole('listitem')
      .filter({ has: page.getByText('Went live', { exact: true }) })
      .first()
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    await page.getByRole('button', { name: 'Review recovery', exact: true }).click()
    await expect(page.locator('.recovery-items')).toContainText('Site settings')
    await page.getByRole('button', { name: 'Prepare recovery drafts', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Prepare recovery drafts', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Recovery drafts are ready' })).toBeVisible()
    expect((await shell()).settings).toEqual(config)
    expect(
      (await c.query('SELECT settings FROM site_setting_versions WHERE id=$1', [laterHead.draft_version_id])).rows[0]!
        .settings,
    ).toEqual(later)
    await page.getByRole('button', { name: 'Review recovery release', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
    await publish(page, false)
    expect((await shell()).settings).toEqual({ schemaVersion: 1, name: 'Shared site look' })
    expect((await c.query('SELECT name FROM sites WHERE id=$1', [f.site])).rows[0]!.name).toBe('Shared site look')
    expect(
      (await c.query('SELECT count(*)::int AS count FROM site_release_settings_pins WHERE site_id=$1', [f.site]))
        .rows[0]!.count,
    ).toBeGreaterThanOrEqual(4)
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
