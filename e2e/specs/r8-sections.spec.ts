import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { signIn } from './helpers.ts'
import { rawRequest } from './http.ts'
import { sectionsFixture } from './fixtures/r8-sections.ts'
const folder = resolve('../.r8-progress/step-4/sections')
async function capture(page: Page, name: string) {
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await expect
      .poll(() =>
        page.locator('.section-live-preview-scroll iframe').evaluateAll(frames =>
          frames.every(frame => {
            const box = frame.getBoundingClientRect(),
              parent = frame.closest('.section-live-preview-scroll')!.getBoundingClientRect()
            return box.right <= parent.right + 1 && box.left >= parent.left - 1
          }),
        ),
      )
      .toBe(true)
    await page.screenshot({ path: resolve(folder, `${name}-${width}.png`), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const dialog = page.getByRole('dialog')
    if (await dialog.count()) await expect(dialog.getByRole('button', { name: /Close/ }).first()).toBeInViewport()
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
test('Sections shares the library cards, previews three sizes and updates chosen drafts after review', async ({
  page,
}) => {
  test.setTimeout(120000)
  const f = await sectionsFixture(),
    errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await signIn(page, 'root@example.test')
    await page.goto(`/sites/${f.site}/sections?source=site`)
    const card = page.locator('.library-card').filter({ has: page.getByRole('heading', { name: f.name, exact: true }) })
    await expect(card).toBeVisible()
    await expect(card).toContainText('Used on 2 pages')
    await capture(page, 'site-section-grid')
    await page.getByLabel('Find a section', { exact: true }).fill('There is no such section')
    await expect(page.getByRole('heading', { name: 'No sections match these filters', exact: true })).toBeVisible()
    await capture(page, 'empty-section-search')
    await page.getByRole('link', { name: 'Show all sections', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Event hero', exact: true })).toBeVisible()
    await capture(page, 'core-library-grid')
    await page.getByLabel('Source', { exact: true }).selectOption('site')
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: `Preview ${f.name}`, exact: true }).click()
    const modal = page.getByRole('dialog', { name: `Preview ${f.name}`, exact: true })
    await expect(
      modal.frameLocator('iframe').getByRole('heading', { name: 'Welcome, everyone', exact: true }),
    ).toBeVisible()
    await expect(modal.frameLocator('iframe').locator('header,footer')).toHaveCount(0)
    await capture(page, 'section-preview-desktop')
    await modal.getByRole('button', { name: 'Phone', exact: true }).click()
    await expect(modal.locator('iframe')).toHaveCSS('width', '390px')
    await capture(page, 'section-preview-phone')
    await modal.getByRole('button', { name: 'Close preview', exact: true }).click()
    await card.getByRole('link', { name: `Details ${f.name}`, exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Editable fields', exact: true })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Section versions', exact: true })).toContainText('Version 2 · Latest')
    await expect(page.getByRole('list', { name: 'Section versions', exact: true })).toContainText('Version 1')
    await expect(page.getByRole('heading', { name: 'Used on 2 pages', exact: true })).toBeVisible()
    const detail = page.frameLocator('iframe')
    await expect(detail.getByRole('heading', { name: 'Welcome, everyone', exact: true })).toBeVisible()
    let release!: () => void
    const hold = new Promise<void>(resolve => {
      release = resolve
    })
    await page.route('**/sections/*/preview?**', async route => {
      await hold
      await route.fulfill({ status: 503, body: 'Unavailable' })
    })
    await page.reload()
    await expect(page.getByRole('status').filter({ hasText: 'Loading preview…' })).toBeVisible()
    await capture(page, 'section-detail-loading')
    release()
    await expect(page.getByRole('heading', { name: 'Preview unavailable', exact: true })).toBeVisible()
    await capture(page, 'section-detail-error')
    await page.unroute('**/sections/*/preview?**')
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(detail.getByRole('heading', { name: 'Welcome, everyone', exact: true })).toBeVisible()
    await capture(page, 'section-detail-desktop')
    await page.getByRole('button', { name: 'Tablet', exact: true }).click()
    await expect(page.locator('iframe')).toHaveCSS('width', '768px')
    await capture(page, 'section-detail-tablet')
    await page.getByRole('button', { name: 'Phone', exact: true }).click()
    await expect(page.locator('iframe')).toHaveCSS('width', '390px')
    await capture(page, 'section-detail-phone')
    const live = (await rawRequest({ host: f.host, path: '/' })).body
    await page.getByRole('link', { name: 'Update pages that use it', exact: true }).click()
    await expect(
      page.getByRole('list', { name: 'Pages with an older section version', exact: true }).getByRole('listitem'),
    ).toHaveCount(2)
    await capture(page, 'update-page-list')
    const row = page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: /Welcome/ }) })
    await row.getByRole('button', { name: 'View changes to Welcome', exact: true }).click()
    const comparison = page.getByRole('dialog', { name: 'Changes to Welcome', exact: true })
    await expect(
      comparison.frameLocator('iframe[title="Current draft"]').getByText('Keep these original words.', { exact: true }),
    ).toBeVisible()
    await expect(
      comparison.frameLocator('iframe[title="With this update"]').getByText('More welcoming spaces', { exact: true }),
    ).toBeVisible()
    await expect(comparison).toContainText('New fields to fill: A new optional welcome')
    await capture(page, 'update-comparison-desktop')
    await comparison.getByRole('button', { name: 'Phone', exact: true }).click()
    await expect(comparison.locator('iframe').first()).toHaveCSS('width', '390px')
    await capture(page, 'update-comparison-phone')
    await comparison.getByRole('button', { name: 'Done', exact: true }).click()
    await row.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Update selected', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: 'Update saved page drafts?', exact: true })
    await capture(page, 'update-confirmation')
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      page.getByRole('list', { name: 'Pages with an older section version' }).getByRole('listitem'),
    ).toHaveCount(2)
    await page.getByRole('button', { name: 'Update selected', exact: true }).click()
    await confirm.getByRole('button', { name: 'Update 1 page', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Updated 1 page draft.' })).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Pages with an older section version' }).getByRole('listitem'),
    ).toHaveCount(1)
    await capture(page, 'selected-page-updated')
    expect((await rawRequest({ host: f.host, path: '/' })).body).toBe(live)
    const heads = (
      await f.pool.query(
        'SELECT p.id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=ANY($1::uuid[])',
        [f.pages],
      )
    ).rows
    expect(heads.find(row => row.id === f.pages[0])!.content[0].section_def_version).toBe(2)
    expect(heads.find(row => row.id === f.pages[1])!.content[0].section_def_version).toBe(1)
    await page.getByRole('button', { name: 'Select all', exact: true }).click()
    await page.getByRole('button', { name: 'Update all', exact: true }).click()
    await confirm.getByRole('button', { name: 'Update 1 page', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'All current drafts are up to date', exact: true })).toBeVisible()
    await capture(page, 'all-drafts-updated')
    expect((await rawRequest({ host: f.host, path: '/' })).body).toBe(live)
    expect(errors).toEqual([])
  } finally {
    await f.pool.end()
  }
})
test('section update review refuses a concurrent change and Editors cannot enter the admin update flow', async ({
  page,
}) => {
  test.setTimeout(60000)
  const f = await sectionsFixture()
  try {
    await signIn(page, 'root@example.test')
    await page.goto(`/sites/${f.site}/sections/${f.definition}/update`)
    const row = page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: /Welcome/ }) })
    await row.getByRole('checkbox').check()
    async function changeAfterReview() {
      const client = await f.pool.connect()
      try {
        await client.query('BEGIN')
        const actor = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
        await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
        const head = (
          await client.query(
            'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
            [f.pages[0]],
          )
        ).rows[0]!
        await client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
          f.pages[0],
          head.revision,
          JSON.stringify(head.content),
          JSON.stringify({ ...head.meta, description: 'Changed after opening the page list.' }),
        ])
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    }
    await changeAfterReview()
    await row.getByRole('button', { name: 'View changes to Welcome', exact: true }).click()
    const comparison = page.getByRole('dialog', { name: 'Changes to Welcome', exact: true })
    await expect(comparison.getByRole('alert')).toContainText('A page changed after this review')
    await capture(page, 'stale-update-preview')
    await expect(comparison.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
    await comparison.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Update selected', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Refresh page list', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Refresh page list', exact: true })).toBeEnabled()
    await expect(row.getByRole('checkbox')).not.toBeChecked()
    await row.getByRole('checkbox').check()
    await changeAfterReview()
    await page.getByRole('button', { name: 'Update selected', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Update 1 page', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('A page changed after this review')
    await expect(page.getByRole('main').getByRole('alert')).toBeFocused()
    await expect(page.getByRole('main').getByRole('alert')).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Update selected', exact: true })).toBeDisabled()
    await capture(page, 'stale-update-save')
    expect(
      (
        await f.pool.query(
          'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.pages[0]],
        )
      ).rows[0]!.content[0].section_def_version,
    ).toBe(1)
    await page.getByRole('button', { name: 'Refresh page list', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Refresh page list', exact: true })).toBeEnabled()
    await expect(page.getByRole('checkbox', { name: /Welcome/ })).not.toBeChecked()
    await page.context().clearCookies()
    await signIn(page, 'editor@example.test')
    await page.goto(`/sites/${f.site}/sections/${f.definition}`)
    await expect(page.getByRole('heading', { name: f.name, exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Update pages that use it', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Edit section', exact: true })).toHaveCount(0)
    const refused = await page.goto(`/sites/${f.site}/sections/${f.definition}/update`)
    expect(refused?.status()).toBe(404)
  } finally {
    await f.pool.end()
  }
})

test('both section creators offer the reviewed page-update flow after saving an existing section', async ({ page }) => {
  test.setTimeout(90000)
  const f = await sectionsFixture()
  try {
    await signIn(page, 'root@example.test')
    await page.goto(`/sites/${f.site}/sections/${f.definition}/edit`)
    await page.getByRole('textbox', { name: 'What changed?', exact: true }).fill('Review an existing welcome section')
    await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await page.getByRole('button', { name: 'Save this section', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Section saved', exact: true })).toBeVisible()
    await capture(page, 'source-section-saved')
    await expect(page.getByRole('link', { name: 'Update pages that use it', exact: true })).toHaveAttribute(
      'href',
      `/sites/${f.site}/sections/${f.definition}/update`,
    )
    await page.goto(`/sites/${f.site}/sections/new`)
    const name = 'A friendly visual welcome'
    await page.getByLabel('Section name', { exact: true }).fill(name)
    await page.locator('#section-change-note').fill('Create a welcome')
    await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await page.getByRole('button', { name: 'Save this section', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Section saved', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Back to sections', exact: true }).click()
    await page.getByRole('link', { name: `Details ${name}`, exact: true }).click()
    await expect(page).toHaveURL(/\/sections\/[0-9a-f-]+$/)
    const detailUrl = page.url()
    await page.getByRole('link', { name: 'Edit section', exact: true }).click()
    await page.locator('#section-change-note').fill('Refine the welcome')
    await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await page.getByRole('button', { name: 'Save new section version', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Section saved', exact: true })).toBeVisible()
    await capture(page, 'visual-section-saved')
    await expect(page.getByRole('link', { name: 'Update pages that use it', exact: true })).toHaveAttribute(
      'href',
      new URL(detailUrl).pathname + '/update',
    )
    await page.getByRole('link', { name: 'Update pages that use it', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'All current drafts are up to date', exact: true })).toBeVisible()
  } finally {
    await f.pool.end()
  }
})
