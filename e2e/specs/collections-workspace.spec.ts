import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client, type QueryResultRow } from 'pg'
import { signIn } from './helpers.ts'

const DB = process.env['E2E_DATABASE'] ?? 'cms_e2e'
const HOST = process.env['E2E_PG_HOST'] ?? '127.0.0.1'
const PORT = process.env['E2E_PG_PORT'] ?? '54329'
const DATABASE_URL = `postgres://cms:cms@${HOST}:${PORT}/${DB}`
const COLLECTION_SLUG = 'e2e-newsroom'
const SITE_ADMIN_EMAIL = 'siteadmin@example.test'
const MEDIA_ID = '91000000-0000-4000-8000-000000000001'
let collectionId = ''

async function capture(page: Page, name: string) {
  const folder = resolve('../.r8-progress/step-4/list-review-picker')
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await page.screenshot({ path: resolve(folder, `${name}-${width}.png`), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

async function withDatabase<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

async function one<T extends QueryResultRow>(sql: string, values: unknown[] = []): Promise<T> {
  return withDatabase(async client => (await client.query<T>(sql, values)).rows[0]!)
}

async function prepareWorkspaceFixtures() {
  await withDatabase(async client => {
    const site = await client.query<{ id: string }>("SELECT id FROM sites WHERE slug='demo'")
    const siteId = site.rows[0]!.id
    const user = await client.query<{ id: string }>(
      `INSERT INTO app_users(email,display_name,auth_subject)
       VALUES($1,'Demo Site Administrator',$2)
       ON CONFLICT(email) DO UPDATE SET auth_subject=EXCLUDED.auth_subject,status='active'
       RETURNING id`,
      [SITE_ADMIN_EMAIL, `local|${SITE_ADMIN_EMAIL}`],
    )
    await client.query(
      `INSERT INTO site_memberships(site_id,user_id,role)
       VALUES($1,$2,'site_admin')
       ON CONFLICT(site_id,user_id) DO UPDATE SET role='site_admin'`,
      [siteId, user.rows[0]!.id],
    )
    // Entry versions pin the schema version they were written under, so the
    // entries must go before the collection can take its schema versions away.
    await client.query(
      `DELETE FROM collection_entries WHERE collection_id IN
         (SELECT id FROM collections WHERE site_id=$1 AND slug=$2)`,
      [siteId, COLLECTION_SLUG],
    )
    await client.query('DELETE FROM collections WHERE site_id=$1 AND slug=$2', [siteId, COLLECTION_SLUG])
    await client.query('DELETE FROM media_usage WHERE media_id=$1', [MEDIA_ID])
    await client.query('DELETE FROM media WHERE id=$1', [MEDIA_ID])
    await client.query(
      `INSERT INTO media(
         id,site_id,object_key,content_hash,original_name,alt_text,decorative,
         width,height,bytes,mime_type,status
       ) VALUES($1,$2,$3,$4,$5,$6,false,1600,900,220000,'image/jpeg','ready')`,
      [
        MEDIA_ID,
        siteId,
        'e2e/collections/community-response.jpg',
        '9'.repeat(64),
        'community-response.jpg',
        'Volunteers coordinating a community response',
      ],
    )
    for (const [kind, width, height, bytes, digit] of [
      ['thumbnail', 400, 225, 18_000, '8'],
      ['wide', 1600, 900, 160_000, '7'],
    ] as const) {
      await client.query(
        `INSERT INTO media_variants(media_id,kind,object_key,width,height,bytes,mime_type,content_hash)
         VALUES($1,$2,$3,$4,$5,$6,'image/webp',$7)`,
        [MEDIA_ID, kind, `e2e/collections/${kind}.webp`, width, height, bytes, digit.repeat(64)],
      )
    }
  })
}

async function removeWorkspaceFixtures() {
  await withDatabase(async client => {
    await client.query(
      `DELETE FROM collection_entries WHERE collection_id IN
         (SELECT id FROM collections WHERE id=$1 OR slug=$2)`,
      [collectionId || null, COLLECTION_SLUG],
    )
    await client.query('DELETE FROM collections WHERE id=$1 OR slug=$2', [collectionId || null, COLLECTION_SLUG])
    await client.query('DELETE FROM media_usage WHERE media_id=$1', [MEDIA_ID])
    await client.query('DELETE FROM media WHERE id=$1', [MEDIA_ID])
  })
}

async function openCollections(page: Page, email = SITE_ADMIN_EMAIL) {
  await signIn(page, email)
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo site')
  if ((page.viewportSize()?.width ?? 1280) <= 960) {
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(page.locator('.app')).toHaveAttribute('data-drawer', 'open')
  }
  await page.getByRole('link', { name: 'Lists', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Lists', level: 1 })).toBeVisible()
}

function activeRecords(page: Page) {
  return page.getByRole('list', { name: 'E2E Newsroom items' }).getByRole('listitem')
}

function record(page: Page, title: string) {
  return activeRecords(page).filter({ has: page.getByText(title, { exact: true }) })
}

async function openRecord(page: Page, title: string) {
  await record(page, title)
    .getByRole('button', { name: 'Edit ' + title, exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: 'Edit item', exact: true })).toBeVisible()
}
async function listAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'More list actions', exact: true }).click()
  await page.getByRole('button', { name, exact: true }).click()
}
async function saveItem(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Save item', exact: true }).click()
  await expect(page.getByText('List draft saved. The live site is unchanged.')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function fillStory(
  page: Page,
  values: {
    title: string
    summary: string
    date: string
    url: string
    category?: string
    department?: string
  },
) {
  await page.getByLabel('Headline').fill(values.title)
  const summary = page
    .locator('.collection-field')
    .filter({ has: page.locator('label').filter({ hasText: 'Summary' }) })
  await summary.getByRole('button', { name: 'HTML source', exact: true }).click()
  await summary.getByLabel('HTML source', { exact: true }).fill(values.summary)
  await summary.getByRole('button', { name: 'Visual', exact: true }).click()
  await page.getByLabel('Publication date').fill(values.date)
  await page.getByLabel('Story link').fill(values.url)
  if (values.category !== undefined) await page.getByLabel('Category').fill(values.category)
  if (values.department !== undefined) await page.getByLabel('Department').selectOption(values.department)
}

test.describe.serial('Collections admin workspace', () => {
  test.beforeAll(prepareWorkspaceFixtures)
  test.afterAll(removeWorkspaceFixtures)

  test('starts honestly empty, creates from a preset, and governs the schema visually', async ({ page }, testInfo) => {
    await openCollections(page)
    await expect(page.getByRole('list', { name: 'E2E Newsroom items' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Keep shared items in a list' })).toBeVisible()

    const create = page.getByRole('button', { name: 'New list' })
    await create.click()
    const createDialog = page.getByRole('dialog', { name: 'Create a list' })
    await expect(createDialog.getByRole('button', { name: 'Close' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(createDialog).toBeHidden()
    await expect(create).toBeFocused()

    await create.click()
    await createDialog.getByRole('button', { name: /News & stories/ }).click()
    await createDialog.getByLabel('List name').fill('E2E Newsroom')
    await createDialog.getByText('Advanced · addresses and keys', { exact: true }).click()
    await expect(createDialog.getByLabel('List address')).toHaveValue(COLLECTION_SLUG)
    await expect(createDialog.getByLabel('Reader key')).toHaveValue('e2e_newsroom')
    await createDialog.getByRole('button', { name: 'Create list' }).click()
    await expect(page.getByRole('heading', { name: 'E2E Newsroom', level: 2 })).toBeVisible()
    await expect(
      page
        .locator('header')
        .filter({ has: page.getByRole('heading', { name: 'E2E Newsroom', exact: true }) })
        .getByText('Draft', { exact: true }),
    ).toBeVisible()

    const created = await one<{
      id: string
      source: string
      draft_schema_version_id: string
      published_schema_version_id: string | null
    }>('SELECT id,source,draft_schema_version_id,published_schema_version_id FROM collections WHERE slug=$1', [
      COLLECTION_SLUG,
    ])
    collectionId = created.id
    expect(created.source).toBe('admin')
    expect(created.draft_schema_version_id).toBeTruthy()
    expect(created.published_schema_version_id).toBeNull()

    await listAction(page, 'List settings')
    const schema = page.getByRole('dialog', { name: 'List settings' })
    await expect
      .poll(() => schema.evaluate(dialog => dialog.contains(document.activeElement)), {
        message: 'focus enters the schema dialog',
      })
      .toBe(true)
    await page.keyboard.press('Shift+Tab')
    expect(await schema.evaluate(dialog => dialog.contains(document.activeElement))).toBe(true)
    await schema.getByRole('button', { name: 'Add field' }).click()
    const added = schema.locator('.schema-field-card').last()
    await added.getByLabel('Label').fill('Department')
    await added.getByText('Advanced', { exact: true }).click()
    await added.getByLabel('Field key').fill('department')
    await added.getByLabel('Field type').selectOption('select')
    await added.getByLabel('Choices').fill('Community\nEmergency')
    await schema.getByRole('button', { name: 'Save fields' }).click()
    await expect(schema).toBeHidden()
    await expect(
      page.getByText('List fields saved as a draft. Publish the field changes before putting updated items live.'),
    ).toBeVisible()
    await expect(
      page
        .locator('header')
        .filter({ has: page.getByRole('heading', { name: 'E2E Newsroom', exact: true }) })
        .getByText('Draft', { exact: true }),
    ).toBeVisible()
    await listAction(page, 'Publish field changes')
    await expect(page.getByText('List fields published. Updated items can now be published.')).toBeVisible()
    await expect(
      page
        .locator('header')
        .filter({ has: page.getByRole('heading', { name: 'E2E Newsroom', exact: true }) })
        .getByText('Live', { exact: true }),
    ).toBeVisible()

    const stored = await one<{ fields: { key: string; type: string; options?: string[] }[]; same: boolean }>(
      `SELECT version.fields, collection.draft_schema_version_id=collection.published_schema_version_id AS same
         FROM collections collection JOIN collection_schema_versions version
           ON version.id=collection.draft_schema_version_id WHERE collection.id=$1`,
      [collectionId],
    )
    expect(stored.same).toBe(true)
    expect(stored.fields.at(-1)).toEqual(
      expect.objectContaining({
        key: 'department',
        type: 'select',
        options: ['Community', 'Emergency'],
      }),
    )
    await testInfo.attach('collections-empty-to-schema-desktop', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })

  test('edits typed records, chooses governed media, and keeps saved drafts private', async ({ page }) => {
    test.setTimeout(90000)
    await page.route('**/media/' + MEDIA_ID + '/*', route =>
      route.fulfill({ path: resolve('../apps/admin/public/cms-samples/r8-landscape.png'), contentType: 'image/png' }),
    )
    await openCollections(page)
    await page.getByRole('link', { name: /E2E Newsroom/ }).click()
    await page.getByRole('button', { name: 'Add item' }).click()
    await fillStory(page, {
      title: 'Community response opens',
      summary: '<p>Neighbors gathered to help.</p>',
      date: '2026-08-24',
      url: '/stories/community-response',
      category: 'Response',
      department: 'Community',
    })
    const imageField = page.locator('.collection-field').filter({ hasText: 'Lead image' })
    await imageField.getByRole('button', { name: 'Choose from Media' }).click()
    const media = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await expect(media.getByRole('option').filter({ hasText: 'community-response.jpg' })).toBeVisible()
    await capture(page, 'list-picker-ready')
    await media.getByLabel('Search images', { exact: true }).fill('No such image exists')
    await expect(media.getByRole('heading', { name: 'No images match', exact: true })).toBeVisible()
    await capture(page, 'list-picker-empty-search')
    await media.getByLabel('Search images', { exact: true }).clear()
    await media.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(media).toBeHidden()
    await expect(imageField.locator('img')).toHaveCount(0)
    await imageField.getByRole('button', { name: 'Choose from Media', exact: true }).click()
    await expect(media.getByRole('option').filter({ hasText: 'community-response.jpg' })).toBeVisible()
    await media.getByRole('option').filter({ hasText: 'community-response.jpg' }).click()
    await expect(media.getByRole('button', { name: 'Use this image', exact: true })).toBeEnabled()
    await page.route('**/api/sites/*/media?**', route =>
      route.fulfill({ status: 503, json: { error: 'The image library is temporarily unavailable.' } }),
    )
    await media.getByRole('button', { name: 'Refresh library', exact: true }).click()
    await expect(media.getByRole('alert')).toContainText(
      'The image library could not be fully refreshed. Your current image is unchanged.',
    )
    await expect(media.getByRole('button', { name: 'Use this image', exact: true })).toBeDisabled()
    await expect(media.getByRole('heading', { name: 'No images yet', exact: true })).toHaveCount(0)
    await capture(page, 'list-picker-unavailable')
    await page.unroute('**/api/sites/*/media?**')
    await media.getByRole('button', { name: 'Refresh library', exact: true }).click()
    await expect(media.getByRole('option').filter({ hasText: 'community-response.jpg' })).toBeVisible()
    await media.getByRole('option').filter({ hasText: 'community-response.jpg' }).click()
    await media.getByRole('button', { name: 'Use this image', exact: true }).click()
    await expect(imageField.getByText('Volunteers coordinating a community response')).toBeVisible()
    await expect(page.getByText('Unsaved changes')).toBeVisible()
    // The record is recognisable in the list by its picture, as in V1. The
    // record keeps the public delivery address; the admin shows the image's own
    // preview. (These seeded fixtures have no files, so only the address is checked.)
    await expect(imageField.locator('img')).toHaveAttribute('src', /^\/media\/[0-9a-f-]{36}\/thumbnail$/)

    await saveItem(page)
    await expect(record(page, 'Community response opens').locator('img')).toHaveAttribute(
      'src',
      /^\/media\/[0-9a-f-]{36}\/thumbnail$/,
    )
    const privateState = await one<{
      values: Record<string, unknown>
      published_version_id: string | null
      entry_revision: string
      published_entry_revision: string
    }>(
      `SELECT version.values,entry.published_version_id,collection.entry_revision,collection.published_entry_revision
         FROM collection_entries entry JOIN collection_entry_versions version ON version.id=entry.draft_version_id
         JOIN collections collection ON collection.id=entry.collection_id
        WHERE entry.collection_id=$1 AND entry.stable_key='new-item'`,
      [collectionId],
    )
    expect(privateState.published_version_id).toBeNull()
    expect(privateState.entry_revision).not.toBe(privateState.published_entry_revision)
    expect(privateState.values.image).toEqual({
      src: `/media/${MEDIA_ID}/wide`,
      alt: 'Volunteers coordinating a community response',
      decorative: false,
    })
    expect(Object.keys(privateState.values.image as object).sort()).toEqual(['alt', 'decorative', 'src'])

    await page.getByRole('button', { name: 'Publish list' }).click()
    const publication = page.getByRole('alertdialog')
    await expect(publication).toContainText('Community response opens')
    await expect(publication).toContainText('Add to the live list')
    await expect(publication).toContainText('Other saved work stays private until published.')
    await publication.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(publication).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish list', exact: true })).toBeFocused()
    expect(
      (
        await one<{ live: string | null }>(
          'SELECT published_version_id AS live FROM collection_entries WHERE collection_id=$1',
          [collectionId],
        )
      ).live,
    ).toBeNull()
    await page.getByRole('button', { name: 'Publish list' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish this list', exact: true }).click()
    await expect(page.getByText('1 item is now live.')).toBeVisible()
    const liveState = await one<{
      same_version: boolean
      same_revision: boolean
      published_archived_at: Date | null
    }>(
      `SELECT entry.draft_version_id=entry.published_version_id AS same_version,
              collection.entry_revision=collection.published_entry_revision AS same_revision,
              entry.published_archived_at
         FROM collection_entries entry JOIN collections collection ON collection.id=entry.collection_id
        WHERE entry.collection_id=$1 AND entry.stable_key='new-item'`,
      [collectionId],
    )
    expect(liveState).toMatchObject({ same_version: true, same_revision: true, published_archived_at: null })
  })

  test('reorders with named and pointer controls, then duplicates, archives, restores and filters', async ({
    page,
  }) => {
    await openCollections(page)
    await page.getByRole('link', { name: /E2E Newsroom/ }).click()
    await openRecord(page, 'Community response opens')
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
    await page.getByLabel('Headline').fill('Second response story')
    await saveItem(page)
    await page.getByRole('button', { name: 'Add item' }).click()
    await fillStory(page, {
      title: 'Third response story',
      summary: '<p>A third update.</p>',
      date: '2026-08-26',
      url: '/stories/third-response',
      category: 'Update',
      department: 'Emergency',
    })
    await saveItem(page)

    await page.getByRole('button', { name: 'Actions for Third response story', exact: true }).click()
    await page.getByRole('button', { name: 'Move Third response story up' }).click()
    await expect(activeRecords(page).locator('strong')).toHaveText([
      'Community response opens',
      'Third response story',
      'Second response story',
    ])

    await record(page, 'Community response opens').dragTo(record(page, 'Second response story'))
    await expect(activeRecords(page).locator('strong')).toHaveText([
      'Third response story',
      'Second response story',
      'Community response opens',
    ])
    await openRecord(page, 'Second response story')
    await page.getByRole('button', { name: 'Hide from list', exact: true }).click()
    await saveItem(page)
    await page.getByRole('group', { name: 'Filter items' }).getByRole('button', { name: 'Hidden', exact: true }).click()
    await expect(record(page, 'Second response story')).toBeVisible()
    await openRecord(page, 'Second response story')
    await page.getByRole('button', { name: 'Show in list', exact: true }).click()
    await saveItem(page)
    await page.getByRole('group', { name: 'Filter items' }).getByRole('button', { name: 'All', exact: true }).click()
    await expect(record(page, 'Second response story')).toBeVisible()
    await openRecord(page, 'Second response story')
    await page.getByRole('button', { name: 'Hide from list', exact: true }).click()
    await saveItem(page)

    await page.getByLabel('Search items').fill('Third response')
    await expect(record(page, 'Third response story')).toBeVisible()
    await expect(record(page, 'Community response opens')).toHaveCount(0)
    await page.getByLabel('Search items').fill('')
    await page.getByRole('group', { name: 'Filter items' }).getByRole('button', { name: 'Draft', exact: true }).click()
    await expect(record(page, 'Third response story')).toBeVisible()

    const order = await withDatabase(
      async client =>
        (
          await client.query<{
            title: string
            sort_index: number
            archived: boolean
          }>(
            `SELECT version.values->>'title' AS title,entry.sort_index,entry.archived_at IS NOT NULL AS archived
         FROM collection_entries entry JOIN collection_entry_versions version ON version.id=entry.draft_version_id
        WHERE entry.collection_id=$1 ORDER BY entry.sort_index`,
            [collectionId],
          )
        ).rows,
    )
    expect(order.filter(entry => !entry.archived).map(entry => entry.title)).toEqual([
      'Third response story',
      'Community response opens',
    ])
    expect(order.find(entry => entry.title === 'Second response story')).toMatchObject({ archived: true })
    // Cancelling a new duplicate leaves no saved ghost or extra version.
    await openRecord(page, 'Third response story')
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
    await page.getByLabel('Headline').fill('Cancelled duplicate')
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(
      await one<{ count: string }>(`SELECT count(*) FROM collection_entries WHERE collection_id=$1`, [collectionId]),
    ).toMatchObject({ count: '3' })
    await expect(record(page, 'Cancelled duplicate')).toHaveCount(0)
  })

  test('previews CSV failures, imports valid rows, and exports formula-like text safely', async ({ page }) => {
    await openCollections(page)
    await page.getByRole('link', { name: /E2E Newsroom/ }).click()
    await page.getByRole('group', { name: 'Filter items' }).getByRole('button', { name: 'All', exact: true }).click()
    await openRecord(page, 'Third response story')
    await page.getByLabel('Headline').fill('=SUM(1,1)')
    await saveItem(page)
    await page.getByRole('button', { name: 'Import / Export', exact: true }).click()
    await page.getByRole('button', { name: 'Import / Export CSV', exact: true }).click()
    const csv = page.getByRole('dialog', { name: 'CSV import & export' })
    const downloadPromise = page.waitForEvent('download')
    await csv.getByRole('button', { name: 'Download CSV' }).click()
    const download = await downloadPromise
    const path = await download.path()
    expect(path).not.toBeNull()
    const exported = await readFile(path!, 'utf8')
    expect(exported).toContain(`"'=SUM(1,1)"`)

    const header = 'title,summary,image,published_on,story_url,category,department'
    await csv
      .getByLabel('CSV source')
      .fill(`${header}\nImported story,<p>Imported</p>,,2026-02-30,/stories/imported,News,Community`)
    await expect(csv.getByRole('heading', { name: '1 row needs attention' })).toBeVisible()
    await expect(csv.getByText(/Row 2.*calendar date/)).toBeVisible()
    await expect(csv.getByRole('button', { name: /Add .* to draft/ })).toHaveCount(0)

    await csv
      .getByLabel('CSV source')
      .fill(`${header}\nImported story,<p>Imported</p>,,2026-08-27,/stories/imported,News,Community`)
    await expect(csv.getByRole('heading', { name: '1 row ready to add' })).toBeVisible()
    await csv.getByRole('button', { name: 'Add 1 to draft' }).click()
    await expect(record(page, 'Imported story')).toBeVisible()
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByText('List draft saved. The live site is unchanged.')).toBeVisible()
  })

  test('protects a dirty draft from accidental reload and restores the saved baseline', async ({ page }) => {
    await openCollections(page)
    await page.getByRole('link', { name: /E2E Newsroom/ }).click()
    await openRecord(page, 'Imported story')
    const title = page.getByLabel('Headline')
    await title.fill('Unsaved imported story')
    await expect(page.getByText('Unsaved changes')).toBeVisible()

    // Cancelling the browser's own beforeunload prompt wedges the automation
    // channel (the page survives, the CDP session does not), so the dismissal
    // half is asserted at the event layer: a dirty workspace cancels the
    // cancelable beforeunload event, and a clean one lets it pass.
    expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
    await title.fill('Imported story')
    await expect(page.getByText('Unsaved changes')).toHaveCount(0)
    expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)

    await title.fill('Unsaved imported story')
    await expect(page.getByText('Unsaved changes')).toBeVisible()
    page.once('dialog', async dialog => {
      expect(dialog.type()).toBe('beforeunload')
      await dialog.accept()
    })
    await page.reload()
    await expect(record(page, 'Imported story')).toBeVisible()
    await openRecord(page, 'Imported story')
    await expect(page.getByLabel('Headline')).toHaveValue('Imported story')
  })

  test('enforces contributor, editor, and site-administrator boundaries in the real UI', async ({ page }) => {
    await openCollections(page, 'contributor@example.test')
    await page.getByRole('link', { name: /E2E Newsroom/ }).click()
    await expect(page.getByRole('button', { name: 'More list actions', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish list' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New list', exact: true })).toHaveCount(0)
    await openRecord(page, 'Imported story')
    await page.getByLabel('Category').fill('Contributor draft')
    await saveItem(page)

    await page.context().clearCookies()
    await openCollections(page, 'editor@example.test')
    await page.getByRole('link', { name: /E2E Newsroom/ }).click()
    await expect(page.getByRole('button', { name: 'More list actions', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish list' })).toBeEnabled()
    await page.getByRole('button', { name: 'Publish list' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish this list', exact: true }).click()
    await expect(page.getByText(/items are now live|item is now live/)).toBeVisible()

    await page.context().clearCookies()
    await openCollections(page, SITE_ADMIN_EMAIL)
    await page.getByRole('link', { name: /E2E Newsroom/ }).click()
    await expect(page.getByRole('button', { name: 'More list actions', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'More list actions', exact: true }).click()
    await expect(page.getByRole('button', { name: 'New list', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'List settings', exact: true })).toBeVisible()
  })

  test('keeps the full workspace usable at tablet width', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 900, height: 1100 })
    await openCollections(page)
    await page.getByRole('link', { name: /E2E Newsroom/ }).click()
    await expect(page.getByLabel('List', { exact: true })).toBeVisible()
    const results = page.getByRole('list', { name: 'E2E Newsroom items' })
    await expect(results).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1100 })
      const heading = page.locator('[class*="recordHeader"]').first(),
        row = results
          .getByRole('listitem')
          .first()
          .getByRole('button', { name: /^Edit / })
          .first()
      const header = await heading.locator(':scope > span').nth(2).boundingBox(),
        value = await row.locator(':scope > span').nth(1).boundingBox()
      expect(Math.abs(header!.x - value!.x), 'Record details stay under their own heading').toBeLessThan(4)
    }
    await page.setViewportSize({ width: 900, height: 1100 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const bounds = await results.boundingBox()
    expect(bounds!.width).toBeGreaterThan(650)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(900)
    await openRecord(page, 'Imported story')
    await expect(page.getByLabel('Headline')).toBeVisible()
    await testInfo.attach('collections-tablet', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })
})
