import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn, canvas, publish } from '../helpers.ts'
import { NATIONAL_TEMPLATE_THEME } from '../../../packages/seeds/src/core-themes.ts'
test('report letters and financial rows use ordinary editing,private saves,reviewed publication and no-script disclosures', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/report-sections/' + info.project.name),
    context = await browser.newContext({ javaScriptEnabled: false }),
    view = await context.newPage()
  try {
    await mkdir(folder, { recursive: true })
    await c.query('BEGIN')
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const definitions = (
        await c.query(
          "SELECT d.id,d.slug,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.slug IN ('core-report-letters','core-report-financial') AND d.scope='global'",
        )
      ).rows,
      letters = definitions.find(row => row.slug === 'core-report-letters')!,
      financial = definitions.find(row => row.slug === 'core-report-financial')!,
      head = (
        await c.query(
          'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.pages[0]],
        )
      ).rows[0]!,
      theme = (await c.query('SELECT revision FROM themes WHERE site_id=$1', [f.site])).rows[0]!,
      themeRevision = (
        await c.query('SELECT * FROM app.save_theme_draft($1,$2,$3)', [
          f.site,
          theme.revision,
          JSON.stringify(NATIONAL_TEMPLATE_THEME),
        ])
      ).rows[0]!.revision
    await c.query('SELECT app.publish_theme($1,$2)', [f.site, themeRevision])
    const letter = {
      heading: '[Letters]',
      letters: { items: ['i1', 'i2'] },
      source: '[Reviewed report source]',
    } as Record<string, unknown>
    for (const key of ['i1', 'i2'])
      Object.assign(letter, {
        ['letters__' + key + '__photo']: {
          src: '/cms-samples/r8-square.png',
          alt: '[Letter portrait]',
          decorative: false,
        },
        ['letters__' + key + '__name']: '[Name ' + key + ']',
        ['letters__' + key + '__role']: '<p>[Role]<br>[Organization]</p>',
        ['letters__' + key + '__intro']: '[Letter introduction]',
        ['letters__' + key + '__message']: '<p>[Complete reviewed message]</p>',
        ['letters__' + key + '__open_label']: 'Read the full message',
      })
    const money = {
      heading: 'Financial summary',
      period: '[Reporting period]',
      expenses_heading: 'Expenses by Program',
      expenses: { items: ['i1', 'i2'] },
      expenses__i1__label: '[First program]',
      expenses__i1__amount: '$1,000',
      expenses__i2__label: '[Second program]',
      expenses__i2__amount: '$250',
      revenue_heading: 'Revenue',
      revenue: { items: ['i1', 'i2'] },
      revenue__i1__label: '[First source]',
      revenue__i1__amount: '$100',
      revenue__i2__label: '[Second source]',
      revenue__i2__amount: '$300',
      position_heading: 'STATEMENT OF FINANCIAL POSITION',
      position: { items: ['i1', 'i2', 'i3'] },
      position__i1__label: 'ASSETS',
      position__i1__amount: '',
      position__i1__kind: 'group',
      position__i2__label: '[Current assets]',
      position__i2__amount: '$200',
      position__i2__kind: 'ordinary',
      position__i3__label: '[Total assets]',
      position__i3__amount: '$200',
      position__i3__kind: 'total',
      activities_label: 'View the statement of financial activities',
      activities_heading: 'STATEMENT OF FINANCIAL ACTIVITIES',
      activities: { items: ['i1'] },
      activities__i1__label: '[Total revenue]',
      activities__i1__amount: '$400',
      activities__i1__kind: 'total',
      source: '[Reviewed financial source]',
    }
    const content = [
      ...head.content,
      {
        section_def_id: letters.id,
        section_def_version: letters.version,
        label: 'Letters with full message',
        values: letter,
      },
      {
        section_def_id: financial.id,
        section_def_version: financial.version,
        label: 'Financial summary',
        values: money,
      },
    ]
    await c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      f.pages[0],
      head.revision,
      JSON.stringify(content),
      JSON.stringify(head.meta),
    ])
    await c.query("SELECT app.publish_page($1,$2,3,NULL,'[]')", [f.pages[0], Number(head.revision) + 1])
    await c.query('COMMIT')
    const before = (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!
        .published_version_id,
      url = 'http://' + f.host + `:${E2E_PORTS.site}/`
    for (const width of [1440, 390]) {
      await view.setViewportSize({ width, height: 950 })
      await view.goto(url)
      await expect(view.locator('.ar-letter')).toHaveCount(2)
      await expect(view.getByText('[Complete reviewed message]').first()).toBeHidden()
      await expect(view.locator('.ar-fill').nth(1)).toHaveAttribute('style', 'width:25.0000%')
      await expect(view.locator('.ar-statement tr.ar-group th')).toHaveAttribute('colspan', '2')
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await view.screenshot({ path: resolve(folder, 'closed-' + width + '.png'), fullPage: true })
      for (const label of ['Read the full message', 'View the statement of financial activities'])
        for (const target of await view.getByText(label, { exact: true }).all()) await target.click()
      await expect(view.getByText('[Complete reviewed message]').first()).toBeVisible()
      await expect(view.getByRole('rowheader', { name: '[Total revenue]', exact: true })).toBeVisible()
      await view.screenshot({ path: resolve(folder, 'open-' + width + '.png'), fullPage: true })
    }
    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + f.pages[0] + '?section=2')
    await expect(page.locator('.inspector').getByRole('button', { name: 'Add an expense', exact: true })).toBeVisible()
    await canvas(page).getByText('[Second program]', { exact: true }).click()
    const panel = page.locator('.inspector')
    await panel.getByLabel('Amount', { exact: true }).fill('$500')
    await expect(canvas(page).locator('.ar-fill').nth(1)).toHaveAttribute('style', 'width:50.0000%')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await page.screenshot({ path: resolve(folder, 'edit-row-' + width + '.png') })
    }
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    expect(
      (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!.published_version_id,
    ).toBe(before)
    await view.goto(url)
    await expect(view.locator('.ar-fill').nth(1)).toHaveAttribute('style', 'width:25.0000%')
    await expect(view.locator('.ar-statement tr.ar-group th')).toHaveAttribute('colspan', '2')
    await publish(page)
    await view.goto(url)
    await expect(view.locator('.ar-fill').nth(1)).toHaveAttribute('style', 'width:50.0000%')
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await context.close()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
