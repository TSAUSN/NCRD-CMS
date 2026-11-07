import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn, canvas, saveDraft } from '../helpers.ts'
import { rawRequest } from '../http.ts'
async function publish(page: Page) {
  await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Publish selected (1)', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
}
test('Social accounts save privately, guard leaving and update Footer and explicitly connected Links sections together', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    visitor = await browser.newContext({ javaScriptEnabled: false }),
    view = await visitor.newPage(),
    folder = resolve('../.r8-progress/round3/social-accounts/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    await f.pool.query("INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','synthetic-e2e')", [
      'social-' + f.site,
    ])
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      def = (
        await c.query(
          "SELECT d.id,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.slug='core-on-page-navigation' AND d.scope='global'",
        )
      ).rows[0]!
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const old = (
        await c.query(
          'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.pages[0]],
        )
      ).rows[0]!,
      values = {
        heading: '[Follow our work]',
        accounts_from: 'site',
        links: { items: ['i1'] },
        links__i1__action: { url: '/visit', label: '[Inactive sample]' },
      }
    const saved = (
      await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        f.pages[0],
        old.revision,
        JSON.stringify([
          ...old.content,
          { section_def_id: def.id, section_def_version: def.version, values },
          {
            section_def_id: def.id,
            section_def_version: def.version,
            values: {
              ...values,
              heading: '[Chapter links]',
              accounts_from: 'own',
              links__i1__action: { url: '/visit', label: '[Chapter-owned link]' },
            },
          },
        ]),
        JSON.stringify(old.meta),
      ])
    ).rows[0]!
    await c.query("SELECT app.publish_page($1,$2,3,NULL,'[]')", [f.pages[0], saved.revision])
    await c.query('COMMIT')
    const base = '/sites/' + f.site + '/settings/social',
      instagram = page.getByLabel('Instagram address', { exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      capture = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 950 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
        }
      },
      before = (await rawRequest({ host: f.host, path: '/' })).body
    await signIn(page, 'root@example.test')
    await page.goto(base)
    await expect(page.getByRole('heading', { name: 'Social accounts', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
    await expect(page.getByRole('row')).toHaveCount(6)
    await instagram.fill('https://instagram.com/local-account/')
    await page.getByLabel('Instagram handle', { exact: true }).fill('@local_account')
    await page.getByRole('switch', { name: 'Instagram in footer', exact: true }).check()
    await capture('social-accounts-unsaved')
    await page.getByRole('link', { name: 'General', exact: true }).click()
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    expect(await instagram.inputValue()).toContain('local-account')
    await page.getByRole('link', { name: 'General', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL('/sites/' + f.site + '/settings')
    expect((await rawRequest({ host: f.host, path: '/' })).body).toBe(before)
    await page.goto(base)
    await expect(instagram).toHaveValue('https://instagram.com/local-account/')
    await page.getByRole('button', { name: 'Schedule', exact: true }).click()
    const schedule = page.getByRole('dialog', { name: 'Publish later', exact: true })
    await expect(schedule).toBeVisible()
    await schedule.getByRole('button', { name: 'Tomorrow 9:00 AM', exact: true }).click()
    await schedule.getByRole('button', { name: 'Schedule selected changes', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Scheduling request saved.' })).toBeVisible()
    const job = (
      await c.query(
        "SELECT a.id,r.snapshot FROM scheduled_actions a JOIN site_releases r ON r.id=a.item_id WHERE a.site_id=$1 AND a.status='pending'",
        [f.site],
      )
    ).rows[0]!
    expect(job.snapshot).toHaveLength(1)
    expect(job.snapshot[0].type).toBe('site_settings')
    expect((await rawRequest({ host: f.host, path: '/' })).body).toBe(before)
    await page.getByRole('tab', { name: 'Scheduled publishing', exact: true }).click()
    await page
      .locator('#schedule-' + job.id)
      .getByRole('button', { name: 'Cancel schedule', exact: true })
      .click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel schedule', exact: true }).click()
    await expect(page.locator('#schedule-' + job.id)).toContainText('Status: cancelled')
    await page.goto(base)
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await publish(page)
    await view.goto('http://' + f.host + `:${E2E_PORTS.site}/`)
    await expect(
      view
        .getByRole('navigation', { name: 'Social media', exact: true })
        .getByRole('link', { name: 'Instagram', exact: true }),
    ).toHaveAttribute('href', 'https://instagram.com/local-account/')
    await expect(
      view
        .getByRole('navigation', { name: 'Related links', exact: true })
        .getByRole('link', { name: 'Instagram', exact: true }),
    ).toHaveAttribute('href', 'https://instagram.com/local-account/')
    await expect(view.getByRole('link', { name: '[Chapter-owned link]', exact: true })).toHaveAttribute(
      'href',
      '/visit',
    )
    await expect(view.getByRole('link', { name: '[Inactive sample]', exact: true })).toHaveCount(0)
    for (const width of [1440, 1024, 390]) {
      await view.setViewportSize({ width, height: 950 })
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await view.screenshot({ path: resolve(folder, 'public-social-nojs-' + width + '.png') })
    }
    await page.goto('/pages/' + f.pages[0])
    await canvas(page).getByRole('heading', { name: '[Follow our work]', exact: true }).click()
    const source = page.getByLabel('Links from', { exact: true })
    await expect(source).toHaveValue('site')
    await source.selectOption('own')
    await expect(page.getByText('These accounts come from site Settings.', { exact: false })).toHaveCount(0)
    await source.selectOption('site')
    await expect(page.getByText('These accounts come from site Settings.', { exact: false })).toBeVisible()
    await expect(canvas(page).locator('[data-cms-section="1"] [data-cms-slot^="links__"]')).toHaveCount(0)
    await expect(canvas(page).locator('[data-cms-section="2"] [data-cms-slot^="links__"]')).toHaveCount(1)
    await saveDraft(page)
    await page.goto(base)
    await instagram.fill('https://instagram.com/updated-account/')
    await page.getByRole('switch', { name: 'Instagram in footer', exact: true }).uncheck()
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await publish(page)
    await view.reload()
    await expect(view.getByRole('navigation', { name: 'Social media', exact: true })).toHaveCount(0)
    await expect(
      view
        .getByRole('navigation', { name: 'Related links', exact: true })
        .getByRole('link', { name: 'Instagram', exact: true }),
    ).toHaveAttribute('href', 'https://instagram.com/updated-account/')
    expect((await rawRequest({ host: f.host, path: '/visit' })).body).not.toContain(
      'https://instagram.com/local-account/',
    )
    await page.goto(base)
    await instagram.fill('https://instagram.com/discarded-account/')
    await page.getByRole('link', { name: 'General', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL('/sites/' + f.site + '/settings')
    await page.goto(base)
    await expect(instagram).toHaveValue('https://instagram.com/updated-account/')
    const initial = (await c.query('SELECT revision FROM site_settings WHERE site_id=$1', [f.site])).rows[0]!.revision
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const current = (
      await c.query(
        'SELECT v.settings FROM site_settings h JOIN site_setting_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
        [f.site],
      )
    ).rows[0]!.settings
    await c.query('SELECT app.save_site_settings_draft($1,$2,$3)', [
      f.site,
      initial,
      JSON.stringify({ ...current, name: '[Concurrent name]' }),
    ])
    await c.query('COMMIT')
    await instagram.fill('https://instagram.com/my-kept-account/')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Site settings changed' })).toBeVisible()
    await expect(instagram).toHaveValue('https://instagram.com/my-kept-account/')
    await capture('social-conflict-keeps-fields')
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await visitor.close()
    await f.pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', ['social-' + f.site])
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
