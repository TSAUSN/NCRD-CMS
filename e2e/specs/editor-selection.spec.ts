import { expect, test, type Locator, type Page } from '@playwright/test'
import { Client } from 'pg'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { e2eTarget } from '../test-target.ts'
import { canvas, savedState, saveDraft, signIn } from './helpers.ts'

// Real command-created pages and definitions, isolated from the shared home
// page. Repeated fields intentionally bind both occurrences to one value.
async function fixture(page: Page) {
  const { database, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  await client.connect()
  let pageId = ''
  try {
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const slug = `selection-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const sourceHtml =
      '<section><h2>{{heading}}</h2><div>{{body}}</div><div class="second-copy"><h2>{{heading}}</h2><div>{{body}}</div></div></section>'
    const sourceCss = 'section{padding:24px}h2{font:24px/1.5 Arial;margin:12px 0}.second-copy{margin-top:80px}'
    const slots = [
      { id: 'heading', label: 'Heading', kind: 'text' as const, constraints: {} },
      { id: 'body', label: 'Body', kind: 'richtext' as const, constraints: {} },
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
          'Repeated field selection fixture',
          'Tests',
          sourceHtml,
          sourceCss,
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Selection regression fixture',
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
    pageId = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, 'Precise selection review']))
      .rows[0]!.id
    const sections = ['First instance', 'Second instance'].map((label, index) => ({
      section_def_id: definition,
      section_def_version: 1,
      label,
      hidden: false,
      hidden_at: [],
      values: {
        heading: index ? 'Independent other heading' : 'Alpha beta gamma',
        body: `<p>${index ? 'Other' : 'Shared'} <strong>formatted</strong> content</p>`,
      },
    }))
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [pageId, JSON.stringify(sections), '{}'])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
  await signIn(page, 'root@example.test')
  await page.goto(`/pages/${pageId}`)
  await expect(canvas(page).locator('[data-cms-section="0"] [data-cms-slot="heading"]').first()).toHaveText(
    'Alpha beta gamma',
  )
}

async function showPage(page: Page) {
  const tab = page.getByRole('tab', { name: 'Page', exact: true })
  if (await tab.isVisible()) await tab.click()
}

/** Convert a real text boundary to screen coordinates, including CSS-scaled
 * visitor previews. The click still goes through the browser's pointer path. */
async function clickAtTextOffset(page: Page, field: Locator, offset: number) {
  await field.scrollIntoViewIfNeeded()
  const point = await field.evaluate((node, index) => {
    const range = document.createRange()
    range.setStart(node.firstChild!, index)
    range.collapse(true)
    const rect = range.getBoundingClientRect()
    return { x: rect.x, y: rect.y + rect.height / 2, width: document.documentElement.clientWidth }
  }, offset)
  const frame = (await page.locator('iframe[title="Page canvas"]').boundingBox())!
  const scale = frame.width / point.width
  await page.mouse.click(frame.x + point.x * scale, frame.y + point.y * scale)
}

for (const width of [1280, 1024])
  test(`plain-text caret honors the clicked boundary and preserves native selection at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await fixture(page)
    await showPage(page)
    // Exercise the real 1280px visitor viewport, scaled inside the CMS pane.
    await page.getByRole('button', { name: 'Desktop', exact: true }).click()
    const fields = canvas(page).locator('[data-cms-section="0"] [data-cms-slot="heading"]')
    const field = fields.first()
    await field.click()
    await showPage(page)
    await clickAtTextOffset(page, field, 5)
    await expect(field).toHaveAttribute('contenteditable', 'plaintext-only')
    await page.keyboard.insertText('!')
    await expect(fields).toHaveText(['Alpha! beta gamma', 'Alpha! beta gamma'])
    await field.press('ArrowLeft')
    await field.press('ControlOrMeta+Shift+ArrowLeft')
    // A native selection exists before another pointer click. It must not be
    // forcibly collapsed by the preview runtime's capture listener.
    await field.evaluate(node => {
      const range = document.createRange()
      range.setStart(node.firstChild!, 0)
      range.setEnd(node.firstChild!, 5)
      const selection = document.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(await field.evaluate(() => document.getSelection()?.toString())).toBe('Alpha')
    await page.keyboard.insertText('Start')
    await expect(fields).toHaveText(['Start! beta gamma', 'Start! beta gamma'])
    await field.press('ControlOrMeta+z')
    await expect(fields).toHaveText(['Alpha! beta gamma', 'Alpha! beta gamma'])
    await field.press('Escape')
    await showPage(page)
    await expect(field).not.toHaveAttribute('contenteditable')
    await field.focus()
    await field.press('Enter')
    await expect(field).toBeVisible()
    await expect(field).toHaveAttribute('contenteditable', 'plaintext-only')
    await page.keyboard.insertText('!')
    await expect(fields).toHaveText(['Alpha! beta gamma!', 'Alpha! beta gamma!'])
    await saveDraft(page)
    await expect(savedState(page)).toHaveText('All changes saved')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await showPage(page)
    await expect(fields).toHaveText(['Alpha! beta gamma!', 'Alpha! beta gamma!'])
    await expect(savedState(page)).toHaveText('All changes saved')
  })

test('repeated rich-text selection stays on the clicked copy and follows its instance through move and undo', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await fixture(page)
  const bodies = canvas(page).locator('[data-cms-section="0"] [data-cms-slot="body"]')
  await bodies.nth(1).click()
  await expect(bodies.nth(1)).toHaveAttribute('data-cms-selected', '')
  await expect(bodies.first()).not.toHaveAttribute('data-cms-selected')
  await bodies.nth(1).click()
  await expect(bodies.nth(1)).toHaveAttribute('data-cms-inline-editing', '')
  await bodies.nth(1).press('ControlOrMeta+A')
  await page.keyboard.insertText('Changed through the second copy')
  await expect(bodies).toHaveText(['Changed through the second copy', 'Changed through the second copy'])
  await expect(
    page.getByRole('complementary', { name: 'Inspector' }).getByRole('textbox', { name: /^Body(?: Changed)?$/ }),
  ).toHaveText('Changed through the second copy')
  await expect(canvas(page).locator('[data-cms-section="1"] [data-cms-slot="body"]').first()).toHaveText(
    'Other formatted content',
  )
  await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
  await page.getByRole('button', { name: 'Actions for First instance', exact: true }).click()
  await page.getByRole('button', { name: 'Move First instance down', exact: true }).click()
  await expect(canvas(page).locator('[data-cms-section="1"] [data-cms-slot="body"]')).toHaveText([
    'Changed through the second copy',
    'Changed through the second copy',
  ])
  await expect(canvas(page).locator('[data-cms-section="1"][data-cms-selected]')).toBeAttached()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(bodies).toHaveText(['Changed through the second copy', 'Changed through the second copy'])
  const tree = page.getByRole('complementary', { name: 'Page structure' })
  await tree.getByRole('button', { name: 'Heading', exact: true }).first().click()
  await expect(canvas(page).locator('[data-cms-section="0"] [data-cms-slot="heading"]').first()).toHaveAttribute(
    'data-cms-selected',
    '',
  )
  await expect(bodies.nth(1)).not.toHaveAttribute('data-cms-selected')
  await saveDraft(page)
  await page.reload()
  await expect(bodies).toHaveText(['Changed through the second copy', 'Changed through the second copy'])
})
