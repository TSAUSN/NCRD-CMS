import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { e2eTarget } from '../test-target.ts'
import { canvas, savedState, signIn } from './helpers.ts'

// An imported link keeps its source element, so it is stored as a destination
// field and the words inside it (as the importer maps HNI's hero buttons). The
// inspector presents them as one link, as V1 did (reference 08).
async function database() {
  const { database: name, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${name}` })
  await client.connect()
  return client
}

async function fixture(page: Page) {
  const client = await database()
  let pageId = ''
  try {
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const slug = `imported-link-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const sourceHtml = '<section><h2>{{title}}</h2><a class="pill" href="{{dest}}">{{words}}</a></section>'
    const sourceCss =
      'section{padding:24px}.pill{display:inline-block;padding:8px 16px;border-radius:999px;background:#c8102e;color:#fff}'
    const slots = [
      { id: 'title', label: 'Hero title', kind: 'text' as const, constraints: {} },
      {
        id: 'dest',
        label: 'Home overview link · destination',
        kind: 'link' as const,
        constraints: { destinationOnly: true },
      },
      { id: 'words', label: 'Home overview link · label', kind: 'text' as const, constraints: {} },
    ]
    const compiled = compileSection({ sourceHtml, sourceCss, slots, scopeSelector: sectionScopeSelector(slug)! })
    expect(compiled.blocking).toEqual([])
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const definition = (
      await client.query(
        'SELECT * FROM app.save_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
        [
          slug,
          'Imported link fixture',
          'Tests',
          sourceHtml,
          sourceCss,
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Imported link fixture',
          false,
          'legacy',
          null,
          null,
          'site',
          site,
          0,
          null,
        ],
      )
    ).rows[0]!.section_def_id
    pageId = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, 'Imported link review']))
      .rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        {
          section_def_id: definition,
          section_def_version: 1,
          label: 'Hero',
          hidden: false,
          hidden_at: [],
          values: { title: 'Human Needs Index', dest: { url: '#overview' }, words: 'Learn More' },
        },
      ]),
      '{}',
    ])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
  await signIn(page, 'root@example.test')
  await page.goto(`/pages/${pageId}`)
  return pageId
}

test('an imported link’s words and destination are edited together under its name', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const pageId = await fixture(page)
  await canvas(page).getByText('Learn More', { exact: true }).click()
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  const group = inspector.getByRole('group', { name: 'Home overview link' })
  await expect(group).toBeVisible()
  await expect(group).toHaveAttribute('data-selected', 'true')
  await expect(group.getByLabel('Words people click', { exact: true })).toHaveValue('Learn More')
  await group.getByLabel('Words people click', { exact: true }).fill('Read the overview')
  await expect(canvas(page).getByText('Read the overview', { exact: true })).toBeVisible()
  await group.getByRole('button', { name: 'Change', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Change link', exact: true })
  await expect(settings.getByLabel('Address', { exact: true })).toHaveValue('#overview')
  // The split fields are not listed again on their own.
  await expect(inspector.getByText('Home overview link · label', { exact: true })).toHaveCount(0)
  await expect(inspector.getByText('Edit the link’s words directly on the page or in its text fields.')).toHaveCount(0)

  await settings.getByLabel('Address', { exact: true }).fill('/about#overview')
  await expect(savedState(page)).toHaveText('All changes saved')
  const client = await database()
  try {
    await expect
      .poll(
        async () =>
          (
            await client.query(
              'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
              [pageId],
            )
          ).rows[0]!.content[0].values,
      )
      .toEqual({ title: 'Human Needs Index', dest: { url: '/about#overview' }, words: 'Read the overview' })
  } finally {
    await client.end()
  }
  await expect(canvas(page).locator('a.pill')).toHaveAttribute('href', '/about#overview')
  await settings.getByRole('button', { name: 'Done', exact: true }).click()
  // Selecting the title moves the highlight off the link group.
  await canvas(page).getByText('Human Needs Index', { exact: true }).click()
  await expect(group).toHaveCount(0)
  await expect(inspector.getByRole('heading', { name: 'Section title', exact: true })).toBeVisible()
})
