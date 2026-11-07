import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { nationalTemplateTheme } from '@cms/seeds/core-themes'
import { signIn } from '../helpers.ts'
async function publish(page: Page, review = true) {
  const button = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
  if (review) {
    await button.click()
    await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
  }
  const samples = page.getByRole('checkbox', { name: /Publish with sample content/ })
  if (await samples.count()) await samples.check()
  await button.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
}
for (const model of ['canonical', 'legacy'] as const)
  test(
    'a ' + model + ' Settings site copy publishes under its own name and recovers its first release to private',
    async ({ page, browser }, info) => {
      test.setTimeout(120000)
      const f = await siteLookFixture(),
        c = await f.pool.connect(),
        visitor = await browser.newContext({ javaScriptEnabled: false }),
        view = await visitor.newPage(),
        created: string[] = [],
        folder = resolve('../.r8-progress/round3/copied-site-settings/' + info.project.name + '/' + model)
      try {
        await mkdir(folder, { recursive: true })
        const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
        await c.query('BEGIN')
        await c.query('SET LOCAL ROLE cms_authenticated_user')
        await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
        const theme = (
          await c.query(
            'SELECT h.revision,v.tokens FROM themes h JOIN theme_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
            [f.site],
          )
        ).rows[0]!
        await c.query('SELECT app.save_theme_draft($1,$2,$3)', [
          f.site,
          theme.revision,
          JSON.stringify(nationalTemplateTheme(theme.tokens.fonts)),
        ])
        if (model === 'canonical') {
          await c.query('SELECT app.save_site_settings_draft($1,0,$2)', [
            f.site,
            JSON.stringify({
              schemaVersion: 1,
              name: '[Source site]',
              search: {
                verification: [{ name: 'google-site-verification', content: 'source-token' }],
                hints: '[Source hints]',
              },
              social: [
                { service: 'instagram', url: 'https://instagram.com/source/', handle: '@source', inFooter: true },
              ],
            }),
          ])
          await c.query('SELECT app.publish_site_settings($1,2)', [f.site])
        } else {
          const row = (await c.query('SELECT revision FROM sites WHERE id=$1', [f.site])).rows[0]!
          await c.query('SELECT app.update_site_name($1,$2,$3)', [f.site, row.revision, '[Legacy source site]'])
        }
        await c.query('COMMIT')
        const original = (
          await c.query('SELECT * FROM site_setting_versions WHERE site_id=$1 ORDER BY revision', [f.site])
        ).rows
        await signIn(page, 'root@example.test')
        await page.goto('/sites/' + f.site + '/template')
        await page.getByRole('button', { name: 'Start a site from this', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Start a site from the national template', exact: true }),
          slug = 'settings-copy-' + model + '-' + f.site.slice(0, 8),
          name = '[Private ' + model + ' copy]'
        await dialog.getByLabel(/^Site name/).fill(name)
        await dialog.getByLabel('Test address', { exact: false }).fill(slug)
        await dialog.getByLabel('A copy of a site', { exact: true }).check()
        await dialog.getByLabel('Site to copy', { exact: true }).selectOption(f.site)
        await dialog.getByLabel('Bring the words too', { exact: true }).check()
        await dialog.getByRole('button', { name: 'Create private site', exact: true }).click()
        await expect(page).toHaveURL(/\/sites\/[a-f0-9-]{36}$/, { timeout: 60000 })
        const site = page.url().split('/').at(-1)!
        created.push(site)
        const host = slug + '.staging.localhost',
          head = async () =>
            (
              await c.query(
                'SELECT h.*,v.settings FROM site_settings h JOIN site_setting_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
                [site],
              )
            ).rows[0]!,
          copied = await head()
        expect(copied.published_version_id).toBeNull()
        expect(copied.settings.schemaVersion).toBe(1)
        expect(copied.settings.name).toBe(name)
        if (model === 'canonical') {
          expect(copied.settings.search.hints).toBe('[Source hints]')
          expect(copied.settings.social[0].url).toBe('https://instagram.com/source/')
        }
        expect((await view.goto('http://' + host + `:${E2E_PORTS.site}/`))!.status()).toBe(404)
        await page.goto('/sites/' + site + '/publishing')
        await expect(
          page.getByRole('heading', { name: 'Publish your site for the first time', exact: true }),
        ).toBeVisible()
        const capture = async (label: string) => {
          for (const width of [1440, 1024]) {
            await page.setViewportSize({ width, height: 950 })
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
            await page.screenshot({ path: resolve(folder, label + '-' + width + '.png') })
          }
        }
        await capture('private-copy-ready')
        await publish(page)
        expect(
          (await c.query('SELECT name,initial_release_required FROM sites WHERE id=$1', [site])).rows[0],
        ).toMatchObject({ name, initial_release_required: false })
        expect((await view.goto('http://' + host + `:${E2E_PORTS.site}/`))!.status()).toBe(200)
        expect((await head()).published_version_id).not.toBeNull()
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
        await capture('recover-copy-first-release')
        await page.getByRole('button', { name: 'Prepare recovery drafts', exact: true }).click()
        await page
          .getByRole('alertdialog')
          .getByRole('button', { name: 'Prepare recovery drafts', exact: true })
          .click()
        await expect(page.getByRole('status').filter({ hasText: 'Recovery drafts are ready' })).toBeVisible()
        await page.getByRole('button', { name: 'Review recovery release', exact: true }).click()
        await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
        await publish(page, false)
        expect(
          (await c.query('SELECT name,initial_release_required FROM sites WHERE id=$1', [site])).rows[0],
        ).toMatchObject({ name, initial_release_required: true })
        expect((await head()).published_version_id).toBeNull()
        expect((await view.goto('http://' + host + `:${E2E_PORTS.site}/`))!.status()).toBe(404)
        expect(
          (await c.query('SELECT * FROM site_setting_versions WHERE site_id=$1 ORDER BY revision', [f.site])).rows,
        ).toEqual(original)
        await page.goto('/sites/' + site + '/publishing')
        await publish(page)
        expect((await view.goto('http://' + host + `:${E2E_PORTS.site}/`))!.status()).toBe(200)
        expect((await c.query('SELECT name FROM sites WHERE id=$1', [site])).rows[0]!.name).toBe(name)
      } finally {
        await c.query('ROLLBACK').catch(() => {})
        await visitor.close()
        for (const id of [f.site, ...created])
          await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [id])
        c.release()
        await f.pool.end()
      }
    },
  )
