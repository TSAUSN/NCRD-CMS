import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { DEFAULT_THEME_TOKENS } from '@cms/schema'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { e2eTarget } from '../test-target.ts'
import { signIn } from './helpers.ts'

test('keeps header and footer edits through source comparisons, saving and reopening', async ({ page }) => {
  const target = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${target.host}:${target.port}/${target.database}` })
  await client.connect()
  let siteId = ''
  try {
    const actor = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    siteId = (
      await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        `source-drafts-${Date.now()}`,
        'Source comparison fixture',
        'resource',
        null,
        JSON.stringify(DEFAULT_THEME_TOKENS),
        '[]',
      ])
    ).rows[0]!.id
    const frames: Record<string, unknown> = {}
    for (const kind of ['header', 'footer'] as const) {
      const slug = `source-drafts-${kind}-${Date.now()}`
      const slots = [{ id: 'heading', kind: 'text' as const, label: 'Frame heading', constraints: {} }]
      const html = '<strong>{{heading}}</strong>'
      const compiled = compileSection({
        sourceHtml: html,
        sourceCss: '',
        slots,
        scopeSelector: sectionScopeSelector(slug)!,
      })
      expect(compiled.blocking).toEqual([])
      const definition = (
        await client.query(
          'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [
            slug,
            `${kind} draft fixture`,
            'Frame',
            html,
            '',
            compiled.css,
            JSON.stringify(compiled.ast),
            JSON.stringify(slots),
            compiled.renderHash,
            compiled.ast.policyVersion,
            compiled.ast.cssPolicyVersion,
            'Browser regression fixture',
          ],
        )
      ).rows[0]!.section_def_id
      await client.query('SELECT app.set_section_def_placement($1,$2)', [definition, kind])
      frames[kind] = {
        schemaVersion: 2,
        enabled: true,
        ...(kind === 'header' ? { sticky: false } : {}),
        component: { section_def_id: definition, section_def_version: 1, values: { heading: `${kind} original` } },
      }
    }
    const heads = (await client.query('SELECT kind,revision FROM global_elements WHERE site_id=$1', [siteId])).rows
    await client.query('SELECT app.save_global_elements_draft($1,$2,$3,$4,$5)', [
      siteId,
      heads.find(row => row.kind === 'header')!.revision,
      heads.find(row => row.kind === 'footer')!.revision,
      JSON.stringify(frames.header),
      JSON.stringify(frames.footer),
    ])
    const liveBefore = (
      await client.query('SELECT kind,published_version_id FROM global_elements WHERE site_id=$1 ORDER BY kind', [
        siteId,
      ])
    ).rows
    await client.query('COMMIT')

    await signIn(page, 'root@example.test')
    await page.goto(`/sites/${siteId}/global-elements`)
    for (const kind of ['header', 'footer'] as const) {
      await page.getByRole('tab', { name: kind === 'header' ? 'Header' : 'Footer', exact: true }).click()
      const source = page.getByRole('radiogroup', { name: kind === 'header' ? 'Header source' : 'Footer source' })
      const authored = source.getByRole('radio', { name: 'Authored component' })
      const preset = source.getByRole('radio', { name: 'Layout presets' })
      const heading = page.getByLabel('Frame heading', { exact: true })
      await expect(heading).toHaveValue(`${kind} original`)
      await heading.fill(`${kind} revised`)
      await authored.click()
      await expect(heading).toHaveValue(`${kind} revised`)
      await preset.click()
      const name = page.getByLabel('Displayed site name', { exact: true })
      await name.fill(`${kind} preset alternative`)
      await authored.click()
      await expect(heading).toHaveValue(`${kind} revised`)
      await preset.click()
      await expect(name).toHaveValue(`${kind} preset alternative`)
      await authored.click()
    }
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(
      page.getByText('Header and footer draft saved. Visitors still see the published version.'),
    ).toBeVisible()
    await page.reload()
    for (const kind of ['header', 'footer'] as const) {
      await page.getByRole('tab', { name: kind === 'header' ? 'Header' : 'Footer', exact: true }).click()
      await expect(page.getByLabel('Frame heading', { exact: true })).toHaveValue(`${kind} revised`)
    }
    expect(
      (
        await client.query('SELECT kind,published_version_id FROM global_elements WHERE site_id=$1 ORDER BY kind', [
          siteId,
        ])
      ).rows,
    ).toEqual(liveBefore)
  } finally {
    await client.query('ROLLBACK')
    await client.end()
  }
})
