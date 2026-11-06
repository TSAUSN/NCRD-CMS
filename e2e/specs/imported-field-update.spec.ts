import { createHash } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { e2eTarget } from '../test-target.ts'
import { canvas, savedState, signIn } from './helpers.ts'

// EDIT-02 for content imported before cohesive rich text: a super admin moves an
// imported section to the current field mapping. The page looks the same; the
// split paragraphs become one formatted field, and Undo restores them.
const PRESENTED = 'class="lead" style="font-family: var(--font-secondary);"'
const A = `v1-${'a'.repeat(24)}`,
  B = `v1-${'b'.repeat(24)}`

async function database() {
  const { database: name, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${name}` })
  await client.connect()
  return client
}

async function fixture() {
  const client = await database()
  try {
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const slug = `v1-work-overview-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const sourceHtml = `<section class="overview"><div class="space-y-4" data-block-id="overview-body" data-editable="richtext"><p ${PRESENTED}>{{${A}}}</p>\n<p ${PRESENTED}>{{${B}}}</p></div></section>`
    const sourceCss = '.overview{padding:24px}.lead{color:rgb(20, 60, 90);font:18px/1.6 Georgia,serif}'
    const slots = [
      { id: A, kind: 'text' as const, label: 'Overview body · part 1', constraints: {} },
      { id: B, kind: 'text' as const, label: 'Overview body · part 2', constraints: {} },
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
          'Home — Overview',
          'Migrated V1 content',
          sourceHtml,
          sourceCss,
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Imported before cohesive rich text',
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
    const pageId = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, 'Imported overview review'])
    ).rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        {
          section_def_id: definition,
          section_def_version: 1,
          label: 'Overview',
          hidden: false,
          hidden_at: [],
          values: {
            [A]: 'The Human Needs Index was developed.',
            [B]: 'Unlike traditional measures, it draws on service data.',
          },
        },
      ]),
      '{}',
    ])
    await client.query('COMMIT')
    return { pageId: pageId as string, definition: definition as string }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

async function draftSection(pageId: string) {
  const client = await database()
  try {
    return (
      await client.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [pageId],
      )
    ).rows[0]!.content[0]
  } finally {
    await client.end()
  }
}

const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' })

test('a super admin joins an imported section’s split paragraphs into one formatted field, and Undo restores them', async ({
  page,
}) => {
  const { pageId } = await fixture()
  await signIn(page, 'root@example.test')
  await page.goto(`/pages/${pageId}`)
  const paragraphs = canvas(page).locator('.lead')
  await expect(paragraphs).toHaveCount(2)
  await paragraphs.first().click()
  await expect(inspector(page).getByText('Overview body · part 1', { exact: true })).toBeVisible()
  await inspector(page).getByRole('tab', { name: 'Advanced', exact: true }).click()
  await inspector(page).getByRole('button', { name: 'Update imported fields', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'Update imported fields' })
  await expect(dialog.getByRole('cell').first()).toContainText('Overview body · part 1')
  await expect(dialog.getByRole('cell').nth(1)).toContainText('Overview body')
  await expect(dialog.getByRole('cell').nth(1)).toContainText('Formatted text')
  const preview = dialog.frameLocator('iframe[title="Page with the updated imported fields"]')
  await expect(preview.locator('.lead')).toHaveCount(2)
  await dialog.getByRole('button', { name: 'Update fields in draft' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Fields updated in the draft.' })).toBeVisible()

  // The same two paragraphs, now one formatted field with their styling.
  const body = canvas(page).locator('[data-cms-kind="richtext"]')
  await expect(body.locator('p.lead')).toHaveCount(2)
  await expect(body.locator('p.lead').first()).toHaveCSS('color', 'rgb(20, 60, 90)')
  await expect(savedState(page)).toHaveText('All changes saved')
  const updated = await draftSection(pageId)
  expect(updated.section_def_version).toBe(2)
  expect(Object.values(updated.values)).toEqual([
    '<p>The Human Needs Index was developed.</p>\n<p>Unlike traditional measures, it draws on service data.</p>',
  ])
  await inspector(page).getByRole('tab', { name: 'Content', exact: true }).click()
  await expect(inspector(page).getByText('Overview body', { exact: true })).toBeVisible()

  // Undo is an ordinary edit back to the earlier fields, and autosaves.
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await draftSection(pageId)).section_def_version).toBe(1)
  await expect(canvas(page).locator('[data-cms-kind="richtext"]')).toHaveCount(0)
  await expect(paragraphs).toHaveCount(2)
})

test('an editor is not offered the update', async ({ page }) => {
  const { pageId } = await fixture()
  await signIn(page, 'editor@example.test')
  await page.goto(`/pages/${pageId}`)
  await canvas(page).locator('.lead').first().click()
  await expect(inspector(page).getByText('Overview body · part 1', { exact: true })).toBeVisible()
  await expect(inspector(page).getByRole('button', { name: 'Update imported fields', exact: true })).toHaveCount(0)
})

// The importer's identity for a run of words is its element path, never its
// name, so an earlier import's numbered fields keep their ids when renamed.
const runId = (path: string) => `v1-${createHash('sha256').update(path).digest('hex').slice(0, 24)}`

/** An imported definition and a page using it, as an earlier importer left them. */
async function importedSubtitle(
  sourceHtml: string,
  slots: { id: string; kind: 'text'; label: string; constraints: Record<string, never> }[],
  values: Record<string, string>,
) {
  const client = await database()
  try {
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const slug = `v1-work-subtitle-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const sourceCss = '.subtitle{font-size:20px}.red{color:rgb(200, 16, 46);font-style:normal}'
    const compiled = compileSection({ sourceHtml, sourceCss, slots, scopeSelector: sectionScopeSelector(slug)! })
    expect(compiled.blocking).toEqual([])
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const definition = (
      await client.query(
        'SELECT * FROM app.save_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
        [
          slug,
          'Hero — Freeform',
          'Migrated V1 content',
          sourceHtml,
          sourceCss,
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Imported with numbered fields',
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
    const pageId = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, 'Imported subtitle review'])
    ).rows[0]!.id as string
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        { section_def_id: definition, section_def_version: 1, label: 'Hero', hidden: false, hidden_at: [], values },
      ]),
      '{}',
    ])
    await client.query('COMMIT')
    return pageId
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

test('a super admin gives an imported section’s numbered fields clearer names, keeping their words and the page', async ({
  page,
}) => {
  // Words and a styled span (not an emphasis mark), which stay two fields.
  const WORDS = runId('root/0/text/0'),
    SPAN = runId('root/0/1/text/0')
  const pageId = await importedSubtitle(
    `<p class="subtitle" data-block-id="hero-subtitle" data-editable="text">{{${WORDS}}}<span class="red">{{${SPAN}}}</span></p>`,
    [
      { id: WORDS, kind: 'text', label: 'Hero subtitle · part 1', constraints: {} },
      { id: SPAN, kind: 'text', label: 'Hero subtitle · part 2', constraints: {} },
    ],
    { [WORDS]: 'Discover more about how we help ', [SPAN]: 'love beyond hardship' },
  )

  await signIn(page, 'root@example.test')
  await page.goto(`/pages/${pageId}`)
  await canvas(page).locator('span.red').click()
  await expect(inspector(page).getByText('Hero subtitle · part 2', { exact: true })).toBeVisible()
  await inspector(page).getByRole('tab', { name: 'Advanced', exact: true }).click()
  await inspector(page).getByRole('button', { name: 'Update imported fields', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Update imported fields' })
  const renames = dialog.getByRole('table', { name: 'Fields that get a clearer name, keeping their content' })
  await expect(renames.getByRole('row')).toHaveCount(3)
  await expect(renames.getByRole('row').nth(1)).toHaveText('Hero subtitle · part 1Hero subtitle')
  await expect(renames.getByRole('row').nth(2)).toHaveText('Hero subtitle · part 2Hero subtitle · text')
  await expect(dialog.getByRole('columnheader', { name: 'Fields now' })).toHaveCount(0)
  await expect(
    dialog.getByText('Every field keeps its content; only the names in the page structure and inspector change.'),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Update fields in draft' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Fields updated in the draft.' })).toBeVisible()
  await inspector(page).getByRole('tab', { name: 'Content', exact: true }).click()
  await expect(inspector(page).getByText('Hero subtitle · text', { exact: true })).toBeVisible()
  await expect(canvas(page).locator('span.red')).toHaveText('love beyond hardship')
  await expect(canvas(page).locator('span.red')).toHaveCSS('color', 'rgb(200, 16, 46)')
  await expect(savedState(page)).toHaveText('All changes saved')
  const updated = await draftSection(pageId)
  expect(updated.section_def_version).toBe(2)
  expect(updated.values).toEqual({ [WORDS]: 'Discover more about how we help ', [SPAN]: 'love beyond hardship' })
})

test('a super admin joins a subtitle split around its red emphasis into one field, as V1 edits it', async ({
  page,
}) => {
  const WORDS = runId('root/0/text/0'),
    EMPHASIS = runId('root/0/2/text/0')
  const pageId = await importedSubtitle(
    `<p class="subtitle" data-block-id="hero-subtitle" data-editable="text">{{${WORDS}}}<br><em class="red">{{${EMPHASIS}}}</em></p>`,
    [
      { id: WORDS, kind: 'text', label: 'Hero subtitle', constraints: {} },
      { id: EMPHASIS, kind: 'text', label: 'Hero subtitle · emphasis', constraints: {} },
    ],
    { [WORDS]: 'Discover more about how we help', [EMPHASIS]: 'love beyond hardship' },
  )

  await signIn(page, 'root@example.test')
  await page.goto(`/pages/${pageId}`)
  await canvas(page).locator('em.red').click()
  await inspector(page).getByRole('tab', { name: 'Advanced', exact: true }).click()
  await inspector(page).getByRole('button', { name: 'Update imported fields', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Update imported fields' })
  const fields = dialog.locator('table.imported-update-fields').first()
  await expect(fields.getByRole('columnheader', { name: 'Fields now' })).toBeVisible()
  await expect(fields.locator('td').first()).toContainText('Hero subtitle')
  await expect(fields.locator('td').first()).toContainText('Hero subtitle · emphasis')
  await expect(fields.locator('td').nth(1)).toHaveText(/^Hero subtitle\s*Formatted text$/)
  await dialog.getByRole('button', { name: 'Update fields in draft' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Fields updated in the draft.' })).toBeVisible()
  // One field, edited with the reduced inline toolbar; the page is unchanged.
  await canvas(page).locator('em.red').click()
  await expect(inspector(page).getByRole('textbox', { name: 'Hero subtitle' })).toBeVisible()
  await expect(inspector(page).getByLabel('Text style')).toHaveCount(0)
  await expect(canvas(page).locator('em.red')).toHaveText('love beyond hardship')
  await expect(canvas(page).locator('em.red')).toHaveCSS('color', 'rgb(200, 16, 46)')
  await expect(canvas(page).locator('p.subtitle p')).toHaveCount(0)
  await expect(savedState(page)).toHaveText('All changes saved')
  const updated = await draftSection(pageId)
  expect(updated.section_def_version).toBe(2)
  expect(Object.values(updated.values)).toEqual(['Discover more about how we help<br><em>love beyond hardship</em>'])
})
