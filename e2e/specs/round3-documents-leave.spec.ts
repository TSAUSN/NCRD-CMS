import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'
import { rawRequest } from './http.ts'

test.use({ actionTimeout: 15000 })

test('PDF category leave uses the normal library save and protects selection, filters and pending uploads', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    base = '/sites/' + f.site + '/documents',
    endpoint = '/api/sites/' + f.site + '/documents',
    folder = resolve('../.r8-progress/round3/documents-leave/' + info.project.name),
    firstName = 'First local report.pdf',
    secondName = 'Second local report.pdf',
    thirdName = 'Third local report.pdf',
    firstBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog /Lang(en)>>endobj\n%%EOF\n'),
    secondBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog /Lang(fr)>>endobj\n%%EOF\n'),
    thirdBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog /Lang(es)>>endobj\n%%EOF\n')
  const rows = async () =>
    (
      await f.pool.query(
        'SELECT m.*,a.original_name,a.content_hash FROM site_document_metadata m JOIN site_assets a ON a.id=m.asset_id WHERE m.site_id=$1 ORDER BY m.asset_id',
        [f.site],
      )
    ).rows
  try {
    await mkdir(folder, { recursive: true })
    const heads = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
      shot = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 1000 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
        }
      }
    await signIn(page, 'contributor@example.test')
    await page.goto(base)
    const upload = page.getByLabel('Upload a PDF', { exact: true }),
      select = (name: string) => page.getByRole('button', { name: new RegExp(name.replace('.pdf', '\\.pdf')) }).click(),
      details = page.getByRole('complementary', { name: 'Document details', exact: true }),
      category = details.getByRole('textbox', { name: 'Document category', exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await upload.setInputFiles({ name: firstName, mimeType: 'application/pdf', buffer: firstBytes })
    await expect(page.getByRole('status')).toContainText(firstName)
    await expect(upload).toBeEnabled()
    await upload.setInputFiles({ name: secondName, mimeType: 'application/pdf', buffer: secondBytes })
    await expect(page.getByRole('status')).toContainText(secondName)
    const baseline = await rows()
    await select(firstName)
    const original = await details.getByRole('textbox', { name: 'Document link', exact: true }).inputValue()
    await category.fill('Unsent category')
    await category.scrollIntoViewIfNeeded()
    await shot('category-edited')
    await select(secondName)
    await expect(leave).toContainText('Saving updates the Media library immediately')
    await shot('category-leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(details.getByRole('heading', { name: firstName, exact: true })).toBeVisible()
    await expect(category).toHaveValue('Unsent category')
    await select(secondName)
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(details.getByRole('heading', { name: secondName, exact: true })).toBeVisible()
    expect(await rows()).toEqual(baseline)
    await select(firstName)
    await category.fill('Saved category')
    let releasePatch!: () => void
    const patchWaiting = new Promise<void>(resolve => {
        releasePatch = resolve
      }),
      pattern = '**/api/sites/' + f.site + '/documents*'
    await page.route(pattern, async route => {
      if (route.request().method() === 'PATCH') {
        await patchWaiting
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'Synthetic document save refusal' } }),
        })
      } else await route.continue()
    })
    await select(secondName)
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(category).toBeDisabled()
    await expect(leave.getByRole('button', { name: 'Keep editing', exact: true })).toBeDisabled()
    releasePatch()
    await expect(leave.getByRole('alert')).toContainText('Synthetic document save refusal')
    await shot('category-save-error')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(category).toHaveValue('Saved category')
    await expect(details.getByRole('heading', { name: firstName, exact: true })).toBeVisible()
    expect(await rows()).toEqual(baseline)
    await page.unroute(pattern)
    await select(secondName)
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(details.getByRole('heading', { name: secondName, exact: true })).toBeVisible()
    const saved = (await rows()).find(row => row.original_name === firstName)!
    expect(saved.category).toBe('Saved category')
    await select(firstName)
    await category.fill('Older category intent')
    const concurrent = await page.evaluate(
      async ({ endpoint, id, revision }) => {
        const response = await fetch(endpoint, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, revision, category: 'Newer saved category', archived: false }),
        })
        return response.status
      },
      { endpoint, id: saved.asset_id, revision: Number(saved.revision) },
    )
    expect(concurrent).toBe(200)
    const latest = await rows()
    await page.getByRole('link', { name: 'Pages', exact: true }).click()
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toBeVisible()
    await shot('category-stale')
    expect(await rows()).toEqual(latest)
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(category).toHaveValue('Older category intent')
    await details.getByRole('button', { name: 'Refresh list', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(details.getByRole('heading', { name: 'Choose a document', exact: true })).toBeVisible()
    await select(firstName)
    await expect(category).toHaveValue('Newer saved category')
    await category.fill('Unsent filtered category')
    await page.getByRole('searchbox', { name: 'Search documents', exact: true }).fill('Second local report')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(category).toHaveValue('Unsent filtered category')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page.getByRole('button', { name: /First local report/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Second local report/ })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Search documents', exact: true }).fill('')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await select(firstName)
    await category.fill('Unsent status choice')
    await page.getByLabel('Document status', { exact: true }).selectOption('true')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page.getByLabel('Document status', { exact: true })).toHaveValue('false')
    await expect(category).toHaveValue('Unsent status choice')
    await page.getByLabel('Document status', { exact: true }).selectOption('true')
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'No documents here yet', exact: true })).toBeVisible()
    await page.getByLabel('Document status', { exact: true }).selectOption('false')
    await select(firstName)
    expect(await rows()).toEqual(latest)
    await category.fill('Saved before another upload')
    await upload.setInputFiles({ name: thirdName, mimeType: 'application/pdf', buffer: thirdBytes })
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    expect(await rows()).toHaveLength(2)
    await expect(category).toHaveValue('Saved before another upload')
    let releaseUpload!: () => void
    const uploadWaiting = new Promise<void>(resolve => {
      releaseUpload = resolve
    })
    await page.route(pattern, async route => {
      if (route.request().method() === 'POST') {
        await uploadWaiting
        await route.continue()
      } else await route.continue()
    })
    await upload.setInputFiles({ name: thirdName, mimeType: 'application/pdf', buffer: thirdBytes })
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(leave).toHaveCount(0)
    await expect(upload).toBeDisabled()
    await expect(category).toBeDisabled()
    await category.scrollIntoViewIfNeeded()
    await shot('pdf-upload-pending')
    const alerts: string[] = []
    page.once('dialog', async dialog => {
      alerts.push(dialog.message())
      await dialog.accept()
    })
    await page.getByRole('link', { name: 'Pages', exact: true }).click()
    expect(alerts).toHaveLength(1)
    await expect(page).toHaveURL(base)
    expect(await rows()).toHaveLength(2)
    releaseUpload()
    await expect(page.getByRole('status')).toContainText(thirdName)
    await page.unroute(pattern)
    expect(await rows()).toHaveLength(3)
    expect((await rows()).find(row => row.original_name === firstName)!.category).toBe('Saved before another upload')
    const bytes = await page.evaluate(
      async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),
      original,
    )
    expect(Buffer.from(bytes)).toEqual(firstBytes)
    expect((await rawRequest({ host: f.host, path: original })).status).toBe(404)
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(heads)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
