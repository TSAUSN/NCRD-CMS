import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn, canvas } from '../helpers.ts'
import { NATIONAL_TEMPLATE_THEME } from '../../../packages/seeds/src/core-themes.ts'
test('report rows show only existing page and PDF links, with normal private editing and the shared PDF picker', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    context = await browser.newContext({ javaScriptEnabled: false }),
    view = await context.newPage(),
    folder = resolve('../.r8-progress/round3/report-figures/index-' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    await c.query('BEGIN')
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const defs = (
        await c.query(
          "SELECT d.id,d.slug,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.scope='global' AND d.slug IN('core-page-header','core-text-image')",
        )
      ).rows,
      theme = (await c.query('SELECT revision FROM themes WHERE site_id=$1', [f.site])).rows[0]!,
      revision = (
        await c.query('SELECT * FROM app.save_theme_draft($1,$2,$3)', [
          f.site,
          theme.revision,
          JSON.stringify(NATIONAL_TEMPLATE_THEME),
        ])
      ).rows[0]!.revision
    await c.query('SELECT app.publish_theme($1,$2)', [f.site, revision])
    const header = defs.find(row => row.slug === 'core-page-header')!,
      row = defs.find(row => row.slug === 'core-text-image')!,
      before = (
        await c.query(
          'SELECT p.revision,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.pages[0]],
        )
      ).rows[0]!,
      link = { url: '/visit', label: '[Earlier words]' },
      pdf = { url: 'https://example.test/report.pdf', label: '[Earlier PDF words]', newTab: true },
      empty = { url: '', label: '' }
    const content = [
      {
        section_def_id: header.id,
        section_def_version: header.version,
        values: { heading: '[Annual reports]', intro: '' },
      },
      ...[
        [link, pdf],
        [empty, pdf],
        [link, empty],
        [empty, empty],
      ].map(([report_page, report_pdf], index) => ({
        section_def_id: row.id,
        section_def_version: row.version,
        values: {
          heading: '[Report ' + index + ']',
          body: '<p>[Earlier description]</p>',
          photo: '',
          report_page,
          report_pdf,
          __cms_report_links: true,
        },
      })),
    ]
    await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      f.pages[0],
      before.revision,
      JSON.stringify(content),
      JSON.stringify(before.meta),
    ])
    await c.query("SELECT app.publish_page($1,$2,3,NULL,'[]')", [f.pages[0], Number(before.revision) + 1])
    await c.query('COMMIT')
    const published = (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!
      .published_version_id
    for (const width of [1440, 390]) {
      await view.setViewportSize({ width, height: 1000 })
      await view.goto('http://' + f.host + `:${E2E_PORTS.site}/`)
      await expect(view.getByRole('link', { name: 'View page', exact: true })).toHaveCount(2)
      await expect(view.getByRole('link', { name: 'View PDF', exact: true })).toHaveCount(2)
      await expect(view.getByRole('link', { name: 'View PDF', exact: true }).first()).toHaveAttribute(
        'target',
        '_blank',
      )
      await expect(view.getByText('[Earlier description]', { exact: true }).first()).toBeHidden()
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await view.screenshot({ path: resolve(folder, 'public-' + width + '.png'), fullPage: true })
    }
    await view.getByRole('link', { name: 'View page', exact: true }).first().click()
    await expect(view).toHaveURL(/\/visit$/)
    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + f.pages[0] + '?section=1')
    await canvas(page).locator('[data-cms-section="1"] cms-slot[data-cms-slot="report_pdf"]').click()
    const field = page.locator('.inspector [data-inspector-slot="report_pdf"]')
    await expect(field.getByText('report.pdf', { exact: true })).toBeVisible()
    await field.getByRole('button', { name: 'Change', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Change PDF link', exact: true })
    await expect(dialog.getByLabel('Words people click', { exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Website', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Email', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Phone', exact: true })).toHaveCount(0)
    await dialog.getByLabel('Address', { exact: true }).fill('mailto:files@example.test')
    await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('alert')).toContainText('PDF address')
    await dialog.getByLabel('Address', { exact: true }).fill('')
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(
      canvas(page).locator('[data-cms-section="1"]').getByRole('link', { name: 'View PDF', exact: true }),
    ).toBeHidden()
    await field.getByRole('button', { name: 'Choose a PDF', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose a PDF', exact: true })
    await expect(picker.getByText(/save and publish this page/)).toBeVisible()
    await expect(picker.getByLabel('Upload a PDF (up to 25 MB)', { exact: true })).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: resolve(folder, 'pdf-picker-' + width + '.png') })
    }
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(picker).toBeHidden()
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    expect(
      (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!.published_version_id,
    ).toBe(published)
    await view.goto('http://' + f.host + `:${E2E_PORTS.site}/`)
    await expect(view.getByRole('link', { name: 'View PDF', exact: true })).toHaveCount(2)
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await context.close()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
