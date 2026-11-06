import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'
import { e2eTarget } from '../test-target.ts'
import { canvas, savedState, signIn, treeLabels } from './helpers.ts'

// The private editor label for a section (SPEC §6.4, V1 reference 09): named in
// the page structure and on the canvas, saved with the draft, undoable, and
// never part of what visitors receive.
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
    const user = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const hero = (await client.query("SELECT id FROM section_defs WHERE slug='hero' AND scope='global'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [user])
    pageId = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [
        site,
        `label-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        'Section label review',
      ])
    ).rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        {
          section_def_id: hero,
          section_def_version: 1,
          values: { heading: 'Opening words', intro: 'An introduction' },
          label: '',
          hidden: false,
          hidden_at: [],
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

async function draftLabel(pageId: string) {
  const client = await database()
  try {
    return (
      await client.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [pageId],
      )
    ).rows[0]!.content[0].label
  } finally {
    await client.end()
  }
}

test('names a section privately in the structure and on the canvas, saves it, and undoes it', async ({ page }) => {
  const pageId = await fixture(page)
  await canvas(page).getByText('Opening words', { exact: true }).click()
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
  await inspector.getByRole('button', { name: 'Back', exact: true }).click()
  await inspector.getByRole('tab', { name: 'Advanced', exact: true }).click()
  const label = page
    .getByRole('complementary', { name: 'Inspector' })
    .getByLabel('Section name (only editors see this)', { exact: true })
  await expect(label).toHaveValue('')
  await expect(label).toHaveAttribute('placeholder', 'Hero — Opening words')
  await label.fill('Spring appeal opener')
  await expect(treeLabels(page).filter({ hasText: 'Spring appeal opener' })).toHaveCount(1)
  await expect(
    page
      .getByRole('complementary', { name: 'Inspector' })
      .getByRole('heading', { name: 'Spring appeal opener', level: 2 }),
  ).toBeVisible()
  await treeLabels(page).first().click()
  await expect(canvas(page).locator('[data-cms-section="0"]')).toHaveAttribute('data-cms-label', 'Spring appeal opener')
  await expect(savedState(page)).toHaveText('All changes saved')
  await expect.poll(() => draftLabel(pageId)).toBe('Spring appeal opener')

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await treeLabels(page).first().click()
  await inspector.getByRole('tab', { name: 'Advanced', exact: true }).click()
  await expect(label).toHaveValue('')
  // Unlabelled, the section is named after its layout, as in the structure.
  await expect(canvas(page).locator('[data-cms-section="0"]')).toHaveAttribute('data-cms-label', 'Hero — Opening words')
  await expect.poll(() => draftLabel(pageId)).toBe('')
  await expect(treeLabels(page).filter({ hasText: 'Spring appeal opener' })).toHaveCount(0)
})
