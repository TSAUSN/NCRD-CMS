import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { test, expect, type Page } from '@playwright/test'
import { signIn } from '../helpers.ts'
const folder = resolve('../.r8-progress/step-4/media-replacement')
async function capture(page: Page, name: string) {
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await page.screenshot({ path: resolve(folder, `${name}-${width}.png`), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
async function fixture() {
  let released = false
  const pool = new Pool({
      connectionString: `postgres://cms:cms@${process.env['E2E_PG_HOST'] ?? '127.0.0.1'}:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
    }),
    client = await pool.connect(),
    suffix = randomUUID().slice(0, 8),
    from = randomUUID(),
    to = randomUUID()
  try {
    await client.query('BEGIN')
    const actor = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const theme = (
      await client.query(
        "SELECT v.tokens FROM themes t JOIN theme_versions v ON v.id=t.published_version_id JOIN sites s ON s.id=t.site_id WHERE s.slug='demo'",
      )
    ).rows[0]!.tokens
    const site = (
      await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        'images-' + suffix,
        'Image replacement review',
        'resource',
        'images-' + suffix + '.staging.localhost',
        JSON.stringify(theme),
        '[]',
      ])
    ).rows[0]!.id
    for (const [email, role] of [
      ['editor@example.test', 'editor'],
      ['contributor@example.test', 'contributor'],
    ]) {
      const person = (await client.query('SELECT id FROM app_users WHERE email=$1', [email])).rows[0]!.id
      await client.query('SELECT app.set_site_membership($1,$2,$3)', [person, site, role])
    }
    for (const [id, name] of [
      [from, 'Original community picture.png'],
      [to, 'New community picture with a deliberately long and readable filename.png'],
    ]) {
      await client.query(
        `INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status,uploaded_by) VALUES($1,$2,$3,$4,$5,'A community gathering',1200,800,20000,'image/png','ready',$6)`,
        [id, site, 'r8-images/' + id, 'a'.repeat(64), name, actor],
      )
      for (const kind of ['wide', 'thumbnail'])
        await client.query(
          `INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,$2,$3,$4,1200,800,20000,'image/webp')`,
          [id, kind, `r8-images/${id}/${kind}`, 'b'.repeat(64)],
        )
    }
    const hero = (
        await client.query(
          "SELECT d.id,max(v.version)::int AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='hero' AND d.site_id IS NULL GROUP BY d.id",
        )
      ).rows[0]!,
      feature = (
        await client.query(
          "SELECT d.id,max(v.version)::int AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='feature' AND d.site_id IS NULL GROUP BY d.id",
        )
      ).rows[0]!
    const page = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, '', 'Community welcome']))
      .rows[0]!.id
    const content = [
      {
        section_def_id: hero.id,
        section_def_version: hero.version,
        label: 'Welcome',
        hidden: false,
        hidden_at: [],
        values: { heading: 'Community welcome', intro: 'A complete local page.' },
      },
      {
        section_def_id: feature.id,
        section_def_version: feature.version,
        label: 'Community picture',
        hidden: false,
        hidden_at: [],
        values: {
          picture: {
            media_id: from,
            variant: 'wide',
            src: `/media/${from}/wide`,
            alt: 'The original placement description',
            decorative: false,
          },
          more: { href: 'https://example.test/about', text: 'Learn more', target: '_self' },
        },
      },
    ]
    await client.query('SELECT app.save_page_draft($1,0,$2,$3)', [
      page,
      JSON.stringify(content),
      JSON.stringify({ description: 'A complete local image replacement page.' }),
    ])
    const frames = (
        await client.query(
          'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
          [site],
        )
      ).rows,
      header = frames.find(row => row.kind === 'header')!,
      footer = frames.find(row => row.kind === 'footer')!
    header.content.brand.logoMediaId = from
    await client.query('SELECT app.save_global_elements_draft($1,$2,$3,$4,$5)', [
      site,
      header.revision,
      footer.revision,
      JSON.stringify(header.content),
      JSON.stringify(footer.content),
    ])
    await client.query('SELECT app.publish_theme($1,1)', [site])
    await client.query('SELECT app.publish_global_elements($1,2,2)', [site])
    await client.query("SELECT app.publish_page($1,1,3,NULL,'[]')", [page])
    const nav = (await client.query('SELECT revision FROM navigations WHERE site_id=$1', [site])).rows[0]!
    await client.query('SELECT app.publish_navigation($1,$2)', [site, nav.revision])
    const list = (
      await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        site,
        'portraits',
        'Community portraits',
        'portraits',
        JSON.stringify([
          { key: 'name', label: 'Name', type: 'text', required: true },
          { key: 'photo', label: 'Photo', type: 'image', required: false },
        ]),
        JSON.stringify({
          schemaVersion: 1,
          titleField: 'name',
          subtitleField: null,
          imageField: 'photo',
          groupField: null,
        }),
      ])
    ).rows[0]!.collection_id
    await client.query('SELECT app.save_collection_entries($1,0,$2)', [
      list,
      JSON.stringify([
        {
          id: null,
          stableKey: 'jordan',
          values: {
            name: 'Jordan',
            photo: { src: `/media/${from}/wide`, alt: 'A portrait of Jordan', decorative: false },
          },
        },
      ]),
    ])
    await client.query('COMMIT')
    async function close() {
      // The intercepted images only exist inside this spec. Later Home visits must not request them.
      try {
        await pool.query("UPDATE sites SET status='archived',archived_at=COALESCE(archived_at,now()) WHERE id=$1", [
          site,
        ])
      } finally {
        await pool.end()
      }
    }
    return { pool, site, page, from, to, list, close }
  } catch (error) {
    await client.query('ROLLBACK')
    client.release()
    released = true
    await pool.end()
    throw error
  } finally {
    if (!released) client.release()
  }
}
async function open(page: Page, f: Awaited<ReturnType<typeof fixture>>, email = 'editor@example.test') {
  await page.route(/\/media\/[0-9a-f-]{36}\/(wide|thumbnail)/, route =>
    route.fulfill({ path: resolve('../apps/admin/public/cms-samples/r8-landscape.png') }),
  )
  await signIn(page, email)
  await page.goto(`/sites/${f.site}/media`)
  await page.locator('.media-asset-open').filter({ hasText: 'Original community picture.png' }).click()
  await page.getByRole('button', { name: 'Replace image…', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Choose from the media library', exact: true })).toBeVisible()
  const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
  expect(await picker.evaluate(node => node.matches(':modal'))).toBe(true)
  await expect(picker.getByRole('listbox', { name: 'Available images', exact: true }).getByRole('option')).toHaveCount(
    1,
  )
}
async function choose(page: Page) {
  await page
    .getByRole('dialog', { name: 'Choose from the media library', exact: true })
    .getByRole('listbox', { name: 'Available images', exact: true })
    .getByRole('option')
    .click()
  await page.getByRole('button', { name: /^Review replacement for / }).click()
  const review = page.getByRole('dialog', { name: 'Replace image in saved drafts', exact: true })
  await expect(review.getByRole('checkbox')).toHaveCount(3)
  return review
}
test('image replacement reviews destinations and saves selected drafts while keeping live images and list data', async ({
  page,
}) => {
  test.setTimeout(90000)
  const f = await fixture(),
    errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await open(page, f)
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await picker.getByLabel('Search images', { exact: true }).fill('No matching picture')
    await expect(picker.getByRole('heading', { name: 'No images match', exact: true })).toBeVisible()
    await capture(page, 'picker-empty-search')
    await picker.getByLabel('Search images', { exact: true }).clear()
    await capture(page, 'picker-recent-long')
    const review = await choose(page)
    await capture(page, 'review-destinations')
    await review.getByRole('checkbox', { name: /Community portraits/ }).uncheck()
    await review.getByRole('button', { name: 'Replace in 2 destinations', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Saved in 2 destinations', exact: true })).toBeVisible()
    await capture(page, 'replacement-saved')
    const current = (
      await f.pool.query(
        'SELECT p.published_version_id,p.draft_version_id,v.content,d.content AS draft FROM pages p JOIN page_versions v ON v.id=p.published_version_id JOIN page_versions d ON d.id=p.draft_version_id WHERE p.id=$1',
        [f.page],
      )
    ).rows[0]!
    expect(current.published_version_id).not.toBe(current.draft_version_id)
    expect(current.content[1].values.picture.media_id).toBe(f.from)
    expect(current.draft[1].values.picture.media_id).toBe(f.to)
    expect(current.draft[1].values.picture.alt).toBe('The original placement description')
    expect(
      (
        await f.pool.query(
          'SELECT v."values" FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1',
          [f.list],
        )
      ).rows[0]!.values.photo.src,
    ).toBe(`/media/${f.from}/wide`)
    const frame = (
      await f.pool.query(
        "SELECT v.content AS live,d.content AS draft FROM global_elements g JOIN global_element_versions v ON v.id=g.published_version_id JOIN global_element_versions d ON d.id=g.draft_version_id WHERE g.site_id=$1 AND g.kind='header'",
        [f.site],
      )
    ).rows[0]!
    expect(frame.live.brand.logoMediaId).toBe(f.from)
    expect(frame.draft.brand.logoMediaId).toBe(f.to)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    expect(errors).toEqual([])
  } finally {
    await f.close()
  }
})
test('image replacement refuses an outdated review and offers a fresh review without losing the new edit', async ({
  page,
}) => {
  test.setTimeout(90000)
  const f = await fixture()
  try {
    await open(page, f)
    const review = await choose(page)
    const client = await f.pool.connect()
    try {
      await client.query('BEGIN')
      const actor = (await client.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
      await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
      const row = (
        await client.query(
          'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.page],
        )
      ).rows[0]!
      row.content[0].values.heading = 'A newer saved welcome'
      await client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
        f.page,
        row.revision,
        JSON.stringify(row.content),
        JSON.stringify(row.meta),
      ])
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    await review.getByRole('button', { name: 'Replace in 3 destinations', exact: true }).click()
    await expect(review.getByRole('alert')).toContainText('changed')
    await capture(page, 'replacement-stale-error')
    await review.getByRole('button', { name: 'Review again', exact: true }).click()
    await expect(review.getByRole('checkbox')).toHaveCount(3)
    await review.getByRole('button', { name: 'Replace in 3 destinations', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Saved in 3 destinations', exact: true })).toBeVisible()
    expect(
      (
        await f.pool.query(
          'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.page],
        )
      ).rows[0]!.content[0].values.heading,
    ).toBe('A newer saved welcome')
  } finally {
    await f.close()
  }
})
test('contributors can replace content images and see that shared Site look needs an administrator', async ({
  page,
}) => {
  test.setTimeout(90000)
  const f = await fixture()
  try {
    await open(page, f, 'contributor@example.test')
    const review = await choose(page)
    await expect(review.getByRole('checkbox', { name: /Header and footer/ })).toBeDisabled()
    await expect(review.getByRole('button', { name: 'Replace in 2 destinations', exact: true })).toBeEnabled()
    await capture(page, 'contributor-destinations')
    await review.getByRole('button', { name: 'Close Replace image in saved drafts', exact: true }).click()
    await expect(review).toBeHidden()
  } finally {
    await f.close()
  }
})

test('an unused image explains that previous saved versions keep their original picture', async ({ page }) => {
  test.setTimeout(90000)
  const f = await fixture()
  try {
    await page.route(/\/media\/[0-9a-f-]{36}\/(wide|thumbnail)/, route =>
      route.fulfill({ path: resolve('../apps/admin/public/cms-samples/r8-landscape.png') }),
    )
    await signIn(page, 'editor@example.test')
    await page.goto(`/sites/${f.site}/media`)
    await page
      .locator('.media-asset-open')
      .filter({ hasText: 'New community picture with a deliberately long and readable filename.png' })
      .click()
    await page.getByRole('button', { name: 'Replace image…', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await picker.getByRole('listbox', { name: 'Available images', exact: true }).getByRole('option').click()
    await picker.getByRole('button', { name: /^Review replacement for / }).click()
    const review = page.getByRole('dialog', { name: 'Replace image in saved drafts', exact: true })
    await expect(review.getByRole('heading', { name: 'No current uses', exact: true })).toBeVisible()
    await expect(review.getByRole('button', { name: 'Replace in 0 destinations', exact: true })).toBeDisabled()
    await capture(page, 'replacement-unused')
    await review.getByRole('button', { name: 'Choose another image', exact: true }).click()
    await expect(picker).toBeVisible()
  } finally {
    await f.close()
  }
})

test('opening an upload does not call the available current picture missing, and cancel keeps it', async ({ page }) => {
  const f = await fixture()
  try {
    await page.route(/\/media\/[0-9a-f-]{36}\/(wide|thumbnail)/, route =>
      route.fulfill({ path: resolve('../apps/admin/public/cms-samples/r8-landscape.png') }),
    )
    await signIn(page, 'editor@example.test')
    await page.goto(`/pages/${f.page}?section=1`)
    await page.getByRole('button', { name: 'Choose from media library', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await expect(picker.getByRole('option', { name: /Original community picture/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(picker.getByRole('button', { name: 'Use this image', exact: true })).toBeEnabled()
    await picker.getByRole('button', { name: 'Upload', exact: true }).click()
    await expect(picker.getByRole('region', { name: 'Upload an image', exact: true })).toBeVisible()
    await expect(picker.getByText(/The current image is not available in this library/)).toHaveCount(0)
    await expect(picker.getByRole('button', { name: 'Use this image', exact: true })).toBeDisabled()
    await capture(page, 'upload-current-image-available')
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(picker).toBeHidden()
    await expect(page.locator('#slot-1-picture-src')).toHaveValue(`/media/${f.from}/wide`)
    await expect(page.locator('#slot-1-picture-alt')).toHaveValue('The original placement description')
    // A real missing placement must still be explained after a full refresh.
    await page.route(`**/api/sites/${f.site}/media?*`, route =>
      route.fulfill({
        json: {
          assets: [],
          total: 0,
          page: 1,
          pageSize: 24,
          pageCount: 1,
          facets: {
            folders: [],
            tags: [],
            scopes: { site: 0, shared: 0 },
            statuses: { ready: 0, processing: 0, failed: 0, deleted: 0 },
          },
        },
      }),
    )
    await page.getByRole('button', { name: 'Choose from media library', exact: true }).click()
    await expect(picker.getByText(/The current image is not available in this library/)).toBeVisible()
    await expect(picker.getByRole('button', { name: 'Use this image', exact: true })).toBeDisabled()
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('#slot-1-picture-src')).toHaveValue(`/media/${f.from}/wide`)
  } finally {
    await f.close()
  }
})
