import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { e2eTarget } from '../test-target.ts'
import { canvas, savedState, signIn } from './helpers.ts'

async function database() {
  const target = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${target.host}:${target.port}/${target.database}` })
  await client.connect()
  return client
}
type Draft = { content: { section_def_id: string; label?: string; values: Record<string, unknown> }[] }
async function draft(pageId: string): Promise<Draft> {
  const client = await database()
  try {
    return (
      await client.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [pageId],
      )
    ).rows[0]!
  } finally {
    await client.end()
  }
}
async function fixture(page: Page) {
  const client = await database()
  const name = `Layout change ${Date.now()}-${Math.floor(Math.random() * 10000)}`
  let pageId = '',
    hero = '',
    cta = ''
  try {
    const user = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    hero = (await client.query("SELECT id FROM section_defs WHERE slug='hero' AND scope='global'")).rows[0]!.id
    cta = (await client.query("SELECT id FROM section_defs WHERE slug='cta' AND scope='global'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [user])
    pageId = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [
        site,
        `layout-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        name,
      ])
    ).rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        {
          section_def_id: hero,
          section_def_version: 1,
          values: { heading: 'Spring appeal heading', intro: 'Keep this introduction' },
          label: 'Spring appeal',
          hidden: false,
          hidden_at: [],
        },
        {
          section_def_id: hero,
          section_def_version: 1,
          values: { heading: 'Untouched section', intro: 'Nothing here changes' },
          label: 'Closing',
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
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/pages/${pageId}$`))
  return { pageId, hero, cta }
}
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' })

test('changes one section to a different layout with an explicit mapping, then undoes and redoes it through ordinary saving', async ({
  page,
}, testInfo) => {
  const { pageId, hero, cta } = await fixture(page)
  await page
    .getByRole('complementary', { name: 'Page structure' })
    .getByRole('button', { name: 'Spring appeal', exact: true })
    .click()
  await expect(inspector(page).getByRole('heading', { name: 'Spring appeal', level: 2 })).toBeVisible()
  await inspector(page).getByRole('tab', { name: 'Style', exact: true }).click()
  await inspector(page)
    .getByRole('button', { name: /^Layout:/ })
    .click()

  const shelf = page.getByRole('dialog', { name: 'Choose a layout', exact: true })
  await expect(shelf.getByRole('heading', { name: 'Choose a layout', exact: true })).toBeVisible()
  await shelf.getByRole('button', { name: 'Show other layouts', exact: true }).click()
  await expect(shelf.getByTestId('library-card-hero')).toHaveCount(0)
  const shelfShot = testInfo.outputPath('layout-change-shelf.png')
  await page.screenshot({ path: shelfShot })
  await testInfo.attach('Change layout shelf', { path: shelfShot, contentType: 'image/png' })
  await shelf.getByRole('button', { name: 'Review Call to action', exact: true }).click()

  const review = page.getByRole('dialog', { name: 'Change layout', exact: true })
  await expect(review.getByText('“Spring appeal” will use the', { exact: false })).toBeVisible()
  await expect(review.getByLabel('Heading', { exact: true })).toHaveValue('heading')
  await expect(review.getByText('Not carried over: Intro.', { exact: false })).toBeVisible()
  const proposed = review.frameLocator('iframe[title="Proposed section layout in the page"]')
  await expect(proposed.getByText('Spring appeal heading', { exact: true })).toBeVisible()
  await expect(proposed.getByText('Untouched section', { exact: true })).toBeVisible()

  // Changing a choice refreshes the exact preview before it can be applied.
  await review.getByLabel('Heading', { exact: true }).selectOption('intro')
  await expect(proposed.getByText('Keep this introduction', { exact: true })).toBeVisible()
  await expect(review.getByText('Not carried over: Heading.', { exact: false })).toBeVisible()
  await expect(review.getByRole('button', { name: 'Apply to draft' })).toBeEnabled()
  const reviewShot = testInfo.outputPath('layout-change-review.png')
  await page.screenshot({ path: reviewShot })
  await testInfo.attach('Change layout review', { path: reviewShot, contentType: 'image/png' })
  await review.getByRole('button', { name: 'Apply to draft' }).click()

  await expect(review).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Layout changed in the draft.' })).toBeVisible()
  await expect(savedState(page)).toHaveText('All changes saved')
  await expect(inspector(page).getByRole('button', { name: 'Layout: Call to action', exact: true })).toBeVisible()
  await expect(canvas(page).getByText('Keep this introduction', { exact: true })).toBeVisible()
  await expect(canvas(page).getByText('Untouched section', { exact: true })).toBeVisible()
  const changed = await draft(pageId)
  expect(changed.content[0]).toMatchObject({
    section_def_id: cta,
    label: 'Spring appeal',
    values: { heading: 'Keep this introduction' },
  })
  expect(changed.content[0]!.values).not.toHaveProperty('intro')
  expect(changed.content[1]).toMatchObject({
    section_def_id: hero,
    label: 'Closing',
    values: { heading: 'Untouched section', intro: 'Nothing here changes' },
  })
  const client = await database()
  try {
    const kept = (
      await client.query(
        "SELECT content FROM page_versions WHERE page_id=$1 AND kind='checkpoint' AND note LIKE 'Before changing the layout%'",
        [pageId],
      )
    ).rows
    expect(kept).toHaveLength(1)
    expect(kept[0]!.content[0]).toMatchObject({
      section_def_id: hero,
      values: { heading: 'Spring appeal heading', intro: 'Keep this introduction' },
    })
  } finally {
    await client.end()
  }

  // Undo is an ordinary edit: the previous layout returns with its values and autosaves.
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(inspector(page).getByRole('button', { name: 'Layout: Hero', exact: true })).toBeVisible()
  await inspector(page).getByRole('tab', { name: 'Content', exact: true }).click()
  await expect(page.locator('#slot-0-intro')).toHaveValue('Keep this introduction')
  await inspector(page).getByRole('tab', { name: 'Style', exact: true }).click()
  await expect.poll(async () => (await draft(pageId)).content[0]?.section_def_id).toBe(hero)
  await expect(savedState(page)).toHaveText('All changes saved')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(inspector(page).getByRole('button', { name: 'Layout: Call to action', exact: true })).toBeVisible()
  await expect.poll(async () => (await draft(pageId)).content[0]?.section_def_id).toBe(cta)
  await expect(savedState(page)).toHaveText('All changes saved')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page
    .getByRole('complementary', { name: 'Page structure' })
    .getByRole('button', { name: 'Spring appeal', exact: true })
    .click()
  await inspector(page).getByRole('tab', { name: 'Style', exact: true }).click()
  await expect(inspector(page).getByRole('button', { name: 'Layout: Call to action', exact: true })).toBeVisible()
  await inspector(page).getByRole('tab', { name: 'Content', exact: true }).click()
  await expect(page.locator('#slot-0-heading')).toHaveValue('Keep this introduction')
})

test('cancels a layout change without saving anything, keeps keyboard focus and opens both previews at the section', async ({
  page,
}) => {
  const { pageId } = await fixture(page)
  const before = await draft(pageId)
  await page
    .getByRole('complementary', { name: 'Page structure' })
    .getByRole('button', { name: 'Closing', exact: true })
    .click()
  await expect(inspector(page).getByRole('heading', { name: 'Closing', level: 2 })).toBeVisible()
  await inspector(page).getByRole('tab', { name: 'Style', exact: true }).click()
  await inspector(page)
    .getByRole('button', { name: /^Layout:/ })
    .click()
  const shelf = page.getByRole('dialog', { name: 'Choose a layout', exact: true })
  await shelf.getByRole('button', { name: 'Show other layouts', exact: true }).click()
  await shelf.getByRole('button', { name: 'Review Text block', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Change layout', exact: true })
  await expect(review.getByLabel('Heading', { exact: true })).toHaveValue('heading')
  await expect(review.getByLabel('Story', { exact: true })).toHaveValue('')
  // Each preview scrolls as far toward the second section as the page allows,
  // instead of opening at the site header.
  for (const title of ['Current section layout in the page', 'Proposed section layout in the page']) {
    await expect
      .poll(() =>
        review
          .frameLocator(`iframe[title="${title}"]`)
          .locator('#s1')
          .evaluate(node => {
            const view = node.ownerDocument.defaultView!,
              root = node.ownerDocument.scrollingElement!
            const target = Math.min(
              node.getBoundingClientRect().top + view.scrollY,
              root.scrollHeight - view.innerHeight,
            )
            return view.scrollY > 0 && Math.abs(view.scrollY - target) <= 1
          }),
      )
      .toBe(true)
  }
  await expect(review.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  const folder = resolve('../.r8-progress/echelon/acceptance/layout-dialog')
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await expect(review.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await page.screenshot({ path: resolve(folder, 'focused-' + width + '.png') })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(review).toHaveCount(0)
  await expect(savedState(page)).toHaveText('All changes saved')
  expect(await draft(pageId)).toEqual(before)
})
