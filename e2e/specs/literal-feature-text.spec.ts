import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { e2eTarget } from '../test-target.ts'
import { canvas, signIn, saveDraft, publish } from './helpers.ts'

const text =
  'class="echelon-example" class="echelon-template" sawso-report cms-material-symbols cms-data-source data-cms-site-widget="x" data-cms-provider-fullscreen data-cms-echelon-directory data-cms-stories-widget="0" data-cms-hero="0" data-cms-faq-filter data-cms-track-filter data-cms-embed-provider="youtube"'

test('typing feature-like words preserves ordinary preview, live styling and security policy', async ({
  page,
  browser,
}, info) => {
  const target = e2eTarget()
  const pool = new Pool({ connectionString: `postgres://cms:cms@${target.host}:${target.port}/${target.database}` })
  const client = await pool.connect()
  const slug = 'literal-' + randomUUID().slice(0, 8)
  const folder = resolve('../.r8-progress/literal-feature-text/' + info.project.name)
  let id = ''
  const publicContext = await browser.newContext({ javaScriptEnabled: false })
  const visitor = await publicContext.newPage()
  try {
    await mkdir(folder, { recursive: true })
    await client.query('BEGIN')
    const actor = (await client.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const def = (
      await client.query(
        "SELECT d.id,max(v.version) AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='hero' AND d.site_id IS NULL GROUP BY d.id",
      )
    ).rows[0]!
    await client.query('SET LOCAL ROLE cms_authenticated_user')
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    id = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, '[Literal text page]'])).rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      id,
      JSON.stringify([
        {
          section_def_id: def.id,
          section_def_version: def.version,
          values: { heading: '[Literal text page]', intro: '[Ordinary introduction]' },
        },
      ]),
      '{}',
    ])
    await client.query('COMMIT')

    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + id + '?section=0')
    await publish(page)
    const initial = await visitor.goto(`http://demo.staging.localhost:${E2E_PORTS.site}/` + slug)
    const initialPolicy = initial!.headers()['content-security-policy']
    const initialStyles = await visitor.locator('head style').allTextContents()
    await expect(visitor.locator('script')).toHaveCount(0)

    await page.getByLabel('Intro', { exact: true }).fill(text)
    await saveDraft(page)
    await expect(canvas(page).getByText(text, { exact: true })).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.getByRole('button', { name: 'Fit', exact: true }).click()
      await page.evaluate(() => document.fonts.ready)
      await expect(canvas(page).getByText(text, { exact: true })).toBeVisible()
      await page.screenshot({ path: resolve(folder, 'saved-preview-' + width + '.png') })
    }
    await publish(page)
    for (const width of [1440, 1024, 390]) {
      await visitor.setViewportSize({ width, height: 1000 })
      const response = await visitor.goto(`http://demo.staging.localhost:${E2E_PORTS.site}/` + slug)
      await expect(visitor.getByText(text, { exact: true })).toBeVisible()
      expect(await visitor.locator('head style').allTextContents()).toEqual(initialStyles)
      expect(response!.headers()['content-security-policy']).toBe(initialPolicy)
      await expect(visitor.locator('script')).toHaveCount(0)
      expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await visitor.evaluate(() => document.fonts.ready)
      await visitor.screenshot({ path: resolve(folder, 'literal-public-' + width + '.png'), fullPage: true })
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    if (id) await pool.query('UPDATE pages SET archived_at=now() WHERE id=$1', [id])
    await publicContext.close()
    client.release()
    await pool.end()
  }
})
