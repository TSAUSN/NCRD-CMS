import { expect, test } from '@playwright/test'
import { Client } from 'pg'
import { signIn } from './helpers.ts'
import { e2eTarget } from '../test-target.ts'

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n')
test('PDF library organizes, replaces, archives and restores without changing existing bytes', async ({
  page,
}, testInfo) => {
  const target = e2eTarget(),
    client = new Client({ connectionString: `postgres://cms:cms@${target.host}:${target.port}/${target.database}` })
  await client.connect()
  let siteId = ''
  try {
    siteId = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
  } finally {
    await client.end()
  }
  await signIn(page, 'contributor@example.test')
  const documentApi = `/api/sites/${siteId}/documents`
  let readsBeforeUpload = 0
  let uploadStarted = false
  page.on('request', request => {
    if (new URL(request.url()).pathname !== documentApi) return
    if (request.method() === 'POST') uploadStarted = true
    else if (request.method() === 'GET' && !uploadStarted) readsBeforeUpload++
  })
  await page.goto(`/sites/${siteId}/documents`)
  await expect(page.getByRole('link', { name: 'Documents', exact: true })).toHaveAttribute('aria-current', 'page')
  const name = `Acceptance report ${Date.now()}.pdf`
  await page
    .getByLabel('Upload a PDF', { exact: true })
    .setInputFiles({ name, mimeType: 'application/pdf', buffer: PDF })
  await page.getByRole('button', { name: new RegExp(name.replace('.pdf', '\\.pdf')) }).click()
  expect(uploadStarted).toBe(true)
  expect(readsBeforeUpload).toBe(0)
  const original = await page.getByLabel('Document link', { exact: true }).inputValue()
  await page.getByRole('textbox', { name: 'Document category', exact: true }).fill('Acceptance reports')
  await page.getByRole('button', { name: 'Save category', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Document saved')
  await page.reload()
  await page.getByLabel('Filter document category').selectOption('Acceptance reports')
  await page.getByRole('button', { name: new RegExp(name.replace('.pdf', '\\.pdf')) }).click()
  await expect(page.getByRole('textbox', { name: 'Document category', exact: true })).toHaveValue('Acceptance reports')
  const nextName = `Replacement ${Date.now()}.pdf`,
    nextBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog /Lang(en)>>endobj\n%%EOF\n')
  await page
    .getByLabel('Upload replacement PDF')
    .setInputFiles({ name: nextName, mimeType: 'application/pdf', buffer: nextBytes })
  await expect(page.getByRole('status')).toContainText('Existing links still use their original PDF')
  // Chromium sends the loopback Secure cookie; Playwright's separate HTTP client does not.
  const oldResponse = await page.evaluate(async url => {
    const response = await fetch(url)
    return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) }
  }, original)
  expect(oldResponse.status).toBe(200)
  expect(Buffer.from(oldResponse.bytes)).toEqual(PDF)
  await page.getByRole('button', { name: 'Archive document', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive document', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Document archived')
  expect(await page.evaluate(async url => (await fetch(url)).status, original)).toBe(200)
  const active = await page.evaluate(
    async url => {
      const response = await fetch(url)
      return { status: response.status, body: await response.json() }
    },
    `/api/sites/${siteId}/documents?search=${encodeURIComponent(name)}`,
  )
  expect(active.status).toBe(200)
  expect(active.body.documents).toEqual([])
  await page.getByLabel('Document status').selectOption('true')
  await page.getByRole('button', { name: new RegExp(name.replace('.pdf', '\\.pdf')) }).click()
  await page.getByRole('button', { name: 'Restore to library', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Document saved')
  await page.getByLabel('Document status').selectOption('false')
  await page.getByRole('button', { name: new RegExp(name.replace('.pdf', '\\.pdf')) }).click()
  await expect(page.getByLabel('Document link', { exact: true })).toHaveValue(original)
  await page.screenshot({ path: testInfo.outputPath('document-library-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 1024, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('document-library-tablet.png'), fullPage: true })
})
