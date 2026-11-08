import { expect, type Page, type Route } from '@playwright/test'
import { test } from './fixtures/shared-demo-home.ts'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { e2eTarget } from '../test-target.ts'
import { canvas, deleteSelectedSection, fetchPublic, publish, savedState, signIn } from './helpers.ts'

async function openSeededPage(page: Page) {
  const site = page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }),
    sitePath = await site.getAttribute('href')
  expect(sitePath).toMatch(/^\/sites\/[0-9a-f-]{36}$/)
  await site.click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo site')
  await page.getByRole('link', { name: 'A page served by cms-v2', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Page structure' })).toBeVisible()
  await expect(canvas(page).locator('h1')).toBeVisible()
}

type MockStatus = 'ready' | 'processing' | 'failed' | 'deleted'

function asset(status: MockStatus = 'ready') {
  return {
    id: '90000000-0000-4000-8000-000000000001',
    revision: status === 'deleted' ? 2 : 1,
    siteId: '00000000-0000-0000-0000-000000000101',
    scope: 'site',
    objectKey: 'uploads/community-meal.jpg',
    name: 'community-meal.jpg',
    altText: 'Volunteers serving a community meal',
    decorative: false,
    focal: null,
    width: 1600,
    height: 1067,
    bytes: 248000,
    mimeType: 'image/jpeg',
    status,
    folder: '',
    attribution: '',
    source: '',
    tags: [],
    variants: { original: true, thumbnail: true, card: true, wide: true },
    previewUrl: null,
    deliveryUrl: 'https://cdn.example.test/community-meal.jpg',
    usedOnItems: 2,
    usedInVersions: 4,
    createdAt: '2026-08-23T14:00:00.000Z',
    deletedAt: status === 'deleted' ? '2026-08-23T15:00:00.000Z' : null,
  }
}

async function openMedia(page: Page, email = 'editor@example.test') {
  await signIn(page, email)
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await page.getByRole('link', { name: 'Media', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Media', level: 1 })).toBeVisible()
}

async function mockMediaApi(
  page: Page,
  options?: {
    failFirstUpload?: boolean
    uploadStatus?: 'processing' | 'ready' | 'failed'
    // The workspace re-reads the library from the server after every mutation,
    // so a mocked mutation needs a mocked library for the refetch to agree with.
    mockLibrary?: boolean
  },
) {
  let uploadAttempts = 0
  let current = asset()
  function libraryResult() {
    return {
      assets: [current],
      total: 1,
      page: 1,
      pageSize: 24,
      pageCount: 1,
      facets: {
        folders: [{ path: current.folder, count: 1 }],
        tags: [],
        scopes: { site: 1, shared: 0 },
        statuses: {
          ready: current.status === 'ready' ? 1 : 0,
          processing: current.status === 'processing' ? 1 : 0,
          failed: 0,
          deleted: current.status === 'deleted' ? 1 : 0,
        },
      },
    }
  }
  if (options?.mockLibrary) {
    await page.route(/\/api\/sites\/[^/]+\/media\?/, async route => {
      await route.fulfill({ json: libraryResult() })
    })
  }
  let originalName = 'community-meal.jpg'
  const intentId = '90000000-0000-4000-8000-000000000099'
  const uploaded = {
    ...asset(),
    id: '90000000-0000-4000-8000-000000000097',
    revision: 1,
    name: 'newly-ready.jpg',
    altText: 'A newly verified image',
    usedOnItems: 0,
    usedInVersions: 0,
    deliveryUrl: '/media/90000000-0000-4000-8000-000000000097/wide',
  }
  await page.route('**/api/sites/*/media/uploads', async route => {
    expect(route.request().method()).toBe('POST')
    originalName = (route.request().postDataJSON() as { originalName: string }).originalName
    await route.fulfill({
      status: 201,
      json: {
        intentId,
        upload: {
          url: `/api/media/uploads/${intentId}`,
          method: 'PUT',
          headers: { 'x-cms-upload-token': '90000000-0000-4000-8000-000000000098' },
          expiresAt: '2026-08-23T16:00:00.000Z',
          maxBytes: 10 * 1024 * 1024,
          allowedContentTypes: ['image/jpeg'],
        },
      },
    })
  })
  await page.route(`**/api/media/uploads/${intentId}/status`, async route => {
    const status = options?.uploadStatus ?? 'processing'
    await route.fulfill({
      json: {
        intentId,
        status,
        failureCode: status === 'failed' ? 'media_decode_failed' : null,
        originalName,
        asset: status === 'ready' ? { ...uploaded, name: originalName } : null,
      },
    })
  })
  await page.route(`**/api/media/uploads/${intentId}`, async route => {
    uploadAttempts += 1
    if (options?.failFirstUpload && uploadAttempts === 1) {
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'storage-unavailable',
            message: 'The storage service is temporarily unavailable.',
          },
        },
      })
      return
    }
    await route.fulfill({ status: 202, json: { intentId, status: 'processing' } })
  })
  await page.route('**/api/media/assets/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/restore')) current = { ...asset('ready'), revision: 3 }
    else if (path.endsWith('/retry')) current = asset('processing')
    else if (route.request().method() === 'DELETE') {
      expect(route.request().postDataJSON()).toMatchObject({
        expectedRevision: 1,
        breakReferences: true,
        reason: 'Superseded by an approved replacement',
      })
      current = asset('deleted')
    }
    await route.fulfill({ json: { asset: current } })
  })
}

const MEDIA_ID = '90000000-0000-4000-8000-000000000001'
const SHARED_MEDIA_ID = '90000000-0000-4000-8000-000000000002'
const DB = process.env['E2E_DATABASE'] ?? 'cms_e2e'
const HOST = process.env['E2E_PG_HOST'] ?? '127.0.0.1'
const PORT = process.env['E2E_PG_PORT'] ?? '54329'
const DATABASE_URL = `postgres://cms:cms@${HOST}:${PORT}/${DB}`
const WORKER_DATABASE_URL = `postgres://cms_worker_app:devpassword@${HOST}:${PORT}/${DB}`
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

function drainWorker() {
  return execFileSync('pnpm', ['--filter', 'worker', 'drain'], {
    cwd: REPO,
    env: {
      ...process.env,
      DATABASE_URL_WORKER: WORKER_DATABASE_URL,
      APP_VERSION: 'e2e',
      WORKER_ID: `e2e-media-${process.pid}`,
    },
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 10_000,
  })
}

async function processUpload(page: Page, intentId: string) {
  const drains: string[] = []
  try {
    // Each monitored drain processes at most one batch. Earlier scenarios can
    // leave more than a batch of real outbox work ahead of this upload.
    for (let pass = 0; pass < 10; pass += 1) {
      drains.push(drainWorker())
      // Exercise the browser's authenticated request path. Its local secure
      // session cookie is not sent by APIRequestContext over loopback HTTP.
      const response = await page.evaluate(async id => {
        const result = await fetch(`/api/media/uploads/${id}/status`, { credentials: 'same-origin' })
        return { status: result.status, body: await result.json() }
      }, intentId)
      expect(response.status).toBe(200)
      const status = response.body as { status: string; failureCode: string | null }
      expect(status.status, `image verification failed: ${status.failureCode}`).not.toBe('failed')
      if (status.status === 'ready') return
    }
    throw new Error(`Upload ${intentId} was not ready after 10 real worker batches; see media-worker-drains.`)
  } finally {
    await test.info().attach('media-worker-drains', { body: drains.join('\n'), contentType: 'text/plain' })
  }
}

async function withDatabase(run: (client: Client) => Promise<void>) {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    await run(client)
  } finally {
    await client.end()
  }
}

async function seedMedia() {
  await withDatabase(async client => {
    const site = await client.query<{ id: string }>("SELECT id FROM sites WHERE slug = 'demo'")
    const siteId = site.rows[0]!.id
    await client.query(
      `INSERT INTO media (
         id, site_id, object_key, content_hash, original_name, alt_text, decorative,
         width, height, bytes, mime_type, status
       ) VALUES ($1,$2,$3,$4,$5,$6,false,1600,1067,248000,'image/jpeg','ready')
       ON CONFLICT (id) DO NOTHING`,
      [
        MEDIA_ID,
        siteId,
        'e2e/media/community-meal.jpg',
        'a'.repeat(64),
        'community-meal.jpg',
        'Volunteers serving a community meal',
      ],
    )
    for (const [kind, width, height, bytes, hashDigit] of [
      ['thumbnail', 400, 267, 20_000, 'b'],
      ['card', 1200, 800, 120_000, 'c'],
      ['wide', 1600, 1067, 180_000, 'd'],
    ] as const) {
      await client.query(
        `INSERT INTO media_variants (
           media_id, kind, object_key, width, height, bytes, mime_type, content_hash
         ) VALUES ($1,$2,$3,$4,$5,$6,'image/webp',$7)
         ON CONFLICT (media_id, kind) DO NOTHING`,
        [MEDIA_ID, kind, `e2e/media/${kind}.webp`, width, height, bytes, hashDigit.repeat(64)],
      )
    }
    await client.query(
      `INSERT INTO media (
         id, site_id, object_key, content_hash, original_name, alt_text, decorative,
         width, height, bytes, mime_type, status
       ) VALUES ($1,NULL,$2,$3,$4,$5,false,1200,600,148000,'image/jpeg','ready')
       ON CONFLICT (id) DO NOTHING`,
      [
        SHARED_MEDIA_ID,
        'e2e/media/foundation-shared.jpg',
        'e'.repeat(64),
        'foundation-shared.jpg',
        'A shared foundation image',
      ],
    )
    for (const [kind, width, height, bytes, hashDigit] of [
      ['thumbnail', 400, 200, 18_000, 'f'],
      ['card', 960, 480, 80_000, '1'],
      ['wide', 1200, 600, 120_000, '2'],
    ] as const) {
      await client.query(
        `INSERT INTO media_variants (
           media_id, kind, object_key, width, height, bytes, mime_type, content_hash
         ) VALUES ($1,$2,$3,$4,$5,$6,'image/webp',$7)
         ON CONFLICT (media_id, kind) DO NOTHING`,
        [SHARED_MEDIA_ID, kind, `e2e/media/shared-${kind}.webp`, width, height, bytes, hashDigit.repeat(64)],
      )
    }
    const items = [
      ['90000000-0000-4000-8000-000000000011', '90000000-0000-4000-8000-000000000021'],
      ['90000000-0000-4000-8000-000000000011', '90000000-0000-4000-8000-000000000022'],
      ['90000000-0000-4000-8000-000000000012', '90000000-0000-4000-8000-000000000023'],
      ['90000000-0000-4000-8000-000000000012', '90000000-0000-4000-8000-000000000024'],
    ]
    for (const [itemId, versionId] of items) {
      await client.query(
        `INSERT INTO media_usage (media_id, site_id, item_type, item_id, version_id)
         VALUES ($1,$2,'page',$3,$4) ON CONFLICT DO NOTHING`,
        [MEDIA_ID, siteId, itemId, versionId],
      )
    }
  })
}

async function removeSeedMedia() {
  await withDatabase(async client => {
    await client.query('DELETE FROM media WHERE id = ANY($1::uuid[])', [[MEDIA_ID, SHARED_MEDIA_ID]])
  })
}

test.describe('media library workspace', () => {
  test.beforeAll(seedMedia)
  test.afterAll(removeSeedMedia)

  test('native media details sit beside the library and keyboard focus selection remains valid', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openMedia(page)
    await expect(page.getByRole('list', { name: 'Images', exact: true })).toBeVisible()
    await page.getByRole('button').filter({ hasText: 'community-meal.jpg' }).click()
    const details = page.getByRole('dialog', { name: 'Image details', exact: true })
    const panel = await details.boundingBox()
    const library = await page.getByRole('list', { name: 'Images', exact: true }).boundingBox()
    expect(panel!.x).toBeGreaterThan(library!.x + library!.width)
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(1440)
    expect(panel!.width).toBe(320)
    await expect(details).toHaveAttribute('aria-modal', 'false')
    await details.getByRole('button', { name: 'Choose focus point on image' }).press('Enter')
    await details.getByText('Fine-tune position', { exact: true }).click()
    await expect(details.getByRole('slider', { name: 'Across', exact: true })).toHaveValue('0.5')
    await expect(details.getByRole('slider', { name: 'Down', exact: true })).toHaveValue('0.5')
    await details.getByText('Fine-tune position', { exact: true }).click()
    const focusFolder = resolve('../.r8-progress/echelon/focus')
    await mkdir(focusFolder, { recursive: true })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await details.getByRole('group', { name: 'Focus point', exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: resolve(focusFolder, 'media-unavailable-' + width + '.png') })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }

    await expect(details.getByRole('button', { name: 'Save image details', exact: true })).toBeVisible()
  })

  test('uploads through the signed-upload seam and reports asynchronous processing honestly', async ({ page }) => {
    await mockMediaApi(page)
    await openMedia(page)
    await page.getByRole('button', { name: /community-meal\.jpg/ }).click()
    // An editor curates metadata but the deletion lifecycle belongs to admins.
    await expect(page.getByRole('button', { name: 'Save image details' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete image' })).toHaveCount(0)
    await page
      .getByRole('dialog', { name: 'Image details', exact: true })
      .getByRole('button', { name: 'Close Image details', exact: true })
      .click()

    await page.getByRole('button', { name: 'Upload images' }).click()
    const upload = page.getByRole('region', { name: 'Upload an image' })
    await upload.getByLabel('Choose an image to upload').setInputFiles({
      name: 'community-meal.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('mock-image-bytes'),
    })
    await upload.getByRole('button', { name: 'Upload image' }).click()
    await expect(upload.getByText('Describe the image, or mark it as decorative.')).toBeVisible()
    await upload.getByLabel('Image description').fill('Volunteers serving a community meal')
    await upload.getByRole('button', { name: 'Try upload again' }).click()

    await expect(
      upload.getByText('Upload received. Verification and responsive image processing are running in the background.'),
    ).toBeVisible()
    await expect(page.getByText('community-meal.jpg is being verified and will be selected when ready.')).toBeVisible()
  })

  test('searches, changes density, and manages a usage-aware soft delete', async ({ page }) => {
    await mockMediaApi(page, { mockLibrary: true })
    await openMedia(page, 'root@example.test')

    await expect(page.getByRole('button', { name: /community-meal\.jpg/ })).toBeVisible()
    await page.getByRole('button', { name: /community-meal\.jpg/ }).click()
    await page
      .getByRole('dialog', { name: 'Image details', exact: true })
      .getByText('More details', { exact: true })
      .click()
    await expect(
      page.getByRole('dialog', { name: 'Image details', exact: true }).getByText('1600 × 1067 px', { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('dialog', { name: 'Image details', exact: true })
      .getByRole('button', { name: 'Close Image details', exact: true })
      .click()
    await page.getByRole('button', { name: 'List' }).click()
    await expect(page.locator('.media-assets')).toHaveClass(/is-list/)
    await page.getByLabel('Search all images').fill('community')
    await expect(page.getByText('1 result', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /community-meal\.jpg/ }).click()
    await page.getByRole('button', { name: 'Delete image' }).click()
    const deleteDialog = page.getByRole('dialog', { name: 'Delete an image that is still referenced?', exact: true })
    await expect(deleteDialog).toContainText('2 content items reference this image across 4 saved versions')
    await deleteDialog.getByLabel('Reason for breaking these references').fill('Short')
    await expect(deleteDialog.getByRole('button', { name: 'Delete image', exact: true })).toBeDisabled()
    await expect(deleteDialog.getByText('Use at least 8 characters.', { exact: true })).toBeVisible()
    const folder = resolve('../.r8-progress/step-4/native-confirmations')
    await mkdir(folder, { recursive: true })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await page.screenshot({ path: resolve(folder, `media-delete-reason-${width}.png`), animations: 'disabled' })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      page
        .getByRole('dialog', { name: 'Image details', exact: true })
        .getByRole('button', { name: 'Delete image', exact: true }),
    ).toBeFocused()
    await page
      .getByRole('dialog', { name: 'Image details', exact: true })
      .getByRole('button', { name: 'Delete image', exact: true })
      .click()
    await deleteDialog.getByLabel('Reason for breaking these references').fill('Superseded by an approved replacement')
    await deleteDialog.getByRole('button', { name: 'Delete image' }).click()
    await expect(page.getByLabel('Image details').getByText('Deleted', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Restore image' }).click()
    const restoreDialog = page.getByRole('alertdialog')
    await expect(restoreDialog).toContainText('will return to the active library')
    await expect(restoreDialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await page.screenshot({ path: resolve(folder, `media-restore-confirm-${width}.png`), animations: 'disabled' })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await restoreDialog.getByRole('button', { name: 'Restore image' }).click()
    await expect(page.getByText('Ready', { exact: true }).last()).toBeVisible()
  })

  test('shows shared media to editors but reserves its lifecycle controls for super admins', async ({ page }) => {
    await openMedia(page)
    await page.getByLabel('Search all images').fill('foundation-shared')
    await page.getByRole('button', { name: /foundation-shared\.jpg/ }).click()
    await expect(page.getByText('Shared', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete image' })).toHaveCount(0)
    await expect(page.getByText('Shared metadata is maintained by a super admin.')).toBeVisible()
    await expect(
      page
        .getByRole('dialog', { name: 'Image details', exact: true })
        .getByRole('img', { name: 'Image preview unavailable', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Image details', exact: true }).locator('img')).toHaveCount(0)
    const folder = resolve('../.r8-progress/step-4/native-confirmations')
    await mkdir(folder, { recursive: true })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await page.screenshot({ path: resolve(folder, `shared-media-read-only-${width}.png`), animations: 'disabled' })
    }
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.context().clearCookies()
    await openMedia(page, 'root@example.test')
    await page.getByLabel('Search all images').fill('foundation-shared')
    await page.getByRole('button', { name: /foundation-shared\.jpg/ }).click()
    await expect(page.getByRole('button', { name: 'Delete image' })).toBeVisible()
  })

  test('offers a retry after storage rejects an upload and preserves the chosen file', async ({ page }) => {
    await mockMediaApi(page, { failFirstUpload: true })
    await openMedia(page)

    await page.getByRole('button', { name: 'Upload images' }).click()
    const upload = page.getByRole('region', { name: 'Upload an image' })
    await upload.getByLabel('Choose an image to upload').setInputFiles({
      name: 'retry.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('mock-image-bytes'),
    })
    await upload.getByLabel('Image description').fill('A person ringing a red kettle bell')
    await upload.getByRole('button', { name: 'Upload image' }).click()
    await expect(upload.getByText('The storage service is temporarily unavailable.')).toBeVisible()
    await expect(upload.getByText('retry.jpg')).toBeVisible()
    await upload.getByRole('button', { name: 'Try upload again' }).click()
    await expect(
      upload.getByText('Upload received. Verification and responsive image processing are running in the background.'),
    ).toBeVisible()
  })

  test('reports worker rejection without inventing a failed media card', async ({ page }) => {
    await mockMediaApi(page, { uploadStatus: 'failed' })
    await openMedia(page)

    await page.getByRole('button', { name: 'Upload images' }).click()
    const upload = page.getByRole('region', { name: 'Upload an image' })
    await upload.getByLabel('Choose an image to upload').setInputFiles({
      name: 'corrupt.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('not-really-an-image'),
    })
    await upload.getByLabel('Image description').fill('An image that will fail verification')
    await upload.getByRole('button', { name: 'Upload image' }).click()

    await expect(page.locator('.media-notice[role="alert"]')).toContainText('could not be decoded')
    await expect(page.getByRole('list', { name: 'Images' }).getByRole('button', { name: /corrupt\.jpg/ })).toHaveCount(
      0,
    )
    await expect(page.getByRole('button', { name: 'Choose the file again' })).toBeVisible()
  })

  test('uploads, processes, reuses, publishes, deletes and restores a real image', async ({ page, browserName }) => {
    test.setTimeout(60_000)
    const imageName = `real-pipeline-${browserName}-${randomUUID().slice(0, 8)}.png`,
      imageSearch = imageName.slice(0, -4),
      imageLabel = new RegExp(imageSearch)
    await openMedia(page, 'root@example.test')
    const mediaPath = new URL(page.url()).pathname

    await page.getByRole('button', { name: 'Upload images' }).click()
    const upload = page.getByRole('region', { name: 'Upload an image' })
    await upload.getByLabel('Choose an image to upload').setInputFiles({
      name: imageName,
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG,
    })
    await upload.getByLabel('Image description').fill('A verified image from the real media pipeline')
    const intentResponse = page.waitForResponse(
      response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/media/uploads'),
    )
    await upload.getByRole('button', { name: 'Upload image' }).click()
    await expect(upload.getByText(/Upload received/)).toBeVisible()
    const { intentId } = (await (await intentResponse).json()) as { intentId: string }

    // The monitored one-shot role must run the same image handler as the
    // long-running worker. This is intentionally not a mocked status change.
    await processUpload(page, intentId)
    // The completed upload selects its image and opens the details drawer.
    // Wait for that settled state; the upload queue also has a Remove button
    // with the same filename while its successful receipt is being cleared.
    const processed = page.getByRole('dialog', { name: 'Image details', exact: true })
    await expect(processed).toBeVisible({ timeout: 10_000 })
    await expect(processed.getByRole('heading', { name: imageName, exact: true })).toBeVisible()
    await expect(processed.getByText('Ready', { exact: true })).toBeVisible()
    await expect(processed.locator('.media-detail-preview img')).toBeVisible()

    await processed.getByRole('button', { name: 'Close Image details', exact: true }).click()
    await page.getByRole('link', { name: 'Pages', exact: true }).click()
    await page.getByRole('link', { name: 'A page served by cms-v2', exact: true }).click()
    await page.getByRole('button', { name: 'Add a section', exact: true }).click()
    await page.getByRole('button', { name: 'At the end of the page', exact: true }).click()
    const sectionLibrary = page.getByRole('dialog', { name: 'Add a section' })
    await sectionLibrary.getByTestId('library-card-feature').getByRole('button', { name: /^Add / }).click()
    await sectionLibrary.getByRole('button', { name: 'Add this section', exact: true }).click()
    await page.getByRole('button', { name: 'Choose from media library' }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library' })
    await picker.getByLabel('Search images').fill(imageSearch)
    await picker.getByRole('option', { name: imageLabel }).click()
    await picker.getByRole('button', { name: 'Use this image' }).click()
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })

    const placedId = await page.locator('#slot-3-picture-src').inputValue()
    const match = placedId.match(/\/media\/([0-9a-f-]+)\/wide/)
    expect(match?.[1]).toBeTruthy()
    const realMediaId = match![1]!
    const publicImagePath = `/media/${realMediaId}/wide`
    expect((await fetchPublic(publicImagePath)).status).toBe(404)
    await publish(page)
    const publicImage = await fetchPublic(publicImagePath)
    expect(publicImage.status).toBe(200)
    expect(publicImage.headers['cache-control']).toBe('public, max-age=0, must-revalidate')
    expect((await fetchPublic(`/media/${realMediaId}/original`)).status).toBe(404)
    expect((await fetchPublic(publicImagePath, { 'If-None-Match': publicImage.headers.etag! })).status).toBe(304)
    await expect.poll(async () => (await fetchPublic()).body.includes(realMediaId)).toBe(true)

    // Restore the shared page before exercising lifecycle controls so the live
    // site never ends this scenario with a deleted image.
    await deleteSelectedSection(page)
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
    await publish(page)
    await expect.poll(async () => (await fetchPublic()).body.includes(realMediaId)).toBe(false)
    expect((await fetchPublic(publicImagePath, { 'If-None-Match': publicImage.headers.etag! })).status).toBe(404)

    // Test a slow document load: text entered before the client takes over
    // must not disappear. The search stays disabled until it can process input.
    const chunks = /\/_next\/static\/chunks\/[^?]+\.js(?:\?|$)/
    let releaseScripts!: () => void
    const scriptsReady = new Promise<void>(resolve => {
      releaseScripts = resolve
    })
    const hold = async (route: Route) => {
      await scriptsReady
      await route.fallback()
    }
    const search = page.getByLabel('Search all images')
    await page.route(chunks, hold)
    try {
      await page.goto(mediaPath, { waitUntil: 'commit' })
      await expect(search).toBeAttached()
      await expect(search).toBeDisabled()
    } finally {
      releaseScripts()
      await page.unroute(chunks, hold)
    }
    await expect(page.getByRole('heading', { name: 'Media', level: 1 })).toBeVisible()
    await search.fill(imageSearch)
    await expect(page.getByRole('list', { name: 'Images' }).getByRole('button')).toHaveCount(1)
    await page.getByRole('button', { name: imageLabel }).click()
    await page.getByRole('button', { name: 'Delete image' }).click()
    const deletion = page.getByRole('dialog', { name: 'Delete an image that is still referenced?', exact: true })
    await deletion
      .getByLabel('Reason for breaking these references')
      .fill('Verified recovery after a governed deletion')
    await deletion.getByRole('button', { name: 'Delete image' }).click()
    await expect(page.getByLabel('Image details').getByText('Deleted', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Restore image' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Restore image' }).click()
    await expect(page.getByText('Ready', { exact: true }).last()).toBeVisible()
  })

  test('chooses a governed image in the editor and carries it through save and publish', async ({ page }) => {
    await page.route('**/media/' + MEDIA_ID + '/thumbnail', route =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="100"><rect width="600" height="100" fill="white"/><text x="5" y="65" font-size="30">LEFT — WIDE IMAGE — RIGHT</text></svg>',
      }),
    )
    await signIn(page, 'root@example.test')
    await openSeededPage(page)

    await page.getByRole('button', { name: 'Add a section', exact: true }).click()
    await page.getByRole('button', { name: 'At the end of the page', exact: true }).click()
    const library = page.getByRole('dialog', { name: 'Add a section' })
    await library.getByTestId('library-card-feature').getByRole('button', { name: /^Add / }).click()
    await library.getByRole('button', { name: 'Add this section', exact: true }).click()
    await expect(savedState(page)).toHaveText('All changes saved')
    const editorPath = new URL(page.url()).pathname
    await page.context().clearCookies()
    await signIn(page, 'editor@example.test')
    await page.goto(editorPath + '?section=3')

    await page.getByRole('button', { name: 'Choose from media library' }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library' })
    const communityMeal = picker.getByRole('option', { name: /community-meal\.jpg/ })
    await expect(communityMeal).toBeVisible()
    await communityMeal.click()
    // The chosen image appears twice: its grid card and the selection preview.
    // Other images uploaded by earlier tests in this file are not counted.
    const thumbnails = picker.locator('.media-thumb img[src*="' + MEDIA_ID + '"]')
    await expect(thumbnails).toHaveCount(2)
    for (const thumbnail of await thumbnails.all()) {
      await expect(thumbnail).toHaveCSS('object-fit', 'contain')
      await expect
        .poll(() =>
          thumbnail.evaluate(
            node => (node as HTMLImageElement).naturalWidth / (node as HTMLImageElement).naturalHeight,
          ),
        )
        .toBe(6)
    }
    const captures = resolve('../.r8-progress/media-picker-contain')
    await mkdir(captures, { recursive: true })
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: resolve(captures, 'picker-' + width + '.png') })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect(picker.getByLabel('Image description')).toHaveValue('Volunteers serving a community meal')
    await picker.getByRole('button', { name: 'Use this image' }).click()

    await expect(page.locator('#slot-3-picture-src')).toHaveValue(`/media/${MEDIA_ID}/wide`)
    await expect(page.locator('#slot-3-picture-alt')).toHaveValue('Volunteers serving a community meal')
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
    await expect(canvas(page).locator('[data-cms-section="3"] img')).toHaveAttribute('src', `/media/${MEDIA_ID}/wide`)

    await publish(page)
    const publicPage = await fetchPublic()
    expect(publicPage.body).toContain(`/media/${MEDIA_ID}/wide`)
    expect(publicPage.body).toContain('alt="Volunteers serving a community meal"')

    // Restore the shared page fixture before the media row is removed. The
    // immutable published version remains honest history; the live page no
    // longer references the test asset.
    await page.context().clearCookies()
    await signIn(page, 'root@example.test')
    await page.goto(editorPath + '?section=3')
    await deleteSelectedSection(page)
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
    await publish(page)
    await expect
      .poll(async () => (await fetchPublic()).body.includes(MEDIA_ID), {
        message: 'the second publish removes the test image from the live page',
      })
      .toBe(false)
  })

  test('polls a picker upload and selects only the ready media row', async ({ page }) => {
    const uploadOptions: { uploadStatus: 'processing' | 'ready'; mockLibrary: boolean } = {
      uploadStatus: 'processing',
      mockLibrary: true,
    }
    await mockMediaApi(page, uploadOptions)
    await signIn(page, 'root@example.test')
    await openSeededPage(page)

    await page.getByRole('button', { name: 'Add a section', exact: true }).click()
    await page.getByRole('button', { name: 'At the end of the page', exact: true }).click()
    const library = page.getByRole('dialog', { name: 'Add a section' })
    await library.getByTestId('library-card-feature').getByRole('button', { name: /^Add / }).click()
    await library.getByRole('button', { name: 'Add this section', exact: true }).click()
    await expect(savedState(page)).toHaveText('All changes saved')
    const editorPath = new URL(page.url()).pathname
    await page.context().clearCookies()
    await signIn(page, 'editor@example.test')
    await page.goto(editorPath + '?section=3')
    await page.getByRole('button', { name: 'Choose from media library' }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library' })
    await picker.getByRole('option', { name: /community-meal\.jpg/ }).click()
    await expect(picker.getByRole('button', { name: 'Use this image', exact: true })).toBeEnabled()
    await picker.getByRole('button', { name: 'Upload' }).click()
    await expect(picker.getByRole('button', { name: 'Use this image', exact: true })).toBeDisabled()
    const upload = picker.getByRole('region', { name: 'Upload an image' })
    await upload.getByLabel('Choose an image to upload').setInputFiles({
      name: 'newly-ready.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('mock-image-bytes'),
    })
    await upload.getByLabel('Image description').fill('A newly verified image')
    await upload.getByRole('button', { name: 'Upload image' }).click()

    await expect(
      picker.getByText('newly-ready.jpg is being verified. It will be selected when its responsive images are ready.'),
    ).toBeVisible()
    await expect(picker.getByRole('button', { name: 'Use this image', exact: true })).toBeDisabled()
    await expect(picker.getByRole('option', { selected: true })).toHaveCount(0)
    uploadOptions.uploadStatus = 'ready'
    await expect(picker.getByText('newly-ready.jpg is ready and selected.')).toBeVisible()
    await expect(picker.getByRole('button', { name: 'Use this image', exact: true })).toBeEnabled()
    await expect(picker.getByRole('option', { name: /newly-ready\.jpg/ })).toHaveAttribute('aria-selected', 'true')
    await expect(picker.getByLabel('Image description')).toHaveValue('A newly verified image')

    // Put the shared seeded page back. Left behind, the inserted section was
    // autosaved on slower machines and shifted later specs' section indexes.
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(picker).toBeHidden()
    await page.context().clearCookies()
    await signIn(page, 'root@example.test')
    await page.goto(editorPath + '?section=3')
    await deleteSelectedSection(page)
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(3)
  })
})

test('stops processing after interrupted media jobs and lets the editor choose the file again', async ({
  page,
}, info) => {
  e2eTarget()
  const folder = resolve(REPO, '.r8-progress/media-terminal', info.project.name)
  await mkdir(folder, { recursive: true })
  await openMedia(page, 'root@example.test')
  const upload = page.getByRole('region', { name: 'Upload an image', exact: true })
  if (!(await upload.isVisible())) await page.getByRole('button', { name: 'Upload images', exact: true }).click()
  const name = 'interrupted-' + randomUUID().slice(0, 8) + '.png'
  await upload
    .getByLabel('Choose an image to upload', { exact: true })
    .setInputFiles({ name, mimeType: 'image/png', buffer: ONE_PIXEL_PNG })
  await upload.getByLabel('Image description', { exact: true }).fill('[Local processing recovery check]')
  const response = page.waitForResponse(
    r => r.request().method() === 'POST' && /\/api\/sites\/[^/]+\/media\/uploads$/.test(new URL(r.url()).pathname),
  )
  await upload.getByRole('button', { name: 'Upload image', exact: true }).click()
  const intent = (await (await response).json()) as { intentId: string }
  await expect(
    upload.getByText('Upload received. Verification and responsive image processing are running in the background.', {
      exact: true,
    }),
  ).toBeVisible()
  await withDatabase(async client => {
    const job = (
      await client.query(
        "SELECT id FROM outbox WHERE event_type='media.upload_received' AND payload->>'intent_id'=$1",
        [intent.intentId],
      )
    ).rows[0]!
    await client.query('UPDATE outbox SET max_attempts=1 WHERE id=$1', [job.id])
    const excluded = (await client.query('SELECT id FROM outbox WHERE id<>$1', [job.id])).rows.map(row => row.id)
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE cms_worker')
    await client.query("SELECT set_config('app.worker_id','media-browser-recovery',true)")
    const claimed = (await client.query('SELECT * FROM app.claim_outbox(60,$1)', [excluded])).rows[0]!
    expect(String(claimed.id)).toBe(String(job.id))
    await client.query('COMMIT')
    await client.query("UPDATE outbox SET leased_until=now()-interval '1 second' WHERE id=$1", [job.id])
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE cms_worker')
    await client.query("SELECT set_config('app.worker_id','media-browser-recovery',true)")
    expect((await client.query('SELECT * FROM app.claim_outbox(60,$1)', [excluded])).rows).toHaveLength(0)
    await client.query('COMMIT')
    expect(
      (await client.query('SELECT status,failure_code FROM app.media_upload_intents WHERE id=$1', [intent.intentId]))
        .rows[0],
    ).toEqual({ status: 'failed', failure_code: 'media_processing_interrupted' })
  })
  await expect(page.locator('.media-notice[role="alert"]')).toContainText(
    'Image processing could not finish. Choose the file again to retry.',
  )
  await expect(page.getByRole('button', { name: 'Choose the file again', exact: true })).toBeVisible()
  await expect(
    page.getByText('Upload received. Verification and responsive image processing are running in the background.', {
      exact: true,
    }),
  ).toHaveCount(0)
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width === 390) {
      const navigation = page.getByRole('complementary', { name: 'CMS navigation', exact: true, includeHidden: true })
      await expect(navigation).toHaveAttribute('aria-hidden', 'true')
      await expect(navigation).not.toBeInViewport()
    }
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: resolve(folder, 'processing-stopped-' + width + '.png') })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Choose the file again', exact: true }).click()
  await expect(upload.getByLabel('Choose an image to upload', { exact: true })).toBeVisible()
  await expect(upload.getByRole('button', { name: 'Upload image', exact: true })).toHaveCount(0)
  await page.screenshot({ path: resolve(folder, 'choose-again-1440.png') })
  await upload
    .getByLabel('Choose an image to upload', { exact: true })
    .setInputFiles({ name, mimeType: 'image/png', buffer: ONE_PIXEL_PNG })
  await upload.getByLabel('Image description', { exact: true }).fill('[Local processing recovery check]')
  const retryResponse = page.waitForResponse(
    r => r.request().method() === 'POST' && /\/api\/sites\/[^/]+\/media\/uploads$/.test(new URL(r.url()).pathname),
  )
  await upload.getByRole('button', { name: 'Upload image', exact: true }).click()
  const retry = (await (await retryResponse).json()) as { intentId: string }
  expect(retry.intentId).not.toBe(intent.intentId)
  await expect(
    upload.getByText('Upload received. Verification and responsive image processing are running in the background.', {
      exact: true,
    }),
  ).toBeVisible()
  await processUpload(page, retry.intentId)
  await expect(page.locator('.media-notice[role="status"]')).toContainText('is ready')
  await expect(page.locator('.media-notice[role="alert"]')).toHaveCount(0)
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width === 390) {
      const navigation = page.getByRole('complementary', { name: 'CMS navigation', exact: true, includeHidden: true })
      await expect(navigation).toHaveAttribute('aria-hidden', 'true')
      await expect(navigation).not.toBeInViewport()
    }
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: resolve(folder, 'retry-ready-' + width + '.png') })
  }
})
