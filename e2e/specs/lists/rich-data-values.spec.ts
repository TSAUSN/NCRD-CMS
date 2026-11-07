import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn, canvas } from '../helpers.ts'
test('rich saved numbers preserve paragraphs and bold text, replace one binding at a time and detach into visual editing', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    context = await browser.newContext({ javaScriptEnabled: false }),
    view = await context.newPage(),
    folder = resolve('../.r8-progress/round3/report-numbers/' + info.project.name),
    id = randomUUID(),
    other = randomUUID(),
    third = randomUUID()
  try {
    await mkdir(folder, { recursive: true })
    await c.query('BEGIN')
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const numbers = [
        [id, 'Projects', '152'],
        [other, 'Countries', '69'],
        [third, 'Other projects', '158'],
      ].map(([id, label, value]) => ({
        id,
        label,
        value,
        unit: '',
        source: '[Local report, p. 4]',
        sourcePageId: null,
        asOf: 'FY2025',
        status: 'matches-report',
        showSource: false,
      })),
      saved = (
        await c.query('SELECT * FROM app.save_site_settings_draft($1,0,$2)', [
          f.site,
          JSON.stringify({ schemaVersion: 1, name: 'Shared site look', dataValues: numbers }),
        ])
      ).rows[0]!
    await c.query('SELECT app.publish_site_settings($1,$2)', [
      f.site,
      (await c.query('SELECT revision FROM site_settings WHERE site_id=$1', [f.site])).rows[0]!.revision,
    ])
    const def = (
        await c.query(
          "SELECT d.id,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.scope='global' AND d.slug='core-text-image'",
        )
      ).rows[0]!,
      before = (
        await c.query(
          'SELECT p.revision,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.pages[0]],
        )
      ).rows[0]!,
      body =
        '<p>[Across] <strong>152</strong> [projects in] <strong>69</strong> [countries].</p><p>[Second paragraph]</p>',
      binding = {
        format: 'richtext',
        parts: [
          { text: '<p>[Across] <strong>' },
          { valueId: id },
          { text: '</strong> [projects in] <strong>' },
          { valueId: other },
          { text: '</strong> [countries].</p><p>[Second paragraph]</p>' },
        ],
      }
    await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      f.pages[0],
      before.revision,
      JSON.stringify([
        {
          section_def_id: def.id,
          section_def_version: def.version,
          values: { heading: '[Impact]', body, photo: '', __cms_data_values: { body: binding } },
        },
      ]),
      JSON.stringify(before.meta),
    ])
    await c.query("SELECT app.publish_page($1,$2,3,NULL,'[]')", [f.pages[0], Number(before.revision) + 1])
    await c.query('COMMIT')
    const published = (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!
      .published_version_id
    for (const width of [1440, 390]) {
      await view.setViewportSize({ width, height: 1000 })
      await view.goto('http://' + f.host + `:${E2E_PORTS.site}/`)
      await expect(view.locator('.core-text-image-body strong')).toHaveText(['152', '69'])
      await expect(view.getByText('[Second paragraph]', { exact: true })).toBeVisible()
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await view.screenshot({ path: resolve(folder, 'public-' + width + '.png'), fullPage: true })
    }
    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + f.pages[0] + '?section=0')
    const bodyField = canvas(page).locator('[data-cms-slot="body"]')
    await bodyField.click()
    await bodyField.click()
    await expect(bodyField).toHaveAttribute('data-cms-kind', 'saved-number')
    await expect(bodyField).not.toHaveAttribute('contenteditable', 'true')
    await expect(page.getByLabel('Saved number 1', { exact: true })).toHaveValue(id)
    await expect(page.getByLabel('Saved number 2', { exact: true })).toHaveValue(other)
    await expect(page.getByLabel('Words before the number', { exact: true })).toHaveCount(0)
    await page.getByLabel('Saved number 1', { exact: true }).selectOption(third)
    await expect(canvas(page).locator('.core-text-image-body strong')).toHaveText(['158', '69'])
    await expect(page.getByLabel('Saved number 2', { exact: true })).toHaveValue(other)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: resolve(folder, 'bound-' + width + '.png'), fullPage: true })
    }
    await page.getByRole('button', { name: 'Use a number just on this page', exact: true }).click()
    await expect(page.locator('.inspector .tiptap strong')).toHaveText(['158', '69'])
    await expect(page.locator('.inspector .tiptap p')).toHaveCount(2)
    await expect(page.locator('.inspector .tiptap')).not.toContainText('<p>')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: resolve(folder, 'detached-' + width + '.png'), fullPage: true })
    }
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    const after = (
      await c.query(
        'SELECT p.published_version_id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [f.pages[0]],
      )
    ).rows[0]!
    expect(after.published_version_id).toBe(published)
    expect(after.content[0].values.__cms_data_values).toEqual({})
    expect(after.content[0].values.body).toContain('<strong>158</strong>')
    await view.goto('http://' + f.host + `:${E2E_PORTS.site}/`)
    await expect(view.locator('.core-text-image-body strong')).toHaveText(['152', '69'])
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await context.close()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
