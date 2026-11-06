import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { signIn, canvas } from './helpers.ts'
import { rawRequest } from './http.ts'
import { DEFAULT_THEME_TOKENS } from '@cms/schema'

test('exports an authored site and imports a private draft copy with its content', async ({ page }) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(10_000)
  const failures: string[] = []
  page.on('pageerror', error => failures.push(error.message))
  await signIn(page, 'root@example.test')
  await page.goto('/sites/new')
  const slug = `portable-${Date.now()}`,
    name = 'Portable content example'
  await page.getByLabel('Site name', { exact: true }).fill(name)
  await page.getByLabel('Short address', { exact: true }).fill(slug)
  for (let step = 0; step < 4; step++) await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Create site', exact: true }).click()
  await expect(page.getByText('Your new site is private until you publish it.', { exact: false })).toBeVisible()
  const sourceId = page.url().match(/\/sites\/([^/?]+)/)![1]!
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('link', { name: 'Advanced', exact: true }).click()
  const downloadPromise = page.waitForEvent('download', { timeout: 10_000 })
  await page.getByRole('button', { name: 'Download content archive', exact: true }).click()
  const download = await downloadPromise,
    file = await download.path()
  expect(file).not.toBeNull()
  const bytes = await readFile(file!),
    archive = JSON.parse(bytes.toString('utf8'))
  expect(archive.format).toBe('cms-site-content')
  expect(archive.version).toBe(1)
  expect(archive.content.pages.length).toBeGreaterThan(0)
  expect(
    archive.content.page_versions.some((version: { content: { values: Record<string, string> }[] }) =>
      version.content.some(section => section.values['heading'] === name),
    ),
  ).toBe(true)
  await page.goto('/sites/import')
  await page
    .getByLabel('Content archive (.json, up to 64 MB)')
    .setInputFiles({ name: 'content.json', mimeType: 'application/json', buffer: bytes })
  await expect(page.getByRole('heading', { name: 'Review this import', exact: true })).toBeVisible()
  await page.getByLabel('New site name', { exact: true }).fill('Imported content example')
  await page.getByLabel('New short address', { exact: true }).fill(`${slug}-copy`)
  await page.getByRole('button', { name: 'Create private draft copy', exact: true }).click()
  await expect(page.getByText('Your site content was imported as private drafts.', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Open imported site', exact: true }).click()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+$/)
  const targetId = page.url().match(/\/sites\/([^/?]+)/)![1]!
  expect(targetId).not.toBe(sourceId)
  await expect(page.getByRole('heading', { level: 1, name: /^Imported content example/ })).toBeVisible()
  expect((await rawRequest({ host: `${slug}-copy.staging.localhost`, path: '/' })).status).toBe(404)
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('link', { name: 'Advanced', exact: true }).click()
  const redownloadPromise = page.waitForEvent('download', { timeout: 10_000 })
  await page.getByRole('button', { name: 'Download content archive', exact: true }).click()
  const redownload = await redownloadPromise
  const copy = JSON.parse(await readFile((await redownload.path())!, 'utf8'))
  expect(
    copy.content.pages.every((row: { published_version_id: string | null }) => row.published_version_id === null),
  ).toBe(true)
  expect(copy.content.page_versions.length).toBe(archive.content.page_versions.length)
  for (const workspace of ['design', 'navigation', 'global-elements']) {
    expect((await page.goto(`/sites/${targetId}/${workspace}`))?.status()).toBe(200)
    await expect(page.getByText('Not published yet', { exact: true })).toBeVisible()
    if (workspace !== 'navigation')
      await expect(page.getByRole('button', { name: 'Revert to live', exact: true })).toBeDisabled()
  }
  await page.goto(`/sites/${targetId}`)
  await page.locator('table[aria-label="Pages"] tbody tr td:first-child a').first().click()
  await expect(canvas(page).locator('h1')).toContainText(name)
  expect(failures).toEqual([])
})

test('keeps content import unavailable to ordinary editors and rejects setup files clearly', async ({ page }) => {
  await signIn(page, 'editor@example.test')
  expect((await page.goto('/sites/import'))?.status()).toBe(404)
  await page.context().clearCookies()
  await signIn(page, 'root@example.test')
  await page.goto('/sites/import')
  await page.getByLabel('Content archive (.json, up to 64 MB)').setInputFiles({
    name: 'setup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ name: 'A wizard setup', version: 1 })),
  })
  await expect(page.getByRole('alert').filter({ hasText: 'wizard setup files use a separate format' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create private draft copy', exact: true })).toHaveCount(0)
})

test('keeps failed exports in Settings and downloads successfully after media recovery', async ({ page }) => {
  test.setTimeout(45_000)
  page.setDefaultTimeout(10_000)
  const { Client } = await import('pg')
  const { randomUUID } = await import('node:crypto')
  const client = new Client({
    connectionString: `postgres://cms:cms@${process.env['E2E_PG_HOST'] ?? '127.0.0.1'}:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
  })
  await client.connect()
  const mediaId = randomUUID()
  let siteId = '',
    rootId = ''
  try {
    // Other browser cases deliberately retain malformed/historical content in
    // Demo. This recovery journey needs its own fully valid export source.
    rootId = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
    siteId = (
      await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        `export-recovery-${Date.now()}`,
        'Export recovery fixture',
        'resource',
        null,
        JSON.stringify(DEFAULT_THEME_TOKENS),
        '[]',
      ])
    ).rows[0]!.id
    await client.query('COMMIT')
    await client.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,mime_type,status) VALUES($1,$2,$3,$4,'pending-test.png','Pending test image','image/png','processing')",
      [mediaId, siteId, `export-test/${mediaId}.png`, 'a'.repeat(64)],
    )
    await signIn(page, 'root@example.test')
    await page.goto(`/sites/${siteId}/settings?tab=advanced`)
    const exportCard = page.getByRole('region', { name: 'Backup' })
    await client.query('BEGIN')
    await client.query('LOCK TABLE media IN ACCESS EXCLUSIVE MODE')
    await exportCard.getByRole('button', { name: 'Download content archive', exact: true }).click()
    await expect(exportCard.getByRole('button', { name: 'Preparing content archive…', exact: true })).toBeDisabled()
    await expect(exportCard.getByRole('status')).toContainText('checking its images')
    await client.query('ROLLBACK')
    await expect(exportCard.getByRole('alert')).toContainText('processing')
    await expect(exportCard.getByRole('link', { name: 'Media', exact: true })).toBeVisible()
    await expect(page).toHaveURL(`/sites/${siteId}/settings?tab=advanced`)
    await expect(exportCard.getByRole('button', { name: 'Download content archive', exact: true })).toBeEnabled()
    await client.query("UPDATE media SET status='ready',width=1,height=1,bytes=16 WHERE id=$1", [mediaId])
    await exportCard.getByRole('button', { name: 'Download content archive', exact: true }).click()
    await expect(exportCard.getByRole('alert')).toContainText('missing')
    await expect(page).toHaveURL(`/sites/${siteId}/settings?tab=advanced`)
    await client.query('DELETE FROM media WHERE id=$1', [mediaId])
    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 })
    await exportCard.getByRole('button', { name: 'Download content archive', exact: true }).click()
    const download = await downloadPromise
    const archive = JSON.parse(await readFile((await download.path())!, 'utf8'))
    expect(archive.format).toBe('cms-site-content')
    await expect(exportCard.getByRole('status')).toContainText('Your content archive is ready')
    await expect(exportCard.getByRole('alert')).toHaveCount(0)
    await expect(page).toHaveURL(`/sites/${siteId}/settings?tab=advanced`)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    await client.query('DELETE FROM media WHERE id=$1', [mediaId]).catch(() => {})
    if (siteId) {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
      const row = (await client.query('SELECT revision FROM sites WHERE id=$1', [siteId])).rows[0]
      if (row) await client.query('SELECT app.archive_site($1,$2)', [siteId, row.revision])
      await client.query('COMMIT')
    }
    await client.end()
  }
})
