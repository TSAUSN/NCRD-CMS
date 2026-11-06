import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn, canvas } from './helpers.ts'
import { NATIONAL_TEMPLATE_THEME } from '../../packages/seeds/src/core-themes.ts'

test('report stories keep editable stats and photo captions; region disclosures work without JavaScript', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/report-stories/' + info.project.name)
  const context = await browser.newContext({ javaScriptEnabled: false }),
    view = await context.newPage()
  try {
    await mkdir(folder, { recursive: true })
    await c.query('BEGIN')
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const defs = (
      await c.query(
        "SELECT d.id,d.slug,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.slug IN ('core-report-country-story','core-report-regions') AND d.scope='global'",
      )
    ).rows
    const story = defs.find(d => d.slug === 'core-report-country-story')!,
      regions = defs.find(d => d.slug === 'core-report-regions')!
    const head = (
      await c.query(
        'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [f.pages[0]],
      )
    ).rows[0]!
    const theme = (await c.query('SELECT revision FROM themes WHERE site_id=$1', [f.site])).rows[0]!
    const savedTheme = (
      await c.query('SELECT * FROM app.save_theme_draft($1,$2,$3)', [
        f.site,
        theme.revision,
        JSON.stringify(NATIONAL_TEMPLATE_THEME),
      ])
    ).rows[0]!
    await c.query('SELECT app.publish_theme($1,$2)', [f.site, savedTheme.revision])
    const photo = { src: '/cms-samples/r8-four-three.png', alt: '[Reviewed local story photo]', decorative: false }
    const content = [
      ...head.content,
      ...['response', 'feature', 'reading', 'text'].map(layout => ({
        section_def_id: story.id,
        section_def_version: story.version,
        label: '[Country story ' + layout + ']',
        values: {
          heading: layout === 'response' ? '[Program heading]' : '',
          layout,
          country: '[Country]',
          title: '[Story ' + layout + ']',
          photo: layout === 'text' ? '' : photo,
          photo_note: layout === 'feature' ? '<p>[Reviewed photo caption]</p>' : '',
          body: '<p>[Reviewed story text]</p>',
          stats: { items: layout === 'response' ? ['i1', 'i2', 'i3', 'i4', 'i5'] : ['i1'] },
          ...Object.fromEntries(
            ['i1', 'i2', 'i3', 'i4', 'i5'].flatMap((key, index) => [
              ['stats__' + key + '__before', '[Stat ' + key + ']'],
              ['stats__' + key + '__value', String(index + 1)],
              ['stats__' + key + '__after', '[Impact]'],
            ]),
          ),
          continuation: '',
          impact_heading: '',
          impact_before: '',
          impact_value: '',
          impact_after: '',
          impact: '',
          action_heading: '',
          action_text: '',
          action: { url: '', label: '' },
          source: '[Reviewed report source]',
        },
      })),
      {
        section_def_id: regions.id,
        section_def_version: regions.version,
        label: '[Regions]',
        values: {
          heading: '[Global presence]',
          intro: '[Report introduction]',
          photo,
          open_label: 'View all countries',
          regions: { items: ['i1', 'i2'] },
          regions__i1__title: '[First region]',
          regions__i1__countries: '<ul><li>[First country]</li><li>[Second country]</li></ul>',
          regions__i2__title: '[Second region]',
          regions__i2__countries: '<ul><li>[Third country]</li></ul>',
          source: '[Reviewed country source]',
        },
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
    const published = (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!
        .published_version_id,
      url = 'http://' + f.host + `:${E2E_PORTS.site}/`
    for (const width of [1440, 390]) {
      await view.setViewportSize({ width, height: 950 })
      await view.goto(url)
      await expect(view.locator('.ar-country-story')).toHaveCount(4)
      await expect(view.locator('.ar-program-impact').first()).toBeHidden()
      await expect(view.locator('.ar-discover').first()).toBeHidden()
      await expect(view.locator('.ar-country-story').first().locator('.ar-stat-grid .ar-stat')).toHaveCount(5)
      await expect(view.getByText('[Reviewed photo caption]', { exact: true })).toBeVisible()
      await expect(view.getByText('[First country]', { exact: true })).toBeHidden()
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await view.locator('.ar-region-section').screenshot({ path: resolve(folder, 'regions-closed-' + width + '.png') })
      await view.getByText('View all countries', { exact: true }).click()
      await expect(view.getByText('[First country]', { exact: true })).toBeVisible()
      await view.locator('.ar-region-section').screenshot({ path: resolve(folder, 'regions-open-' + width + '.png') })
      for (const layout of ['response', 'feature', 'reading', 'text'])
        await view
          .locator('[data-report-layout=' + layout + ']')
          .screenshot({ path: resolve(folder, 'story-' + layout + '-' + width + '.png') })
    }
    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + f.pages[0] + '?section=1')
    await canvas(page).locator('[data-report-layout=response] cms-slot[data-cms-slot=stats__i1__value]').click()
    const panel = page.locator('.inspector')
    await expect(panel.getByLabel('Story layout', { exact: true })).toHaveCount(0)
    await panel.getByLabel('Number', { exact: true }).fill('18')
    await expect(canvas(page).locator('[data-report-layout=response] .ar-stat-number').first()).toHaveText('18')
    await expect(canvas(page).locator('[data-report-layout=response] .ar-program-impact')).toBeHidden()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await page.screenshot({ path: resolve(folder, 'edit-stat-' + width + '.png') })
    }
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    expect(
      (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!.published_version_id,
    ).toBe(published)
    await view.goto(url)
    await expect(view.locator('[data-report-layout=response] .ar-stat-number').first()).toHaveText('1')
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Publish this page', exact: true })
    await expect(review).toBeVisible()
    const acknowledgement =
      info.project.name === 'webkit'
        ? page.waitForResponse(
            response =>
              response.request().method() === 'POST' &&
              new URL(response.url()).pathname === new URL(page.url()).pathname,
          )
        : null
    await review.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByText('Published. The live page now shows these changes.')).toBeVisible({ timeout: 60000 })
    if (acknowledgement) expect(await (await acknowledgement).finished()).toBeNull()
    await view.goto(url)
    await expect(view.locator('[data-report-layout=response] .ar-stat-number').first()).toHaveText('18')
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await context.close()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
