import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { e2eTarget } from '../test-target.ts'
import { canvas, clickAtTextEnd, fetchPublic, publish, savedState, signIn } from './helpers.ts'

// EDIT-02: words with a styled emphasis inside a paragraph are one inline
// field, as V1 edits HNI's hero subtitle (“… shows those in need<br><em
// class="red">love beyond hardship</em>”). The paragraph stays the
// definition's; the field holds words and marks only, Enter breaks the line,
// and the definition draws the emphasis red while typing and on the page.
const RED = 'rgb(200, 16, 46)'

async function database() {
  const { database: name, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${name}` })
  await client.connect()
  return client
}

async function fixture(page: Page) {
  const client = await database()
  let pageId = '',
    slug = ''
  try {
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    slug = `inline-subtitle-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const sourceHtml = '<section><h1>Hero</h1><p class="lede">{{subtitle}}</p></section>'
    const sourceCss =
      'section{padding:24px}.lede{font:20px/1.5 Georgia,serif;color:rgb(20, 20, 20);max-width:520px}.red{color:rgb(200, 16, 46);font-style:normal;font-weight:700}'
    const slots = [
      {
        id: 'subtitle',
        label: 'Hero subtitle',
        kind: 'richtext' as const,
        constraints: { inline: true, inlineAttributes: { em: { class: 'red' } } },
      },
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
          'Inline subtitle fixture',
          'Tests',
          sourceHtml,
          sourceCss,
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Inline field fixture',
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
    pageId = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, 'Inline subtitle review']))
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
          values: { subtitle: 'Discover more<br><em>love beyond hardship</em>' },
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
  return { pageId, slug }
}

async function draftSubtitle(pageId: string): Promise<string> {
  const client = await database()
  try {
    return (
      await client.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [pageId],
      )
    ).rows[0]!.content[0].values.subtitle
  } finally {
    await client.end()
  }
}

test('an inline field edits words and their red emphasis inside the page’s own paragraph', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const { pageId, slug } = await fixture(page)
  const lede = canvas(page).locator('p.lede')
  const field = lede.locator('[data-cms-slot="subtitle"][data-cms-kind="richtext"]')
  const emphasis = field.locator('em')
  await expect(emphasis).toHaveAttribute('class', 'red')
  await expect(emphasis).toHaveCSS('color', RED)

  // First click selects the field; the second opens it where it lands, inline.
  await field.click()
  await clickAtTextEnd(emphasis)
  await expect(field).toHaveAttribute('contenteditable', 'true')
  await expect(field).toHaveAttribute('data-cms-inline-field', '')
  await expect(field).toHaveCSS('display', 'inline')
  // Only marks and links are offered: an inline field has no blocks or lists.
  const tools = page.getByRole('toolbar', { name: 'Canvas rich text formatting' })
  await expect(tools.getByRole('button', { name: 'Italic' })).toBeVisible()
  await expect(tools.getByLabel('Text style')).toHaveCount(0)
  await expect(tools.getByRole('button', { name: 'Bulleted list' })).toHaveCount(0)

  await page.keyboard.type(' today')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Join us')
  // Still one paragraph of the definition's, with a line break, and the
  // emphasis drawn red while typing.
  await expect(lede.locator('p, div, li')).toHaveCount(0)
  await expect(field.locator('br')).toHaveCount(2)
  await expect(field.locator('em').first()).toHaveAttribute('class', 'red')
  await expect(field.locator('em').first()).toContainText('love beyond hardship today')

  await expect(savedState(page)).toHaveText('All changes saved')
  const stored = await draftSubtitle(pageId)
  // The emphasis carries on across the new line, as in any editor; the break
  // itself sits between the two emphasized runs.
  expect(stored).toBe('Discover more<br><em>love beyond hardship today</em><br><em>Join us</em>')

  await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
  await expect(field).not.toHaveAttribute('contenteditable', 'true')
  await expect(field.locator('em').first()).toHaveCSS('color', RED)

  // The inspector edits the same field with the same reduced toolbar, and
  // the page follows it.
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  const box = inspector.getByRole('textbox', { name: 'Hero subtitle' })
  await expect(box).toBeVisible()
  await expect(inspector.getByLabel('Text style')).toHaveCount(0)
  await box.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Plain words')
  await expect(field).toHaveText('Plain words')
  await expect(savedState(page)).toHaveText('All changes saved')
  await expect.poll(() => draftSubtitle(pageId)).toBe('Plain words')

  // Published, the page has exactly the definition's paragraph around the words.
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Discover more ')
  await inspector.getByRole('button', { name: 'Italic' }).click()
  await page.keyboard.type('love')
  await expect(savedState(page)).toHaveText('All changes saved')
  await publish(page)
  const live = await fetchPublic(`/${slug}`)
  expect(live.body).toContain('<p class="lede">Discover more <em class="red">love</em></p>')
  expect(errors).toEqual([])
})
