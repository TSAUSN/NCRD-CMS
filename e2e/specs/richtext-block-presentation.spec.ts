import { expect, test, type Locator, type Page } from '@playwright/test'
import { Client } from 'pg'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { e2eTarget } from '../test-target.ts'
import { canvas, clickAtTextEnd, savedState, signIn } from './helpers.ts'

// EDIT-02 / V1 reference 06: styled source paragraphs are one rich-text field
// whose definition fixes their classes and style. The page, the canvas while
// typing and the stored value must agree: presentation on screen, canonical
// rich text in the draft.
const PRESENTATION = { class: 'lead-copy', style: 'letter-spacing: 0.05em;' }

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
    const slug = `presented-copy-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const sourceHtml = '<section><div class="copy">{{body}}</div></section>'
    const sourceCss =
      'section{padding:24px}.lead-copy{color:rgb(10, 80, 40);font:18px/1.6 Georgia,serif;margin:0 0 12px}'
    const slots = [
      { id: 'body', label: 'Story', kind: 'richtext' as const, constraints: { blockAttributes: { p: PRESENTATION } } },
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
          'Presented copy fixture',
          'Tests',
          sourceHtml,
          sourceCss,
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Block presentation fixture',
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
    pageId = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, 'Presented copy review']))
      .rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        {
          section_def_id: definition,
          section_def_version: 1,
          label: 'Story',
          hidden: false,
          hidden_at: [],
          values: { body: '<p>First paragraph.</p><p>Second <strong>paragraph</strong>.</p>' },
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

async function draftBody(pageId: string): Promise<string> {
  const client = await database()
  try {
    return (
      await client.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [pageId],
      )
    ).rows[0]!.content[0].values.body
  } finally {
    await client.end()
  }
}

async function expectPresented(paragraphs: Locator, count: number) {
  await expect(paragraphs).toHaveCount(count)
  for (let index = 0; index < count; index += 1) {
    await expect(paragraphs.nth(index)).toHaveAttribute('class', PRESENTATION.class)
    await expect(paragraphs.nth(index)).toHaveCSS('color', 'rgb(10, 80, 40)')
  }
}

test('one rich-text field keeps its definition’s paragraph presentation on the page, while typing on the canvas and after saving', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const pageId = await fixture(page)
  const body = canvas(page).locator('[data-cms-slot="body"][data-cms-kind="richtext"]')
  const paragraphs = body.locator('p')
  await expectPresented(paragraphs, 2)
  await expect(paragraphs.first()).toHaveCSS('letter-spacing', '0.9px')

  // First click selects the field, the second opens the editor where it lands.
  await body.click()
  await clickAtTextEnd(paragraphs.nth(1))
  await expect(body).toHaveAttribute('contenteditable', 'true')
  // A letter-spaced period can own the final click pixel in WebKit. Use the
  // normal end-of-line key before splitting, keeping all stored-text checks.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Third paragraph')
  // A paragraph made while typing looks like the others immediately.
  await expectPresented(paragraphs, 3)
  await expect(paragraphs.nth(2)).toHaveText('Third paragraph')

  // The draft stores canonical rich text; the definition carries the look.
  await expect(savedState(page)).toHaveText('All changes saved')
  await expect
    .poll(() => draftBody(pageId))
    .toBe('<p>First paragraph.</p><p>Second <strong>paragraph</strong>.</p><p>Third paragraph</p>')

  await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
  await expect(body).not.toHaveAttribute('contenteditable', 'true')
  await expectPresented(paragraphs, 3)

  await page.reload()
  await expectPresented(canvas(page).locator('[data-cms-slot="body"][data-cms-kind="richtext"] p'), 3)
  expect(errors).toEqual([])
})
