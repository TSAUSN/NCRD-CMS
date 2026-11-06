import { setPreviewSiteLook } from './helpers.ts'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { DEFAULT_THEME_TOKENS } from '@cms/schema'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { addSectionButton, signIn, treeLabels } from './helpers.ts'

test('keeps saved-site appearance consistent through canvas, library, creator and section update', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000)
  const db = process.env['E2E_DATABASE'] ?? 'cms_e2e'
  if (db !== 'cms_e2e' && !db.startsWith('cms_e2e_')) throw new Error('Use a disposable E2E database.')
  const client = new Client({
    connectionString: `postgres://cms:cms@${process.env['E2E_PG_HOST'] ?? '127.0.0.1'}:${process.env['E2E_PG_PORT'] ?? '54329'}/${db}`,
  })
  await client.connect()
  let siteId = '',
    rootId = ''
  try {
    rootId = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
    siteId = (
      await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        `combined-preview-${Date.now()}`,
        'Combined preview fixture',
        'resource',
        null,
        JSON.stringify(DEFAULT_THEME_TOKENS),
        '[]',
      ])
    ).rows[0]!.id
    // This comparison needs an explicitly published appearance baseline.
    await client.query('SELECT app.publish_theme($1,1)', [siteId])
    await client.query('SELECT app.publish_global_elements($1,1,1)', [siteId])
    await client.query('SELECT app.publish_navigation($1,1)', [siteId])
    const pageId = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [siteId, '', 'Combined page']))
      .rows[0]!.id
    const targetId = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [siteId, 'draft-target', 'Draft target'])
    ).rows[0]!.id
    const sourceHtml = '<div><h1>{{heading}}</h1><p>{{intro}}</p></div>'
    const slots = [
      { id: 'heading', kind: 'text' as const, label: 'Heading', constraints: {} },
      { id: 'intro', kind: 'text' as const, label: 'Introduction', constraints: {} },
    ]
    const css = 'h1{color:var(--color-primary)}'
    const compiled = compileSection({
      sourceHtml,
      sourceCss: css,
      slots,
      scopeSelector: sectionScopeSelector('context-preview-band')!,
    })
    expect(compiled.blocking).toEqual([])
    let hero = ''
    for (const version of [1, 2]) {
      const result = await client.query(
        'SELECT * FROM app.save_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
        [
          'context-preview-band',
          'Context preview band',
          'Tests',
          sourceHtml,
          css,
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          `Version ${version}`,
          false,
          'legacy',
          null,
          null,
          'site',
          siteId,
          version - 1,
          hero || null,
        ],
      )
      hero = result.rows[0]!.section_def_id
    }
    const saved = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3,$4,$5)', [
        pageId,
        JSON.stringify([
          {
            section_def_id: hero,
            section_def_version: 1,
            values: { heading: 'Combined preview page', intro: 'Saved page content' },
            hidden: false,
            hidden_at: [],
            label: 'Hero',
          },
        ]),
        '{}',
        'checkpoint',
        'Combined site preview fixture',
      ])
    ).rows[0]!
    const live = (await client.query('SELECT payload FROM published_site_shells WHERE site_id=$1', [siteId])).rows[0]!
      .payload
    const globalHeads = (
      await client.query(
        'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
        [siteId],
      )
    ).rows
    const h = globalHeads.find(row => row.kind === 'header')!,
      f = globalHeads.find(row => row.kind === 'footer')!
    await client.query('SELECT app.save_global_elements_draft($1,$2,$3,$4,$5)', [
      siteId,
      h.revision,
      f.revision,
      JSON.stringify({ ...h.content, brand: { ...h.content.brand, siteName: 'Saved draft brand' } }),
      JSON.stringify({ ...f.content, brand: { ...f.content.brand, blurb: 'Saved draft footer' } }),
    ])
    const themeRevision = (await client.query('SELECT revision FROM themes WHERE site_id=$1', [siteId])).rows[0]!
      .revision
    await client.query('SELECT app.save_theme_draft($1,$2,$3)', [
      siteId,
      themeRevision,
      JSON.stringify({ ...DEFAULT_THEME_TOKENS, colors: { ...DEFAULT_THEME_TOKENS.colors, primary: '#0055aa' } }),
    ])
    const navRevision = (await client.query('SELECT revision FROM navigations WHERE site_id=$1', [siteId])).rows[0]!
      .revision
    await client.query('SELECT app.save_navigation_draft($1,$2,$3,$4)', [
      siteId,
      navRevision,
      JSON.stringify([{ label: 'Saved draft menu', target: { type: 'page', page_id: targetId }, visible: true }]),
      'manual',
    ])
    const before = (await client.query('SELECT revision,draft_version_id FROM pages WHERE id=$1', [pageId])).rows[0]!
    await client.query('COMMIT')

    await signIn(page, 'root@example.test')
    await page.goto(`/pages/${pageId}?site=published`)
    const selector = page.getByLabel('Preview with saved site-look changes', { exact: true })
    const canvas = page.frameLocator('iframe[title="Page canvas"]')
    await expect(selector).not.toBeChecked()
    await expect(canvas.getByRole('heading', { name: 'Combined preview page' })).toBeVisible()
    await expect(canvas.getByText('Saved draft brand', { exact: true })).toHaveCount(0)
    await setPreviewSiteLook(page, 'draft')
    await expect(selector).toBeChecked()
    await expect(page.locator('iframe[title="Page canvas"]')).toHaveAttribute('src', /site=draft/)
    await expect(canvas.getByText('Saved draft brand', { exact: true })).toBeVisible()
    await expect(canvas.getByText('Saved draft footer', { exact: true })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Saved draft menu' })).toHaveAttribute('href', '/draft-target')
    await expect(canvas.locator('.cms-site-header')).toHaveCSS('border-top-color', 'rgb(0, 85, 170)')
    await canvas.getByRole('heading', { name: 'Combined preview page' }).click()
    await expect(page.getByLabel('Heading', { exact: true })).toHaveValue('Combined preview page')

    // Native insertion previews use the real canvas and its selected site look.
    // Cancelling removes only the sample section and writes no page version.
    const library = page.getByRole('dialog', { name: 'Add a section', exact: true })
    const sample = canvas.locator('[data-cms-section="1"]')
    const previewBand = async () => {
      await addSectionButton(page).click()
      await page.getByRole('button', { name: 'Preview Context preview band', exact: true }).click()
      await expect(library.getByRole('button', { name: 'Add this section', exact: true })).toBeEnabled()
      await expect(canvas.locator('[data-cms-section]')).toHaveCount(2)
      await expect(library.locator('iframe')).toHaveCount(0)
    }
    const cancelSample = async () => {
      await page.keyboard.press('Escape')
      await expect(library).toHaveCount(0)
      await expect(canvas.locator('[data-cms-section]')).toHaveCount(1)
    }
    await previewBand()
    await expect(sample.locator('h1')).toHaveCSS('color', 'rgb(0, 85, 170)')
    await expect(canvas.getByText('Saved draft brand', { exact: true })).toHaveCount(1)
    await expect(canvas.getByRole('link', { name: 'Saved draft menu' })).toHaveAttribute('href', '/draft-target')
    await cancelSample()
    await setPreviewSiteLook(page, 'published')
    await previewBand()
    await expect(sample.locator('h1')).not.toHaveCSS('color', 'rgb(0, 85, 170)')
    await expect(canvas.getByText('Saved draft brand', { exact: true })).toHaveCount(0)
    await cancelSample()
    await setPreviewSiteLook(page, 'draft')
    await previewBand()
    await expect(sample.locator('h1')).toHaveCSS('color', 'rgb(0, 85, 170)')
    await expect(canvas.getByText('Saved draft brand', { exact: true })).toHaveCount(1)
    await cancelSample()

    // Review both sides against the same saved context, then cancel and reopen
    // in published context without saving or publishing either result.
    await canvas.getByRole('heading', { name: 'Combined preview page' }).click()
    const review = page.getByRole('button', { name: 'Review layout update', exact: true })
    if (await page.getByRole('button', { name: 'Open Structure', exact: true }).isVisible())
      await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await treeLabels(page).first().click()
    await page.getByRole('tab', { name: 'Advanced', exact: true }).click()
    await review.click()
    const update = page.getByRole('dialog', { name: 'Review section update' })
    await expect(update.getByText('Both previews use the saved, unpublished site design.')).toBeVisible()
    for (const title of ['Current section version in the page', 'Proposed section update in the page']) {
      const frame = update.frameLocator(`iframe[title="${title}"]`)
      await expect(frame.getByText('Saved draft brand', { exact: true })).toBeVisible()
      await expect(frame.getByRole('heading', { name: 'Combined preview page' })).toHaveCSS('color', 'rgb(0, 85, 170)')
      const phoneMenu = frame.locator('.cms-phone-menu')
      if (await phoneMenu.locator('summary').isVisible()) await phoneMenu.locator('summary').click()
      await expect(frame.getByRole('link', { name: 'Saved draft menu' })).toHaveAttribute('href', '/draft-target')
    }
    await update.getByLabel('Compare at').selectOption('390')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await expect(update.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
      await page.screenshot({ path: test.info().outputPath(`saved-site-section-review-phone-${width}.png`) })
    }
    await update.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(update).toHaveCount(0)
    await expect(review).toBeFocused()
    await setPreviewSiteLook(page, 'published')
    if (await page.getByRole('button', { name: 'Open Structure', exact: true }).isVisible())
      await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await treeLabels(page).first().click()
    await page.getByRole('tab', { name: 'Advanced', exact: true }).click()
    await review.click()
    await expect(update.getByText('Both previews use the live site design.')).toBeVisible()
    for (const title of ['Current section version in the page', 'Proposed section update in the page']) {
      await expect(
        update.frameLocator(`iframe[title="${title}"]`).getByText('Saved draft brand', { exact: true }),
      ).toHaveCount(0)
    }
    await page.keyboard.press('Escape')
    await expect(update).toHaveCount(0)

    const history = await page.evaluate(async url => {
      const response = await fetch(url, { credentials: 'same-origin' })
      return { status: response.status, body: await response.text() }
    }, `/preview/${saved.version_id}?readonly=1&site=draft`)
    expect(history.status).toBe(200)
    expect(history.body).not.toContain('Saved draft brand')
    await setPreviewSiteLook(page, 'published')
    await expect(canvas.getByText('Saved draft brand', { exact: true })).toHaveCount(0)
    expect((await client.query('SELECT revision,draft_version_id FROM pages WHERE id=$1', [pageId])).rows[0]).toEqual(
      before,
    )
    expect(
      (await client.query('SELECT payload FROM published_site_shells WHERE site_id=$1', [siteId])).rows[0]!.payload,
    ).toEqual(live)
    expect((await client.query('SELECT page_id FROM published_routes WHERE site_id=$1', [siteId])).rows).toEqual([])

    // Standalone creators have an explicit choice; changing it hides the stale
    // preview and requires a fresh check before saving, in both authoring modes.
    await page.goto(`/sites/${siteId}/sections/new`)
    const appearance = page.getByLabel('Preview appearance', { exact: true })
    await expect(appearance).toHaveValue('published')
    await page.getByLabel('Section name', { exact: true }).fill('Preview context visual')
    await page.locator('#section-change-note').fill('Create a saved-appearance preview fixture')
    await appearance.selectOption('draft')
    await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
    const visualFrame = page.frameLocator('iframe[title="Visual section preview"]')
    await expect(visualFrame.locator('header,footer')).toHaveCount(0)
    await expect(visualFrame.locator('html')).toHaveCSS('--color-primary', '#0055aa')
    await expect(page.getByRole('button', { name: 'Save this section', exact: true })).toBeEnabled()
    await appearance.selectOption('published')
    await expect(page.locator('iframe[title="Visual section preview"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save this section', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await expect(visualFrame.locator('main')).toBeVisible()
    await expect(visualFrame.getByText('Saved draft brand', { exact: true })).toHaveCount(0)
    await expect(visualFrame.locator('html')).not.toHaveCSS('--color-primary', '#0055aa')
    await page.getByRole('button', { name: 'HTML template', exact: true }).click()
    await page.getByLabel('What is this section called?').fill('Preview context HTML')
    await appearance.selectOption('draft')
    await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
    const htmlFrame = page.frameLocator('iframe[title="Section preview"]')
    await expect(htmlFrame.locator('header,footer')).toHaveCount(0)
    await expect(htmlFrame.locator('html')).toHaveCSS('--color-primary', '#0055aa')
    await appearance.selectOption('published')
    await expect(page.locator('iframe[title="Section preview"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await expect(htmlFrame.locator('main')).toBeVisible()
    await expect(htmlFrame.getByText('Saved draft brand', { exact: true })).toHaveCount(0)
    await expect(htmlFrame.locator('html')).not.toHaveCSS('--color-primary', '#0055aa')

    // Deliberately discard the unsaved creator draft before leaving.
    page.once('dialog', dialog => dialog.accept())
    // Standalone library can select both another accessible brand and saved drafts.
    await page.goto(`/sites/${siteId}/sections?site=draft`)
    await page.getByRole('button', { name: 'Preview Context preview band', exact: true }).click()
    const standalone = page.getByRole('dialog', { name: 'Preview Context preview band', exact: true })
    await expect(standalone.frameLocator('iframe').locator('header,footer')).toHaveCount(0)
    await expect(standalone.frameLocator('iframe').locator('h1')).toHaveCSS('color', 'rgb(0, 85, 170)')
    await page.keyboard.press('Escape')
    await expect(standalone).toHaveCount(0)
    expect((await client.query('SELECT revision,draft_version_id FROM pages WHERE id=$1', [pageId])).rows[0]).toEqual(
      before,
    )
    expect(
      (await client.query('SELECT payload FROM published_site_shells WHERE site_id=$1', [siteId])).rows[0]!.payload,
    ).toEqual(live)

    // The Header & footer preview offers the same choice. Nothing on this site
    // is live, so it starts with the saved menu and design, as the editor does;
    // the header and footer are always the ones being edited.
    await page.goto(`/sites/${siteId}/global-elements`)
    const frameAppearance = page.getByLabel('Site design', { exact: true })
    const framePreview = page.frameLocator('iframe[title$="header and footer preview"]')
    await expect(frameAppearance).toHaveValue('draft')
    await expect(framePreview.getByRole('link', { name: 'Saved draft menu' })).toHaveAttribute('href', '/draft-target')
    await expect(framePreview.locator('.cms-site-header')).toHaveCSS('border-top-color', 'rgb(0, 85, 170)')
    await frameAppearance.selectOption('published')
    await expect(framePreview.getByRole('link', { name: 'Saved draft menu' })).toHaveCount(0)
    await expect(framePreview.getByText('Saved draft brand', { exact: true })).toBeVisible()
    await expect(framePreview.locator('.cms-site-header')).not.toHaveCSS('border-top-color', 'rgb(0, 85, 170)')

    // Applying is deliberate and keeps the chosen context on the refreshed editor.
    await page.goto(`/pages/${pageId}?site=draft`)
    await expect(selector).toBeChecked()
    await canvas.getByRole('heading', { name: 'Combined preview page' }).click()
    if (await page.getByRole('button', { name: 'Open Structure', exact: true }).isVisible())
      await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await treeLabels(page).first().click()
    await page.getByRole('tab', { name: 'Advanced', exact: true }).click()
    await review.click()
    await expect(update.getByText('Both previews use the saved, unpublished site design.')).toBeVisible()
    await update.getByRole('button', { name: 'Apply to draft', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/pages/${pageId}\\?section=0&site=draft$`))
    await expect(selector).toBeChecked()
    await expect(canvas.getByText('Saved draft brand', { exact: true })).toBeVisible()
    const upgraded = (
      await client.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [pageId],
      )
    ).rows[0]!.content
    expect(upgraded[0].section_def_version).toBe(2)
    expect(upgraded[0].values.heading).toBe('Combined preview page')
    expect(
      (await client.query('SELECT payload FROM published_site_shells WHERE site_id=$1', [siteId])).rows[0]!.payload,
    ).toEqual(live)
    expect((await client.query('SELECT page_id FROM published_routes WHERE site_id=$1', [siteId])).rows).toEqual([])

    const accessibleSite = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const globalHero = (await client.query("SELECT id FROM section_defs WHERE scope='global' AND slug='hero'")).rows[0]!
      .id
    await context.clearCookies()
    await signIn(page, 'editor@example.test')
    expect(
      await page.evaluate(
        async url => (await fetch(url, { credentials: 'same-origin' })).status,
        `/preview/${saved.version_id}?site=draft`,
      ),
    ).toBe(404)
    for (const url of [
      `/api/sites/${siteId}/sections/${hero}/preview?site=draft`,
      `/api/sites/${accessibleSite}/sections/${globalHero}/preview?themeSiteId=${siteId}&site=draft`,
    ])
      expect(await page.evaluate(async path => (await fetch(path, { credentials: 'same-origin' })).status, url)).toBe(
        404,
      )
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    if (siteId) {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
      const row = (await client.query('SELECT revision FROM sites WHERE id=$1', [siteId])).rows[0]!
      await client.query('SELECT app.archive_site($1,$2)', [siteId, row.revision])
      await client.query('COMMIT')
    }
    await client.end()
  }
})
