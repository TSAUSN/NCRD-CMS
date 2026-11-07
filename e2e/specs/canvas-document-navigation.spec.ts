import { expect, test, type Locator, type Page, type Request } from '@playwright/test'
import { canvas, signIn } from './helpers.ts'
import { sawsoFixture } from './fixtures/sawso.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../packages/platform/src/local/index.ts'
import { registerReviewedSiteFile } from '../../packages/platform/src/site-files.ts'

async function openCanvasDestination(page: Page, link: Locator) {
  const href = await link.getAttribute('href')
  expect(href).toBeTruthy()
  const dest = new URL(href!, page.url())
  const kinds: string[] = []
  const capture = (request: Request) => {
    const url = new URL(request.url())
    if (url.origin === dest.origin && url.pathname === dest.pathname && request.method() === 'GET') {
      kinds.push(request.resourceType() === 'document' ? 'document' : request.headers()['rsc'] ? 'rsc' : 'other')
    }
  }
  const from = page.url()
  page.on('request', capture)
  try {
    await link.hover()
    await link.click()
    await expect(page).toHaveURL(dest.href)
    await expect(page.locator('iframe').first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType('navigation')[0]?.name)).toBe(dest.href)
    expect(kinds).toEqual(['document'])
    await page.goBack()
    await expect(page).toHaveURL(from)
  } finally {
    page.off('request', capture)
  }
}

test('opens editor and site look links with one document and no RSC request, and keeps Back working', async ({
  page,
}) => {
  await signIn(page, 'root@example.test')
  const site = page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true })
  await site.click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo site')
  const editor = page.getByRole('link', { name: 'A page served by cms-v2', exact: true })
  const originalDocument = await page.evaluate(() => performance.timeOrigin)
  const normal = await editor.getAttribute('href')
  const normalRequest = page.waitForRequest(
    request => new URL(request.url()).pathname === normal && request.method() === 'GET',
  )
  await editor.click()
  const ordinary = await normalRequest
  expect(ordinary.headers()['rsc']).toBe('1')
  await expect(canvas(page).locator('h1')).toBeVisible()
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(originalDocument)
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo site')
  await openCanvasDestination(page, page.getByRole('link', { name: 'Header & menu', exact: true }).first())
  await openCanvasDestination(page, page.getByRole('link', { name: 'Footer', exact: true }).first())

  const fixture = await sawsoFixture(true, true)
  try {
    const { client, actor, siteId } = fixture
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE cms_authenticated_user')
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const file = await registerReviewedSiteFile({
      client,
      store: createFilesystemMediaStore(defaultMediaRoot()),
      siteId,
      kind: 'stylesheet',
      name: 'document-navigation-proof.css',
      source: 'local:document-navigation-proof',
      bytes: Buffer.from('h1{outline-offset:2px}'),
    })
    const current = (
      await client.query(
        'SELECT h.revision,v.bundle FROM site_file_heads h JOIN site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
        [siteId],
      )
    ).rows[0]
    const bundle = current?.bundle ?? { version: 1, files: [], styles: [], scripts: [], paths: [] }
    await client.query('SELECT app.save_site_file_bundle($1,$2,$3)', [
      siteId,
      current?.revision ?? 0,
      JSON.stringify({
        ...bundle,
        files: [...bundle.files, file.id],
        styles: [...bundle.styles, { fileId: file.id, pages: [] }],
      }),
    ])
    await client.query('COMMIT')
    await page.goto('/sites/' + siteId)
    await openCanvasDestination(page, page.getByRole('link', { name: 'Edit home page', exact: true }))
  } finally {
    await fixture.client.query('ROLLBACK').catch(() => {})
    await fixture.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [fixture.siteId])
    fixture.client.release()
    await fixture.pool.end()
  }
})

test('keeps, discards, or saves the current Header draft before opening a canvas document', async ({ page }) => {
  const fixture = await sawsoFixture(true, true)
  const nativeDialogs: string[] = []
  page.on('dialog', async dialog => {
    nativeDialogs.push(dialog.type())
    await dialog.dismiss()
  })
  const header = '/sites/' + fixture.siteId + '/header'
  const footer = '/sites/' + fixture.siteId + '/footer'
  const destination = page
    .getByRole('navigation', { name: 'Sections of the CMS' })
    .getByRole('link', { name: 'Footer', exact: true })
  const prompt = page.getByRole('alertdialog', { name: 'Before you leave' })
  const add = async (name: string) => {
    await page.getByRole('button', { name: 'Add to menu', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Add to menu', exact: true })
    await form.getByRole('button', { name: 'A website', exact: true }).click()
    await form.getByLabel(/^Menu label/).fill(name)
    await form.getByLabel(/^Web address/).fill('/temporary-proof')
    await form.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
  try {
    await signIn(page, 'root@example.test')
    await page.goto(header)
    await add('Discard this proof row')
    await destination.click()
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(header + '$'))
    await expect(page.getByRole('button', { name: 'Discard this proof row', exact: true })).toBeVisible()

    await destination.click()
    await prompt.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(footer + '$'))
    await page.goto(header)
    await expect(page.getByRole('button', { name: 'Discard this proof row', exact: true })).toHaveCount(0)

    await add('Keep this private proof row')
    await destination.click()
    await prompt.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(footer + '$'))
    await page.goto(header)
    await expect(page.getByRole('button', { name: 'Keep this private proof row', exact: true })).toBeVisible()
    expect(nativeDialogs).toEqual([])
  } finally {
    await fixture.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [fixture.siteId])
    fixture.client.release()
    await fixture.pool.end()
  }
})
