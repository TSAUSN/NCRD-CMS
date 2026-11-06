import { expect, test } from '@playwright/test'
import { Client } from 'pg'
import { canvas, clickOnCanvas, fetchPublic, openSeededPage, saveDraft, signIn, typeInInspector } from './helpers.ts'

const ORIGINAL_HEADING = 'A page served by cms-v2'
const DB = process.env['E2E_DATABASE'] ?? 'cms_e2e'
const HOST = process.env['E2E_PG_HOST'] ?? '127.0.0.1'
const PORT = process.env['E2E_PG_PORT'] ?? '54329'
const DATABASE_URL = `postgres://cms:cms@${HOST}:${PORT}/${DB}`

async function seedSubmittedPage(label: string, trusted = false, samples = false) {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    const identities = await client.query<{
      editor_id: string
      contributor_id: string
      super_admin_id: string
      site_id: string
      definition_id: string
      definition_version: string
    }>(`
      SELECT
        (SELECT id FROM app_users WHERE email = 'editor@example.test') AS editor_id,
        (SELECT id FROM app_users WHERE email = 'contributor@example.test') AS contributor_id,
        (SELECT id FROM app_users WHERE email = 'root@example.test') AS super_admin_id,
        (SELECT id FROM sites WHERE slug = 'demo') AS site_id,
        (SELECT id FROM section_defs WHERE slug = 'hero' AND scope = 'global') AS definition_id,
        (SELECT max(v.version) FROM section_def_versions v
          JOIN section_defs d ON d.id = v.section_def_id
         WHERE d.slug = 'hero' AND d.scope = 'global') AS definition_version
    `)
    const ids = identities.rows[0]!
    await client.query('SET LOCAL ROLE cms_authenticated_user')
    await client.query("SELECT set_config('app.user_id',$1,true)", [ids.editor_id])
    const slug = `review-${label.toLowerCase()}-${Date.now()}`
    const created = await client.query<{ page_id: string }>('SELECT app.create_page($1,$2,$3) AS page_id', [
      ids.site_id,
      slug,
      `Review ${label}`,
    ])
    const pageId = created.rows[0]!.page_id
    await client.query("SELECT set_config('app.user_id',$1,true)", [trusted ? ids.super_admin_id : ids.contributor_id])
    const content = [
      {
        section_def_id: ids.definition_id,
        section_def_version: Number(ids.definition_version),
        values: {
          heading: `Review ${label}`,
          intro: 'Evidence for the review workbench.',
          ...(samples ? { __cms_sample_fields: ['intro'] } : {}),
        },
        ...(trusted ? { raw_html: '<p>Governed review fixture</p>' } : {}),
      },
    ]
    const saved = await client.query<{ revision: string }>('SELECT revision FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify(content),
      '{}',
    ])
    await client.query("SELECT set_config('app.user_id',$1,true)", [ids.contributor_id])
    const submitted = await client.query<{ submission_id: string }>(
      'SELECT submission_id FROM app.submit_page_for_review($1,$2,$3)',
      [pageId, saved.rows[0]!.revision, `${label} is ready for review.`],
    )
    await client.query('COMMIT')
    return { submissionId: submitted.rows[0]!.submission_id, title: `Review ${label}`, path: `/${slug}` }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

/**
 * The product proof for review crosses both roles and all three surfaces:
 * contributor editor -> reviewer inbox -> public site. The database suite owns
 * the adversarial races; this test owns the promise a person can actually use.
 */
test.describe('page review journey', () => {
  test('returns useful feedback, then approves and publishes the exact resubmission', async ({ browser }) => {
    const authorContext = await browser.newContext()
    const reviewerContext = await browser.newContext()
    const author = await authorContext.newPage()
    const reviewer = await reviewerContext.newPage()
    const heading = `Reviewed in the inbox ${Date.now()}`

    try {
      await signIn(author, 'contributor@example.test')
      await openSeededPage(author)
      await expect(author.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
      await clickOnCanvas(author, 'heading')
      await typeInInspector(author, 0, 'heading', heading)
      await saveDraft(author)

      await author.getByRole('button', { name: 'Submit for review' }).click()
      const submission = author.getByRole('dialog', { name: 'Submit this page for review?' })
      await submission.getByLabel('Note for the reviewer').fill('Please check the new homepage heading.')
      await submission.getByRole('button', { name: 'Submit for review' }).click()
      await expect(author.getByText('Submitted for review. The live site has not changed.')).toBeVisible()
      await expect(author.locator('.editor-bar [data-status="review"]')).toHaveText('In review')
      expect((await fetchPublic()).body).not.toContain(heading)

      await signIn(reviewer, 'editor@example.test')
      await reviewer.getByRole('link', { name: 'Reviews', exact: true }).click()
      await expect(reviewer.getByRole('heading', { name: 'Reviews', level: 1 })).toBeVisible()
      await expect(reviewer.getByRole('link', { name: /A page served by cms-v2/ })).toBeVisible()
      await expect(reviewer.getByText('Please check the new homepage heading.')).toBeVisible()
      await expect(reviewer.getByText('No issues found')).toBeVisible()

      await reviewer.getByRole('tab', { name: 'Preview', exact: true }).click()
      const evidence = reviewer.frameLocator('iframe[title^="Submitted version of"]')
      await expect(evidence.locator('h1')).toHaveText(heading)

      await reviewer.getByRole('button', { name: 'Return with feedback' }).click()
      const returned = reviewer.getByRole('dialog', { name: 'Return this page for changes?' })
      await returned
        .getByLabel('What should change?')
        .fill('Please make the heading more specific before it goes live.')
      await returned.getByRole('button', { name: 'Return with feedback' }).click()
      await expect(reviewer.getByText(/Returned .* with clear feedback/)).toBeVisible()
      expect((await fetchPublic()).body).not.toContain(heading)

      await author.reload()
      await expect(author.getByText('Changes requested.')).toBeVisible()
      await expect(author.getByText('Please make the heading more specific before it goes live.')).toBeVisible()
      await expect(author.getByRole('button', { name: 'Submit for review' })).toBeEnabled()

      await author.getByRole('button', { name: 'Submit for review' }).click()
      const resubmission = author.getByRole('dialog', { name: 'Submit this page for review?' })
      await resubmission.getByLabel('Note for the reviewer').fill('Updated and ready for the final decision.')
      await resubmission.getByRole('button', { name: 'Submit for review' }).click()
      await expect(author.getByText('Submitted for review. The live site has not changed.')).toBeVisible()

      await reviewer.reload()
      await expect(reviewer.getByText('Updated and ready for the final decision.')).toBeVisible()
      await reviewer.getByRole('button', { name: 'Approve and publish' }).click()
      const confirm = reviewer.getByRole('alertdialog', { name: 'Approve and publish this version?' })
      await expect(confirm.getByText(/Only the saved changes you reviewed are published/)).toBeVisible()
      await confirm.getByRole('button', { name: 'Approve and publish' }).click()
      // The decision produces both a state chip and a notice; assert the
      // notice, which names the page the action just published.
      await expect(reviewer.getByText(/Approved and published “/)).toBeVisible()
      expect((await fetchPublic()).body).toContain(heading)

      // This suite shares one seeded page. Leave both its draft and public
      // projection in the documented state for the later renderer specs.
      await reviewer.goto('/')
      await openSeededPage(reviewer)
      await clickOnCanvas(reviewer, 'heading')
      await typeInInspector(reviewer, 0, 'heading', ORIGINAL_HEADING)
      await saveDraft(reviewer)
      await reviewer.getByRole('button', { name: 'Publish', exact: true }).click()
      await reviewer
        .getByRole('dialog', { name: 'Publish this page', exact: true })
        .getByRole('button', { name: 'Publish', exact: true })
        .click()
      await expect(reviewer.getByText('Published. The live page now shows these changes.')).toBeVisible()
      await expect(canvas(reviewer).locator('h1')).toHaveText(ORIGINAL_HEADING)
      expect((await fetchPublic()).body).toContain(ORIGINAL_HEADING)
    } finally {
      await authorContext.close()
      await reviewerContext.close()
    }
  })

  test('the review workbench remains usable at tablet authoring width', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await signIn(page, 'editor@example.test')
    await page.goto('/inbox')
    await expect(page.getByRole('heading', { name: 'Reviews', level: 1 })).toBeVisible()
    const reviews = page.getByRole('region', { name: 'Page reviews', exact: true })
    await expect(reviews.locator('.review-board')).toBeVisible()
    await expect(reviews.locator('.review-queue')).toBeVisible()
    await expect(reviews.locator('.review-detail')).toBeVisible()
  })

  test('switching requests clears item-specific draft state', async ({ page }) => {
    const first = await seedSubmittedPage('Alpha')
    const second = await seedSubmittedPage('Bravo')
    await signIn(page, 'editor@example.test')
    await page.goto(`/inbox?review=${first.submissionId}`)
    await page.getByRole('tab', { name: /^Discussion/ }).click()
    await page.getByLabel('Add a comment').fill('This belongs only to Alpha.')
    await page.getByRole('button', { name: '@Demo Contributor' }).click()

    await page.getByRole('link', { name: new RegExp(second.title) }).click()
    await page
      .getByRole('alertdialog', { name: 'Before you leave' })
      .getByRole('button', { name: 'Discard changes', exact: true })
      .click()
    await expect(page.getByRole('heading', { name: second.title, level: 2 })).toBeVisible()
    await page.getByRole('tab', { name: /^Discussion/ }).click()
    await expect(page.getByLabel('Add a comment')).toHaveValue('')
    await expect(page.getByRole('button', { name: '@Demo Contributor' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('ordinary editors are not offered super-admin approval for governed code', async ({ browser }) => {
    const request = await seedSubmittedPage('Governed', true)
    const editorContext = await browser.newContext()
    const rootContext = await browser.newContext()
    const editor = await editorContext.newPage()
    const root = await rootContext.newPage()
    try {
      await signIn(editor, 'editor@example.test')
      await editor.goto(`/inbox?review=${request.submissionId}`)
      await expect(
        editor.getByText('A Super admin needs to approve this change before it can be published.'),
      ).toBeVisible()
      await expect(editor.getByRole('button', { name: 'Super-admin approval required' })).toHaveCount(0)
      await expect(editor.getByRole('button', { name: 'Return with feedback' })).toBeEnabled()
      await expect(editor.getByRole('button', { name: 'Approve and publish' })).toHaveCount(0)

      await signIn(root, 'root@example.test')
      await root.goto(`/inbox?review=${request.submissionId}`)
      await expect(root.getByRole('button', { name: 'Approve and publish' })).toBeEnabled()
    } finally {
      await editorContext.close()
      await rootContext.close()
    }
  })
})

test('review approval requires explicit sample-content confirmation', async ({ page }) => {
  const { mkdir } = await import('node:fs/promises'),
    { resolve } = await import('node:path')
  const submitted = await seedSubmittedPage('Samples', false, true)
  await signIn(page, 'editor@example.test')
  await page.goto(`/inbox?review=${submitted.submissionId}`)
  const reviewFolder = resolve('../.r8-progress/admin-reviews')
  await mkdir(reviewFolder, { recursive: true })
  await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('body')).toBeVisible()
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await page.evaluate(
      () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
    )
    await page.screenshot({ path: resolve(reviewFolder, 'review-' + width + '.png') })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  expect((await fetchPublic(submitted.path)).status).toBe(404)
  await page.getByRole('button', { name: 'Approve and publish', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Approve and publish', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Publish with sample content?', exact: true })
  await expect(confirmation).toBeVisible()
  await expect(confirmation.getByRole('listitem')).toContainText('sample content')
  expect((await fetchPublic(submitted.path)).status).toBe(404)
  const folder = resolve('../.r8-progress/step-2/templates')
  await mkdir(folder, { recursive: true })
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(size)
    await page.screenshot({ path: resolve(folder, `review-sample-consent-${size.width}.png`), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await confirmation.getByRole('button', { name: 'Publish with sample content', exact: true }).click()
  await expect(page.getByText(`Approved and published “${submitted.title}”.`, { exact: true })).toBeVisible()
  const live = await fetchPublic(submitted.path)
  expect(live.status).toBe(200)
  expect(live.body).toContain('Evidence for the review workbench.')
})
