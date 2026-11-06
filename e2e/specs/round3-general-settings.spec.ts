import { E2E_PORTS } from '../test-ports.ts'
import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'
async function publish(page: Page) {
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Publish selected (1)', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
}
test('General settings keep name and fields private until reviewed publication, preserve other blocks and retain stale fields and role boundaries', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/general-settings/' + info.project.name),
    publicContext = await browser.newContext({ javaScriptEnabled: false }),
    publicPage = await publicContext.newPage(),
    restricted = await browser.newContext()
  try {
    await mkdir(folder, { recursive: true })
    await f.pool.query("INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','synthetic-e2e')", [
      'general-' + f.site,
    ])
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      base = '/sites/' + f.site + '/settings',
      head = async () =>
        (
          await c.query(
            'SELECT h.revision,h.draft_version_id,h.published_version_id,v.settings FROM site_settings h LEFT JOIN site_setting_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
            [f.site],
          )
        ).rows[0]!,
      frames = (await c.query('SELECT * FROM global_elements WHERE site_id=$1 ORDER BY kind', [f.site])).rows,
      originalName = (await c.query('SELECT name FROM sites WHERE id=$1', [f.site])).rows[0]!.name
    const before = await head()
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    await c.query('SELECT app.save_site_settings_draft($1,$2,$3)', [
      f.site,
      before.revision,
      JSON.stringify({
        schemaVersion: 1,
        name: originalName,
        search: { verification: [], hints: '[Saved hints]' },
        social: [
          { service: 'instagram', url: 'https://instagram.com/local-site/', handle: '@local-site', inFooter: false },
        ],
      }),
    ])
    await c.query('COMMIT')
    const saved = await head()
    const publicHtml = async () => {
        const response = await publicPage.goto('http://' + f.host + `:${E2E_PORTS.site}/`)
        expect(response!.status()).toBe(200)
        return response!.text()
      },
      beforeHtml = await publicHtml(),
      capture = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 950 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
        }
      }
    await signIn(page, 'root@example.test')
    await page.goto(base)
    await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible()
    await expect(page.getByLabel('Country', { exact: true })).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Archive site', exact: true })).toHaveCount(0)
    await capture('general-empty')
    await page.getByLabel('Site name', { exact: true }).fill('[Reviewed site name]')
    await page.getByLabel('Description for search', { exact: true }).fill('[Site fallback description]')
    await expect(page.getByText('27 of 155', { exact: true })).toBeVisible()
    await page.getByLabel('Country', { exact: true }).fill('United States')
    await page.getByLabel('Language', { exact: true }).selectOption('es')
    await page.getByLabel('Contact email', { exact: true }).fill('invalid')
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
    await page.getByLabel('Contact email', { exact: true }).fill('contact@example.test')
    await page.getByLabel('Contact phone', { exact: true }).fill('[Phone]')
    await page.getByLabel('Mailing address', { exact: true }).fill('[Address]')
    await page.getByRole('link', { name: 'Social accounts', exact: true }).click()
    const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page.getByLabel('Mailing address', { exact: true })).toHaveValue('[Address]')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Site settings draft saved' })).toBeVisible()
    const draft = await head()
    expect(draft.settings.name).toBe('[Reviewed site name]')
    expect(draft.settings.search).toEqual(saved.settings.search)
    expect(draft.settings.social).toEqual(saved.settings.social)
    expect(draft.published_version_id).toBe(saved.published_version_id)
    expect((await c.query('SELECT name FROM sites WHERE id=$1', [f.site])).rows[0]!.name).toBe(originalName)
    expect(await publicHtml()).toBe(beforeHtml)
    await capture('general-saved-private')
    const version = (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!
        .published_version_id,
      preview = await page.request.get('/preview/' + version + '?visit=1&site=draft')
    expect(await preview.text()).toContain('<html lang="es">')
    await page.getByRole('button', { name: 'Schedule', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Publish later', exact: true })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.goto(base)
    await publish(page)
    expect((await c.query('SELECT name FROM sites WHERE id=$1', [f.site])).rows[0]!.name).toBe('[Reviewed site name]')
    const afterHtml = await publicHtml()
    expect(afterHtml).toContain('<html lang="es">')
    expect(afterHtml).toContain('<meta name="description" content="A complete page for reviewing shared appearance.">')
    expect(afterHtml).not.toContain('[Phone]')
    expect((await c.query('SELECT * FROM global_elements WHERE site_id=$1 ORDER BY kind', [f.site])).rows).toEqual(
      frames,
    )
    await page.goto(base)
    await page.getByRole('link', { name: 'Publishing & approval', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Stories', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Review reminders', exact: true }).click()
    await expect(
      page.getByText('Chapter review reminders are not set up for this site.', { exact: true }),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Advanced', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Download content archive', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Archive site', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'General', exact: true }).click()
    await page.getByLabel('Site name', { exact: true }).fill('[Discarded name]')
    await page.getByRole('link', { name: 'Advanced', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await page.getByRole('link', { name: 'General', exact: true }).click()
    await expect(page.getByLabel('Site name', { exact: true })).toHaveValue('[Reviewed site name]')
    const latest = await head()
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    await c.query('SELECT app.save_site_settings_draft($1,$2,$3)', [
      f.site,
      latest.revision,
      JSON.stringify({ ...latest.settings, general: { ...latest.settings.general, phone: '[Concurrent phone]' } }),
    ])
    await c.query('COMMIT')
    await page.getByLabel('Contact phone', { exact: true }).fill('[My kept phone]')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Site settings changed' })).toBeVisible()
    await expect(page.getByLabel('Contact phone', { exact: true })).toHaveValue('[My kept phone]')
    await capture('general-conflict-keeps-fields')
    const editor = await restricted.newPage()
    await signIn(editor, 'editor@example.test')
    for (const path of [base, base + '?tab=advanced', base + '?tab=publishing'])
      expect((await editor.request.get(path)).status()).toBe(404)
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await publicContext.close()
    await restricted.close()
    await f.pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', ['general-' + f.site])
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
