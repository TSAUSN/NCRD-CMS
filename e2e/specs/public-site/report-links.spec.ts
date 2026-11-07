import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn, canvas } from '../helpers.ts'
import { NATIONAL_TEMPLATE_THEME } from '../../../packages/seeds/src/core-themes.ts'
test('report page links follow visible named sections and heading edits, with native phone jumps without JavaScript', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const literalLabel = "[First $` $& $' $$ $1 section]"
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    context = await browser.newContext({ javaScriptEnabled: false }),
    view = await context.newPage(),
    folder = resolve('../.r8-progress/round3/report-links/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    await c.query('BEGIN')
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const definitions = (
      await c.query(
        "SELECT d.id,d.slug,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.scope='global' AND d.slug IN ('core-report-page-links','core-text-block')",
      )
    ).rows
    const links = definitions.find(d => d.slug === 'core-report-page-links')!,
      text = definitions.find(d => d.slug === 'core-text-block')!,
      head = (
        await c.query(
          'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.pages[0]],
        )
      ).rows[0]!,
      theme = (await c.query('SELECT revision FROM themes WHERE site_id=$1', [f.site])).rows[0]!
    const revision = (
      await c.query('SELECT * FROM app.save_theme_draft($1,$2,$3)', [
        f.site,
        theme.revision,
        JSON.stringify(NATIONAL_TEMPLATE_THEME),
      ])
    ).rows[0]!.revision
    await c.query('SELECT app.publish_theme($1,$2)', [f.site, revision])
    const target = (heading: string, anchor: string, extra: Record<string, unknown> = {}) => ({
      section_def_id: text.id,
      section_def_version: text.version,
      label: heading,
      hidden: false,
      values: {
        heading,
        body: '<p>[Reviewed paragraph]</p>'.repeat(18),
        ...(anchor ? { __cms_anchor: anchor } : {}),
        ...extra,
      },
    })
    const content = [
      ...head.content,
      {
        section_def_id: links.id,
        section_def_version: links.version,
        label: 'Page links',
        values: { mobile_label: 'Explore the report', links: { items: [] } },
      },
      target(literalLabel, 'first-section'),
      target('[Second section]', 'second-section'),
      { ...target('[Hidden section]', 'hidden-section'), hidden: true },
      target('[Unnamed section]', ''),
      target('[Earlier link name]', '', { __cms_anchor_aliases: ['earlier-link-name'] }),
    ]
    await c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      f.pages[0],
      head.revision,
      JSON.stringify(content),
      JSON.stringify(head.meta),
    ])
    await c.query("SELECT app.publish_page($1,$2,3,NULL,'[]')", [f.pages[0], Number(head.revision) + 1])
    await c.query('COMMIT')
    const url = 'http://' + f.host + `:${E2E_PORTS.site}/`,
      published = (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!
        .published_version_id
    for (const width of [1440, 1024, 390]) {
      await view.setViewportSize({ width, height: 950 })
      await view.goto(url)
      const nav = view.getByRole('navigation', {
        name: width === 390 ? 'On this page on phones' : 'On this page',
        exact: true,
      })
      if (width === 390) {
        await expect(nav).toBeHidden()
        await view.locator('.ar-page-links').screenshot({ path: resolve(folder, 'closed-390.png') })
        await view.getByText('Explore the report', { exact: true }).click()
      }
      await expect(nav.getByRole('link')).toHaveCount(2)
      await expect(nav.getByRole('link', { name: literalLabel, exact: true })).toHaveAttribute('href', '#first-section')
      await view.locator('.ar-page-links').screenshot({ path: resolve(folder, 'links-' + width + '.png') })
      await nav.getByRole('link', { name: '[Second section]', exact: true }).click()
      await expect(view).toHaveURL(/#second-section$/)
      expect(await view.evaluate(() => scrollY > 0)).toBe(true)
      await expect(view.getByRole('heading', { name: '[Second section]', exact: true })).toBeVisible()
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + f.pages[0] + '?section=2')
    await canvas(page).locator('[data-cms-section="2"] cms-slot[data-cms-slot="heading"]').click()
    await page.locator('.inspector').getByLabel('Title', { exact: true }).fill('[Updated section]')
    await expect(
      canvas(page).locator('.ar-jump').getByRole('link', { name: '[Updated section]', exact: true }),
    ).toHaveAttribute('href', '#first-section')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await page.screenshot({ path: resolve(folder, 'edit-heading-' + width + '.png') })
    }
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    expect(
      (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!.published_version_id,
    ).toBe(published)
    await view.goto(url)
    await view.getByText('Explore the report', { exact: true }).click()
    await expect(
      view
        .getByRole('navigation', { name: 'On this page on phones', exact: true })
        .getByRole('link', { name: literalLabel, exact: true }),
    ).toBeVisible()
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
    await view.getByText('Explore the report', { exact: true }).click()
    await expect(
      view
        .getByRole('navigation', { name: 'On this page on phones', exact: true })
        .getByRole('link', { name: '[Updated section]', exact: true }),
    ).toBeVisible()
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await context.close()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
