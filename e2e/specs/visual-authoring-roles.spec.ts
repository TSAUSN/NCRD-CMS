import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { compileSection } from '@cms/renderer'
import { saveDraft, signIn } from './helpers.ts'

test('site admins create and revise visually while advanced source stays with super admins', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000)
  const database = process.env['E2E_DATABASE'] ?? 'cms_e2e'
  if (database !== 'cms_e2e' && !database.startsWith('cms_e2e_')) throw new Error('Use a disposable E2E database.')
  const client = new Client({
    connectionString: `postgres://cms:cms@${process.env['E2E_PG_HOST'] ?? '127.0.0.1'}:${process.env['E2E_PG_PORT'] ?? '54329'}/${database}`,
  })
  await client.connect()
  const suffix = Date.now(),
    email = `visual-admin-${suffix}@example.test`,
    name = `Visual role band ${suffix}`
  let site = '',
    legacy = '',
    sourcePage = ''
  const pageCss = '.cms-section{outline:0}',
    pageHtml = '<h2>Preserved page override</h2>'
  try {
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const user = (await client.query('SELECT app.provision_user($1,$2) AS id', [email, 'Visual site admin'])).rows[0]!
      .id
    await client.query("SELECT app.set_site_membership($1,$2,'site_admin')", [user, site])
    const slug = `advanced-role-${suffix}`,
      html = '<h1>Approved advanced source</h1>'
    const compiled = compileSection({
      sourceHtml: html,
      sourceCss: '',
      slots: [],
      scopeSelector: `.cms-section--${slug}`,
    })
    legacy = (
      await client.query(
        'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        [
          slug,
          'Approved source fixture',
          'Tests',
          html,
          '',
          '',
          JSON.stringify(compiled.ast),
          '[]',
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Source role fixture',
          false,
          'legacy',
          null,
          null,
          'site',
          site,
        ],
      )
    ).rows[0]!.section_def_id
    const hero = (await client.query("SELECT id FROM section_defs WHERE slug='hero' AND scope='global'")).rows[0]!.id
    sourcePage = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [
        site,
        `source-page-${suffix}`,
        'Preserved source page',
      ])
    ).rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      sourcePage,
      JSON.stringify([
        {
          section_def_id: hero,
          section_def_version: 1,
          values: { heading: 'Ordinary editable heading' },
          custom_css: pageCss,
          raw_html: pageHtml,
        },
      ]),
      '{}',
    ])
    await client.query('COMMIT')

    await signIn(page, email)
    await page.goto(`/sites/${site}/sections/new`)
    await expect(page.getByLabel('Section name', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'HTML template', exact: true })).toHaveCount(0)
    await expect(page.getByText('Advanced structure and styling', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Section CSS', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Load structure JSON', exact: true })).toHaveCount(0)
    await page.getByLabel('Section name', { exact: true }).fill(name)
    await page.getByRole('button', { name: '+ Two columns', exact: true }).first().click()
    await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await expect(page.locator('iframe[title="Visual section preview"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save this section', exact: true })).toBeDisabled()
    await page.locator('#section-change-note').fill('Add a responsive two-column section for the site')
    await page.getByRole('button', { name: 'Save this section', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Section saved', exact: true })).toBeVisible()
    const definition = (await client.query('SELECT id FROM section_defs WHERE site_id=$1 AND name=$2', [site, name]))
      .rows[0]!.id
    await page.goto(`/sites/${site}/sections/${definition}/edit`)
    await page.locator('#builder-label-0-0-0').fill('Visual heading')
    await page.locator('#section-change-note').fill('Clarify the heading field label')
    await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await page.getByRole('button', { name: 'Save new section version', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Section saved', exact: true })).toBeVisible()
    const versions = (
      await client.query(
        'SELECT version,source_css,compiled_css FROM section_def_versions WHERE section_def_id=$1 ORDER BY version',
        [definition],
      )
    ).rows
    expect(versions.map(row => row.version)).toEqual([1, 2])
    expect(versions[1]!.source_css).toBe(versions[0]!.source_css)
    expect(versions[1]!.compiled_css).toBe(versions[0]!.compiled_css)
    await page.goto(`/sites/${site}/sections/${legacy}/edit`)
    await expect(page.getByRole('heading', { name: 'This section uses advanced source', exact: true })).toBeVisible()
    await expect(page.getByLabel('HTML', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save new section version', exact: true })).toHaveCount(0)

    await page.goto(`/pages/${sourcePage}?section=0`)
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await expect(inspector.getByLabel('Custom CSS', { exact: true })).toHaveCount(0)
    await expect(inspector.getByLabel('Section HTML', { exact: true })).toHaveCount(0)
    await expect(inspector.getByRole('tab', { name: 'Advanced', exact: true })).toBeVisible()
    await inspector.getByRole('tab', { name: 'Advanced', exact: true }).click()
    await inspector.getByText('Custom CSS for this section', { exact: false }).click()
    await expect(inspector.getByLabel('Custom CSS', { exact: true })).toHaveValue(pageCss)
    await expect(inspector.getByLabel('Section HTML', { exact: true })).toHaveCount(0)
    await inspector.getByRole('tab', { name: 'Content', exact: true }).click()
    await inspector.locator('#slot-0-heading').fill('Ordinary edit preserves approved source')
    await saveDraft(page)
    const saved = (
      await client.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [sourcePage],
      )
    ).rows[0]!.content[0]
    expect(saved.values.heading).toBe('Ordinary edit preserves approved source')
    expect(saved.custom_css).toBe(pageCss)
    expect(saved.raw_html).toBe(pageHtml)

    await context.clearCookies()
    await signIn(page, 'root@example.test')
    await page.goto(`/pages/${sourcePage}?section=0`)
    await inspector.getByRole('tab', { name: 'Advanced', exact: true }).click()
    await inspector.getByText('Custom CSS for this section', { exact: false }).click()
    await inspector.getByText('Edit the HTML of this section', { exact: false }).click()
    await expect(inspector.getByLabel('Custom CSS', { exact: true })).toHaveValue(pageCss)
    await expect(inspector.getByLabel('Section HTML', { exact: true })).toHaveValue(pageHtml)
    await page.goto(`/sites/${site}/sections/${legacy}/edit`)
    await expect(page.getByLabel('HTML', { exact: true })).toHaveValue(html)
    await page.goto(`/sites/${site}/sections/${definition}/edit`)
    await page.getByText('Advanced structure and styling', { exact: true }).click()
    await expect(page.getByLabel('Section CSS', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load structure JSON', exact: true })).toBeVisible()
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    await client.end()
  }
})
