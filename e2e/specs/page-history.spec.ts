import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'
import { READINESS_POLICY_VERSION } from '../../packages/domain/src/readiness.ts'
import { e2eTarget } from '../test-target.ts'
import {
  canvas,
  clickOnCanvas,
  fetchPublic,
  publish,
  saveDraft,
  savedState,
  signIn,
  treeLabels,
  typeInInspector,
} from './helpers.ts'

async function openHistory(page: Page) {
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled()
  await expect(page.getByRole('status', { name: 'Browser recovery status', exact: true })).not.toHaveText(
    /Keeping copy…|Checking…/,
  )
  const history = page
    .getByRole('button', { name: 'History', exact: true })
    .or(page.getByRole('link', { name: /^(?:Page history|History)$/ }))
    .filter({ visible: true })
    .first()
  if (!(await history.isVisible())) await page.getByLabel('More page actions', { exact: true }).click()
  await history.click()
  const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
  await expect
    .poll(async () => new URL(page.url()).pathname.endsWith('/history') || (await leave.isVisible()))
    .toBe(true)
  if (await leave.isVisible()) await leave.getByRole('button', { name: 'Keep draft and leave', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Page history', exact: true })).toBeVisible()
}

async function openSeededPage(page: import('@playwright/test').Page) {
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo site')
  await page.getByRole('link', { name: 'A page served by cms-v2', exact: true }).click()
  await expect(canvas(page).locator('h1')).toBeVisible()
}

test.describe('page history and restore', () => {
  let originalPage: { id: string; content: unknown; meta: unknown } | undefined
  const connection = () => {
    const t = e2eTarget()
    return new Client({ connectionString: `postgres://cms:cms@${t.host}:${t.port}/${t.database}` })
  }
  test.beforeEach(async () => {
    originalPage = undefined
    const db = connection()
    await db.connect()
    try {
      originalPage = (
        await db.query(
          "SELECT p.id,v.content,v.meta FROM pages p JOIN sites s ON s.id=p.site_id JOIN page_versions v ON v.id=p.draft_version_id WHERE s.slug='demo' AND p.slug='' AND p.archived_at IS NULL",
        )
      ).rows[0]
      expect(originalPage).toBeDefined()
    } finally {
      await db.end()
    }
  })
  test.afterEach(async ({ page }, info) => {
    if (!originalPage) return
    if (info.status !== info.expectedStatus && !page.isClosed())
      await page.screenshot({ path: info.outputPath('history-failure-before-restoration.png') }).catch(() => {})
    // Close the editing client before restoring, so a late autosave cannot dirty the shared fixture again.
    await page.close()
    const db = connection()
    await db.connect()
    try {
      await db.query('BEGIN')
      const actor = (await db.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0].id
      await db.query("SELECT set_config('app.user_id',$1,true)", [actor])
      const head = (await db.query('SELECT revision FROM pages WHERE id=$1 FOR UPDATE', [originalPage.id])).rows[0]
      const restored = (
        await db.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
          originalPage.id,
          head.revision,
          JSON.stringify(originalPage.content),
          JSON.stringify(originalPage.meta),
          'checkpoint',
          'Restore shared history fixture',
        ])
      ).rows[0]
      await db.query("SELECT app.publish_page($1,$2,$3,NULL,'[]')", [
        originalPage.id,
        restored.revision,
        READINESS_POLICY_VERSION,
      ])
      const current = (
        await db.query(
          'SELECT d.content,d.meta,l.content AS live_content FROM pages p JOIN page_versions d ON d.id=p.draft_version_id JOIN page_versions l ON l.id=p.published_version_id WHERE p.id=$1',
          [originalPage.id],
        )
      ).rows[0]
      expect(current.content).toEqual(originalPage.content)
      expect(current.meta).toEqual(originalPage.meta)
      expect(current.live_content).toEqual(originalPage.content)
      await db.query('COMMIT')
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    } finally {
      await db.end()
    }
  })

  test('previews immutable versions and restores one without changing the live page', async ({ page }) => {
    await signIn(page, 'editor@example.test')
    await openSeededPage(page)
    await clickOnCanvas(page, 'heading')
    const original = await page.locator('#slot-0-heading').inputValue()
    await publish(page)

    // Leave one routine autosave behind so the default filter is proved rather
    // than merely asserted by the button copy.
    await typeInInspector(page, 0, 'heading', `Automatic noise ${Date.now()}`)
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })

    const olderHeading = `History older ${Date.now()}`
    await typeInInspector(page, 0, 'heading', olderHeading)
    await saveDraft(page)

    const liveHeading = `History live ${Date.now()}`
    await typeInInspector(page, 0, 'heading', liveHeading)
    await saveDraft(page)
    await publish(page)

    const currentHeading = `History current ${Date.now()}`
    await typeInInspector(page, 0, 'heading', currentHeading)
    await saveDraft(page)

    await openHistory(page)
    await expect(page.getByRole('heading', { name: 'Page history' })).toBeVisible()
    const versions = page.getByRole('complementary', { name: 'Versions' }).locator('li > a')
    const withoutAutomatic = await versions.count()
    expect(withoutAutomatic).toBeGreaterThanOrEqual(3)
    await expect(page.getByText('Automatic save', { exact: true })).toHaveCount(0)

    const previewElement = page.locator('iframe[title^="Preview of version"]')
    const preview = page.frameLocator('iframe[title^="Preview of version"]')
    await expect(previewElement).toHaveAttribute('sandbox', 'allow-same-origin')
    await expect(preview.getByRole('heading', { name: currentHeading })).toBeVisible()
    await expect(preview.locator('[data-cms-slot]')).toHaveCount(0)
    await expect(preview.locator('script')).toHaveCount(0)

    const previewSrc = await previewElement.getAttribute('src')
    const previewCsp = await page.evaluate(async src => {
      const response = await fetch(src, { credentials: 'same-origin' })
      return response.headers.get('content-security-policy')
    }, previewSrc!)
    expect(previewCsp).toContain("form-action 'none'")

    // A hostile or accidental cursor stays a normal newest-page request. It
    // never becomes Infinity and reaches PostgreSQL as an invalid bigint.
    const oversizedCursorStatus = await page.evaluate(
      async url => (await fetch(url, { credentials: 'same-origin' })).status,
      `${page.url().split('?')[0]}?before=${'9'.repeat(200)}`,
    )
    expect(oversizedCursorStatus).toBe(200)

    // Current draft, current live, then the saved draft we want. Changing the
    // autosave filter must not throw away an intentional selection.
    await versions.nth(2).click()
    await expect(preview.getByRole('heading', { name: olderHeading })).toBeVisible()

    await page.getByRole('link', { name: 'Show automatic saves' }).click()
    await expect(page.getByText('Automatic save', { exact: true }).first()).toBeVisible()
    await expect(preview.getByRole('heading', { name: olderHeading })).toBeVisible()
    await page.getByRole('link', { name: 'Hide automatic saves' }).click()
    await expect(versions).toHaveCount(withoutAutomatic)
    await expect(page.getByText('Automatic save', { exact: true })).toHaveCount(0)
    await expect(preview.getByRole('heading', { name: olderHeading })).toBeVisible()

    await page.getByRole('button', { name: 'Restore as new draft' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Create a new draft from this version?' })
    await expect(confirm.getByText('The live page will not change.')).toBeVisible()
    await confirm.getByRole('button', { name: 'Create draft' }).click()

    await expect(page.getByRole('complementary', { name: 'Page structure' })).toBeVisible()
    await expect(canvas(page).getByRole('heading', { name: olderHeading })).toBeVisible()
    await expect(page.getByText('Changes not live', { exact: true })).toBeVisible()
    const live = await fetchPublic()
    expect(live.body).toContain(liveHeading)
    expect(live.body).not.toContain(olderHeading)

    // The draft displaced by restore is still an immutable version we can
    // inspect. Restore never turned history into an undo buffer.
    await openHistory(page)
    const afterRestore = page.getByRole('complementary', { name: 'Versions' }).locator('li > a')
    await afterRestore.nth(1).click()
    await expect(preview.getByRole('heading', { name: currentHeading })).toBeVisible()

    // Phones get save status and a larger-screen notice, not editing controls
    // (decision of November 4). The separate screen remains usable from the
    // compact editor toolbar on a tablet.
    await page.getByRole('link', { name: 'Back to editor' }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByText('Use a larger screen to edit.', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(page.getByLabel('More page actions', { exact: true })).toBeVisible()
    await openHistory(page)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true)

    // Leave the shared seeded page in its documented state for later specs.
    await page.getByRole('link', { name: 'Back to editor' }).click()
    await clickOnCanvas(page, 'heading')
    await typeInInspector(page, 0, 'heading', original)
    await publish(page)
  })

  test('keeps approved raw forms and top navigation inert in historical evidence', async ({ page }) => {
    await signIn(page, 'root@example.test')
    await openSeededPage(page)
    await treeLabels(page).filter({ hasText: 'Call to action' }).click()
    await page.getByRole('tab', { name: 'Advanced', exact: true }).click()
    await page.getByText('Edit the HTML of this section').click()
    await page.getByLabel('Section HTML').fill(`
      <form action="/history-sandbox-target" method="get">
        <button type="submit">Submit history form</button>
      </form>
      <a href="/history-sandbox-target" target="_top">Leave history</a>
    `)
    await saveDraft(page)
    await page.getByRole('button', { name: 'Approve this code…' }).click()
    await expect(page.getByText('You have approved the custom code on this draft.')).toBeVisible()

    const escaped: string[] = []
    page.on('request', request => {
      if (request.url().includes('/history-sandbox-target')) escaped.push(request.url())
    })

    await openHistory(page)
    await expect(page).toHaveURL(/\/pages\/[^/]+\/history$/)
    const topBefore = page.url()
    const previewElement = page.locator('iframe[title^="Preview of version"]')
    const preview = page.frameLocator('iframe[title^="Preview of version"]')
    await expect(previewElement).toHaveAttribute('sandbox', 'allow-same-origin')
    await preview.getByRole('button', { name: 'Submit history form' }).click()
    await preview.getByRole('link', { name: 'Leave history' }).click()
    await page.waitForTimeout(250)
    expect(page.url()).toBe(topBefore)
    expect(escaped).toEqual([])

    // Restore the shared fixture to normal section rendering and publication.
    await page.getByRole('link', { name: 'Back to editor' }).click()
    await treeLabels(page).filter({ hasText: 'Call to action' }).click()
    await page.getByRole('tab', { name: 'Advanced', exact: true }).click()
    await page.getByText('Edit the HTML of this section').click()
    await page.getByLabel('Section HTML').fill('')
    await saveDraft(page)
    await publish(page)
  })
})
