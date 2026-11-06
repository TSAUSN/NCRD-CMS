import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { e2eTarget } from '../test-target.ts'
import { canvas, signIn } from './helpers.ts'

// A selected field that wraps across lines is framed as one box (V1 reference
// 04), not as one outline per line fragment.
async function fixture(page: Page) {
  const { database, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  await client.connect()
  let pageId = ''
  try {
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const slug = `wrapped-title-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const sourceHtml = '<section><h2 class="narrow">{{title}}</h2><p>{{note}}</p></section>'
    const sourceCss = 'section{padding:24px}.narrow{width:150px;font:32px/1.2 Georgia,serif;margin:0 0 16px}'
    const slots = [
      { id: 'title', label: 'Title', kind: 'text' as const, constraints: {} },
      { id: 'note', label: 'Note', kind: 'text' as const, constraints: {} },
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
          'Wrapped title fixture',
          'Tests',
          sourceHtml,
          sourceCss,
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Selection frame fixture',
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
    pageId = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, 'Wrapped title review']))
      .rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        {
          section_def_id: definition,
          section_def_version: 1,
          label: 'Title band',
          hidden: false,
          hidden_at: [],
          values: { title: 'Human Needs Index', note: 'One short line.' },
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
}

const union = (rects: { left: number; top: number; right: number; bottom: number }[]) => ({
  left: Math.min(...rects.map(rect => rect.left)),
  top: Math.min(...rects.map(rect => rect.top)),
  right: Math.max(...rects.map(rect => rect.right)),
  bottom: Math.max(...rects.map(rect => rect.bottom)),
})

test('a selected field that wraps is framed as one box that follows typing, and a one-line field keeps its own outline', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await fixture(page)
  const title = canvas(page).locator('[data-cms-slot="title"]')
  const frame = canvas(page).locator('cms-selection-frame')
  await title.click()
  await expect(title).toHaveAttribute('data-cms-multiline', '')
  await expect(title).toHaveCSS('outline-style', 'none')
  await expect(frame).toHaveCount(1)
  const geometry = async () =>
    title.evaluate(node => {
      const rects = [...node.getClientRects()]
        .filter(rect => rect.width > 0 && rect.height > 0)
        .map(rect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }))
      const box = node.ownerDocument.querySelector('cms-selection-frame')!.getBoundingClientRect()
      return {
        lines: rects.length,
        rects,
        frame: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      }
    })
  const first = await geometry()
  expect(first.lines).toBeGreaterThanOrEqual(2)
  for (const [key, value] of Object.entries(union(first.rects)))
    expect(Math.abs(first.frame[key as keyof typeof first.frame] - value)).toBeLessThan(1.5)

  // Typing in place grows the field by a line; the frame follows it.
  await title.click()
  await expect(title).toHaveAttribute('contenteditable', 'plaintext-only')
  await page.keyboard.press('End')
  await page.keyboard.type(' for the whole country')
  await expect.poll(async () => (await geometry()).lines).toBeGreaterThan(first.lines)
  const grown = await geometry()
  for (const [key, value] of Object.entries(union(grown.rects)))
    expect(Math.abs(grown.frame[key as keyof typeof grown.frame] - value)).toBeLessThan(1.5)

  // A field on one line has no frame; its own outline shows the selection.
  await page.keyboard.press('Escape')
  const note = canvas(page).locator('[data-cms-slot="note"]')
  await note.click()
  await expect(frame).toHaveCount(0)
  await expect(note).not.toHaveAttribute('data-cms-multiline', '')
  await expect(note).toHaveCSS('outline-style', 'solid')
})
