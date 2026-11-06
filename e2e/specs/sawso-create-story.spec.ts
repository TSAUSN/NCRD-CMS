import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
import { rawRequest } from './http.ts'
import { processMediaBytes } from '../../apps/worker/src/media.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../packages/platform/src/local/index.ts'
test('a site admin adds a photo story through Stories and publishes its automatic page, Health feed and newsroom', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(360000)
  const f = await sawsoFixture(true, true),
    email = 'new-story-' + randomUUID().slice(0, 8) + '@example.test',
    mediaId = randomUUID(),
    title = '[New Health story — sample content]',
    folder = resolve('../.r8-progress/round3/new-story-screen/' + info.project.name)
  await mkdir(folder, { recursive: true })
  try {
    const bytes = await readFile(resolve('../apps/admin/public/cms-samples/r8-landscape.png')),
      processed = await processMediaBytes(
        {
          intentId: randomUUID(),
          siteId: f.siteId,
          uploadObjectKey: 'story-fixture/input.png',
          finalKeyPrefix: 'story-fixture/' + mediaId + '/',
          declaredMime: 'image/png',
          declaredBytes: bytes.length,
        },
        bytes,
      ),
      store = createFilesystemMediaStore(defaultMediaRoot()),
      original = processed.original
    await store.put(original.objectKey, original.data, original.mimeType)
    await f.client.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'Story photo (sample).png','Landscape illustration (sample)',$5,$6,$7,$8,'ready')",
      [
        mediaId,
        f.siteId,
        original.objectKey,
        original.sha256,
        original.width,
        original.height,
        original.bytes,
        original.mimeType,
      ],
    )
    await f.client.query('UPDATE media SET focal=$2 WHERE id=$1', [mediaId, JSON.stringify({ x: 0.2, y: 0.8 })])
    for (const variant of processed.variants) {
      await store.put(variant.objectKey, variant.data, variant.mimeType)
      await f.client.query(
        'INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          mediaId,
          variant.kind,
          variant.objectKey,
          variant.sha256,
          variant.width,
          variant.height,
          variant.bytes,
          variant.mimeType,
        ],
      )
    }
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const admin = (await f.client.query('SELECT app.provision_user($1,$2) AS id', [email, 'New story admin (sample)']))
      .rows[0]!.id
    await f.client.query('SELECT app.set_site_membership($1,$2,$3)', [admin, f.siteId, 'site_admin'])
    await f.client.query('UPDATE app_users SET auth_subject=$1 WHERE id=$2', ['local|' + email, admin])
    await f.client.query('COMMIT')
    await signIn(page, email)
    await page.goto('/sites/' + f.siteId + '/publishing')
    const firstPublish = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
    await firstPublish.click()
    const firstSample = page.getByRole('checkbox', { name: /Publish with sample content/ })
    await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible({
      timeout: 90000,
    })
    if (await firstSample.isVisible()) await firstSample.check()
    const firstReason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
    if (await firstReason.isVisible())
      await firstReason.fill('Reviewing the complete private sample site before testing individual story publication.')
    await firstPublish.click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 90000 })
    await page.goto('/sites/' + f.siteId + '/stories')
    await page.getByRole('button', { name: 'Add story', exact: true }).click()
    const other = page.getByRole('main')
    await other.getByLabel('Title', { exact: true }).fill('[Other undated draft]')
    await other.getByLabel('Summary', { exact: true }).fill('[Private description]')
    await other.getByRole('button', { name: 'Health', exact: true }).click()
    await other.getByRole('button', { name: 'Africa', exact: true }).click()
    await other.getByRole('button', { name: 'Choose photo', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Choose from the media library', exact: true })
      .getByRole('option')
      .first()
      .click()
    await page
      .getByRole('dialog', { name: 'Choose from the media library', exact: true })
      .getByRole('button', { name: 'Use this image', exact: true })
      .click()
    await other.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page).toHaveURL(/\/stories\/[0-9a-f-]+$/)
    await page.goto('/sites/' + f.siteId + '/stories')
    await page.getByRole('button', { name: 'Add story', exact: true }).click()
    const dialog = page.getByRole('main')
    await dialog.getByLabel('Story date (optional)', { exact: true }).fill(new Date().toISOString().slice(0, 10))
    await dialog.getByLabel('Title', { exact: true }).fill(title)
    await dialog.getByLabel('Summary', { exact: true }).fill('[A new story summary — sample content]')
    await dialog.getByRole('button', { name: 'Health', exact: true }).click()
    await dialog.getByRole('button', { name: 'Africa', exact: true }).click()
    await dialog.getByRole('button', { name: 'Choose photo', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await picker.getByRole('option').first().click()
    await picker.getByRole('button', { name: 'Use this image', exact: true }).click()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: resolve(folder, 'add-' + width + '.png') })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page).toHaveURL(/\/stories\/[0-9a-f-]+$/)
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(title)
    await expect(page.getByText('Advanced', { exact: true })).toBeHidden()
    const where = page.getByRole('region', { name: 'Where it will show', exact: true }),
      pageFeeds = where.getByRole('list', { name: 'Page feeds', exact: true })
    await expect(where).not.toContainText('could not be checked')
    await expect(pageFeeds).toContainText('Health')
    await expect(pageFeeds).toContainText('Newsroom')
    await expect(pageFeeds).not.toContainText('Education')
    const ownId = page.url().split('/').at(-1)!,
      beforePlacement = (await f.client.query('SELECT draft_version_id FROM collection_entries WHERE id=$1', [ownId]))
        .rows[0]!.draft_version_id
    await page.getByRole('button', { name: 'Education', exact: true }).click()
    await expect(pageFeeds).toContainText('Education')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await where.scrollIntoViewIfNeeded()
      await page.screenshot({ path: resolve(folder, 'placement-' + width + '.png') })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.getByRole('button', { name: 'Education', exact: true }).click()
    await expect(pageFeeds).not.toContainText('Education')
    expect(
      (await f.client.query('SELECT draft_version_id FROM collection_entries WHERE id=$1', [ownId])).rows[0]!
        .draft_version_id,
    ).toBe(beforePlacement)
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(
      page.frameLocator('iframe[title="Saved story preview"]').getByRole('heading', { level: 1 }),
    ).toHaveText(title, { timeout: 30000 })
    await page
      .getByRole('dialog', { name: 'Saved story preview', exact: true })
      .getByRole('button', { name: 'Done', exact: true })
      .click()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'editor-' + width + '.png') })
    }
    await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('[Updated description before review]')
    await page.getByRole('main').getByRole('button', { name: 'Publish', exact: true }).click()
    const first = page.getByRole('button', { name: 'Review first site publication', exact: true })
    await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true }).or(first)).toBeVisible({
      timeout: 90000,
    })
    if (await first.isVisible()) {
      await first.click()
      await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
      await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible({
        timeout: 90000,
      })
    }
    const publish = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
    const sample = page.getByRole('checkbox', { name: /Publish with sample content/ })
    if (await sample.isVisible()) await sample.check()
    const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
    if (await reason.isVisible()) await reason.fill('Reviewing a private sample story in an isolated local fixture.')
    const storyReview = page
      .locator('[aria-label="Selected changes review"]')
      .getByRole('listitem')
      .filter({ hasText: 'Story: ' + title })
      .first()
    await storyReview.getByRole('button', { name: 'View changes', exact: true }).click()
    const comparison = page.getByRole('dialog', { name: 'Changes to Story: ' + title, exact: true })
    await expect(comparison.getByRole('heading', { name: 'Saved changes', exact: true })).toBeVisible()
    await expect(comparison.getByText('[Updated description before review]', { exact: true })).toBeVisible()
    expect(await comparison.textContent()).not.toContain('[Other undated draft]')
    expect(await comparison.locator('dd').allTextContents()).not.toEqual(
      expect.arrayContaining([expect.stringContaining('/media/')]),
    )
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'story-comparison-' + width + '.png') })
    }
    await comparison.getByRole('button', { name: 'Done', exact: true }).click()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByRole('table', { name: 'Saved changes ready to publish', exact: true })).toHaveCount(0)
      await expect(page.getByLabel('Selected changes review')).toContainText('Story: ' + title)
      await page.screenshot({ path: resolve(folder, 'story-review-' + width + '.png') })
    }
    await publish.click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 60000 })
    const otherDraft = (
      await f.client.query(
        "SELECT e.published_version_id,v.values,p.published_version_id AS page_public FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id JOIN pages p ON p.site_id=$1 AND app.page_path(p.slug)=v.values->>'story_url' WHERE e.collection_id=$2 AND v.values->>'title'='[Other undated draft]'",
        [f.siteId, f.collectionId],
      )
    ).rows[0]!
    expect(otherDraft.published_version_id).toBeNull()
    expect(otherDraft.page_public).toBeNull()
    expect(otherDraft.values.published_date).toBe('')
    const row = (
        await f.client.query(
          "SELECT v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.published_version_id WHERE e.collection_id=$1 AND v.values->>'title'=$2",
          [f.collectionId, title],
        )
      ).rows[0]!.values,
      context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } }),
      publicPage = await context.newPage()
    try {
      expect(row.summary).toBe('[Updated description before review]')
      expect(row.body).toBe('')
      expect(row.body_is_sample).toBe(false)
      expect(row.photo.focal).toEqual({ x: 0.2, y: 0.8 })
      for (const path of ['/ways-we-help/health', '/newsroom', row.story_url]) {
        await publicPage.goto('http://' + f.hostname + `:${E2E_PORTS.site}` + path)
        await expect(publicPage.getByRole('heading', { name: title, exact: true })).toBeVisible()
        expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      }
      await expect(publicPage.getByRole('link', { name: 'Read the full story', exact: true })).toBeHidden()
      await expect(publicPage.locator('.core-story-detail img').first()).toHaveAttribute(
        'style',
        /object-position:20% 80%/,
      )
    } finally {
      await context.close()
    }
    const workerId = 'story-review-' + randomUUID()
    await f.pool.query("INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','synthetic-e2e')", [
      workerId,
    ])
    const pulse = setInterval(() => {
      void f.pool.query('UPDATE job_heartbeats SET last_seen_at=now() WHERE worker_id=$1', [workerId]).catch(() => {})
    }, 5000)
    try {
      const entryId = (
        await f.client.query(
          "SELECT e.id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND v.values->>'title'=$2",
          [f.collectionId, title],
        )
      ).rows[0]!.id
      await page.goto('/sites/' + f.siteId + '/stories/' + entryId)
      await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('[Scheduled description]')
      await page.getByRole('button', { name: 'Schedule', exact: true }).click()
      const schedule = page.getByRole('dialog', { name: 'Publish later', exact: true })
      await expect(schedule).toBeVisible({ timeout: 90000 })
      const sample = schedule.getByRole('checkbox', { name: /Publish with sample content/ })
      if (await sample.isVisible()) await sample.check()
      const reason = schedule.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
      if (await reason.isVisible())
        await reason.fill('Reviewing a local sample Story schedule without running an external service.')
      const when = new Date(Date.now() + 3600000),
        local =
          [
            when.getFullYear(),
            String(when.getMonth() + 1).padStart(2, '0'),
            String(when.getDate()).padStart(2, '0'),
          ].join('-') +
          'T' +
          String(when.getHours()).padStart(2, '0') +
          ':' +
          String(when.getMinutes()).padStart(2, '0')
      await schedule.locator('input[type=datetime-local]').fill(local)
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        await page.screenshot({ path: resolve(folder, 'story-schedule-' + width + '.png') })
      }
      await schedule.getByRole('button', { name: 'Schedule selected changes', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Scheduling request saved.' })).toBeVisible({
        timeout: 90000,
      })
      const job = (
          await f.client.query(
            "SELECT id,status,item_id FROM scheduled_actions WHERE site_id=$1 AND item_type='release' ORDER BY created_at DESC LIMIT 1",
            [f.siteId],
          )
        ).rows[0]!,
        planned = (await f.client.query('SELECT snapshot FROM site_releases WHERE id=$1', [job.item_id])).rows[0]!
          .snapshot
      expect(job.status).toBe('pending')
      expect(planned.filter((item: { type: string }) => item.type === 'collection_entries')[0].entryIds).toEqual([
        entryId,
      ])
      const live = (
        await f.client.query(
          'SELECT v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.published_version_id WHERE e.id=$1',
          [entryId],
        )
      ).rows[0]!.values
      expect(live.summary).toBe('[Updated description before review]')
      // This test-owned heartbeat has no worker consumer. Timer execution is checked
      // separately over real leases; cancel this pending UI intention normally.
      await f.client.query('BEGIN')
      await f.client.query('SET LOCAL ROLE cms_authenticated_user')
      await f.client.query("SELECT set_config('app.user_id',$1,true)", [admin])
      await f.client.query('SELECT app.cancel_page_schedule($1)', [job.id])
      await f.client.query('COMMIT')
      const foreignSite = (await f.client.query('SELECT id FROM sites WHERE id<>$1 LIMIT 1', [f.siteId])).rows[0]!.id
      await f.client.query('BEGIN')
      await f.client.query('SET LOCAL ROLE cms_authenticated_user')
      await f.client.query("SELECT set_config('app.user_id',$1,true)", [admin])
      await expect(f.client.query('SELECT * FROM app.release_readiness_pages($1)', [foreignSite])).rejects.toThrow(
        /not permitted/,
      )
      await f.client.query('ROLLBACK')
      // An intentionally hidden canonical article becomes a 404. Its missing
      // heading is not a defect on a page that the public route resolver omits.
      for (const hidden of [true, false]) {
        await page.goto('/sites/' + f.siteId + '/stories?q=' + encodeURIComponent(title))
        await page
          .getByRole('article', { name: title, exact: true })
          .getByRole('checkbox', { name: 'Hide from feeds', exact: true })
          .setChecked(hidden)
        await expect(page.getByText('Story changes saved.', { exact: true })).toBeVisible()
        await page
          .getByRole('article', { name: title, exact: true })
          .getByRole('link', { name: 'Edit story', exact: true })
          .click()
        await page.getByRole('button', { name: 'Publish', exact: true }).click()
        const review = page.getByLabel('Selected changes review')
        await expect(review).toBeVisible({ timeout: 90000 })
        const releaseId = new URL(page.url()).searchParams.get('release')!,
          reports = (await f.client.query('SELECT preview_report FROM site_releases WHERE id=$1', [releaseId])).rows[0]!
            .preview_report as { pageId: string; report: { blocking: { rule: string }[] } }[],
          publishedPages = (
            await f.client.query(
              'SELECT id FROM pages WHERE site_id=$1 AND published_version_id IS NOT NULL AND archived_at IS NULL',
              [f.siteId],
            )
          ).rows.map(record => record.id as string),
          articleId = (
            await f.client.query('SELECT id FROM pages WHERE site_id=$1 AND app.page_path(slug)=$2', [
              f.siteId,
              row.story_url,
            ])
          ).rows[0]!.id
        expect(reports.map(check => check.pageId).sort()).toEqual(
          publishedPages.filter(id => !hidden || id !== articleId).sort(),
        )
        expect(
          reports.flatMap(check => check.report.blocking).every(finding => finding.rule === 'sample_content'),
        ).toBe(true)
        await expect(
          page.getByRole('textbox', { name: 'Reason for publishing despite these findings', exact: true }),
        ).toHaveCount(0)
        const samples = page.getByRole('checkbox', { name: /Publish with sample content/ })
        if (await samples.isVisible()) await samples.check()
        await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
        await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
        await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 60000 })
        const articleResponse = await rawRequest({ host: f.hostname, path: row.story_url }),
          feedResponse = await rawRequest({ host: f.hostname, path: '/ways-we-help/health' }),
          sitemap = await page.request.get('/sites/' + f.siteId + '/settings/sitemap')
        expect(articleResponse.status).toBe(hidden ? 404 : 200)
        expect(feedResponse.status).toBe(200)
        expect(feedResponse.body.includes(title)).toBe(!hidden)
        expect(sitemap.status()).toBe(200)
        expect((await sitemap.text()).includes(row.story_url)).toBe(!hidden)
        // The fixture hostname is staging: its public sitemap stays disabled.
        expect((await rawRequest({ host: f.hostname, path: '/sitemap.xml' })).status).toBe(404)
      }
    } finally {
      clearInterval(pulse)
      await f.pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [workerId])
    }
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})

test('an undated story stays a private draft, preserves its real words and starts fresh after cancelling', async ({
  page,
}, info) => {
  test.setTimeout(150000)
  const f = await sawsoFixture(),
    mediaId = randomUUID(),
    folder = resolve('../.r8-progress/round3/new-story-screen/' + info.project.name),
    title = '[Undated story]'
  await mkdir(folder, { recursive: true })
  await mkdir(resolve('../.r8-progress/round3/new-story-screen/' + info.project.name), { recursive: true })
  try {
    const bytes = await readFile(resolve('../apps/admin/public/cms-samples/r8-landscape.png')),
      processed = await processMediaBytes(
        {
          intentId: randomUUID(),
          siteId: f.siteId,
          uploadObjectKey: 'undated/input.png',
          finalKeyPrefix: 'undated/' + mediaId + '/',
          declaredMime: 'image/png',
          declaredBytes: bytes.length,
        },
        bytes,
      ),
      store = createFilesystemMediaStore(defaultMediaRoot()),
      original = processed.original
    await store.put(original.objectKey, original.data, original.mimeType)
    await f.client.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'[Story photo].png','[Story photo description]',$5,$6,$7,$8,'ready')",
      [
        mediaId,
        f.siteId,
        original.objectKey,
        original.sha256,
        original.width,
        original.height,
        original.bytes,
        original.mimeType,
      ],
    )
    for (const variant of processed.variants) {
      await store.put(variant.objectKey, variant.data, variant.mimeType)
      await f.client.query(
        'INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          mediaId,
          variant.kind,
          variant.objectKey,
          variant.sha256,
          variant.width,
          variant.height,
          variant.bytes,
          variant.mimeType,
        ],
      )
    }
    const before = (
      await f.client.query('SELECT count(*)::int AS count FROM collection_entries WHERE collection_id=$1', [
        f.collectionId,
      ])
    ).rows[0]!.count
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/stories')
    await page.getByRole('button', { name: 'Add story', exact: true }).click()
    const dialog = page.getByRole('main')
    await expect(page).toHaveURL('/sites/' + f.siteId + '/stories/new')
    await expect(page.getByRole('navigation')).toHaveCount(0)
    await dialog.getByLabel('Title', { exact: true }).fill('[Cancelled story]')
    await dialog.getByRole('button', { name: 'Back', exact: true }).click()
    await page
      .getByRole('alertdialog', { name: 'Before you leave', exact: true })
      .getByRole('button', { name: 'Discard changes', exact: true })
      .click()
    await expect(page).toHaveURL('/sites/' + f.siteId + '/stories')
    expect(
      (
        await f.client.query('SELECT count(*)::int AS count FROM collection_entries WHERE collection_id=$1', [
          f.collectionId,
        ])
      ).rows[0]!.count,
    ).toBe(before)
    await page.getByRole('button', { name: 'Add story', exact: true }).click()
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('')
    await expect(dialog.getByLabel('Story date (optional)', { exact: true })).toHaveValue('')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: resolve(folder, 'empty-new-' + width + '.png') })
    }
    await dialog.getByLabel('Title', { exact: true }).fill(title)
    await dialog.getByLabel('Summary', { exact: true }).fill('[Story description]')
    await dialog.getByRole('textbox', { name: 'Story text', exact: true }).fill('[Authored before first save]')
    await dialog.getByLabel('Countries', { exact: true }).fill('[Country]')
    await dialog.getByRole('button', { name: 'Health', exact: true }).click()
    await dialog.getByRole('button', { name: 'Africa', exact: true }).click()
    await dialog.getByRole('button', { name: 'Choose photo', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Choose from the media library', exact: true })
      .getByRole('option')
      .first()
      .click()
    await page
      .getByRole('dialog', { name: 'Choose from the media library', exact: true })
      .getByRole('button', { name: 'Use this image', exact: true })
      .click()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: resolve(folder, 'undated-add-' + width + '.png') })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    const createUrl = page.url()
    let lost = false
    await page.route(createUrl, async route => {
      if (!lost && route.request().method() === 'POST') {
        lost = true
        await route.fetch()
        await route.abort('failed')
      } else await route.continue()
    })
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('draft result could not be confirmed')
    await expect(dialog.getByLabel('Title', { exact: true })).toBeDisabled()
    expect(
      (
        await f.client.query('SELECT count(*)::int AS count FROM collection_entries WHERE collection_id=$1', [
          f.collectionId,
        ])
      ).rows[0]!.count,
    ).toBe(before + 1)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'creation-uncertain-' + width + '.png') })
    }
    await page.unroute(createUrl)
    await dialog.getByRole('button', { name: 'Retry draft save', exact: true }).click()
    await expect(page).toHaveURL(/\/stories\/[0-9a-f-]+$/)
    await expect(page.getByLabel('Story date (optional)', { exact: true })).toHaveValue('')
    await expect(page.getByRole('textbox', { name: 'Story text', exact: true })).toContainText(
      '[Authored before first save]',
    )
    await expect(page.getByLabel('Countries', { exact: true })).toHaveValue('[Country]')
    const resize = page.getByRole('separator', { name: 'Resize Story settings', exact: true })
    await expect(resize).toHaveAttribute('aria-valuenow', '340')
    await expect(page.getByRole('region', { name: 'Where it will show', exact: true })).toContainText(
      'This site is private',
    )
    await expect(page.getByRole('region', { name: 'Where it will show', exact: true })).toContainText(
      'Choose a story date',
    )
    await expect(page.getByRole('textbox', { name: 'HTML source', exact: true })).toBeHidden()
    await page.getByRole('tab', { name: 'Advanced', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'HTML source', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Content', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'HTML source', exact: true })).toBeHidden()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: resolve(folder, 'writing-' + width + '.png') })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await resize.focus()
    await resize.press('End')
    await expect(resize).toHaveAttribute('aria-valuenow', '480')
    await page.reload()
    await expect(page.getByRole('separator', { name: 'Resize Story settings', exact: true })).toHaveAttribute(
      'aria-valuenow',
      '480',
    )
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'wide-panel-' + width + '.png') })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.getByRole('separator', { name: 'Resize Story settings', exact: true }).press('Home')
    await expect(page.getByRole('separator', { name: 'Resize Story settings', exact: true })).toHaveAttribute(
      'aria-valuenow',
      '340',
    )
    const description = page.getByRole('textbox', { name: 'Photo description (required)', exact: true })
    await expect(description).toHaveValue('[Story photo description]')
    await page.getByRole('button', { name: 'Change photo', exact: true }).click()
    const editPicker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await expect(editPicker.getByText('Is decorative', { exact: true })).toBeHidden()
    await editPicker.getByLabel('Image description', { exact: true }).fill('')
    await expect(editPicker.getByRole('button', { name: 'Use this image', exact: true })).toBeDisabled()
    await editPicker.getByLabel('Image description', { exact: true }).fill('[Cancelled description]')
    await page.keyboard.press('Escape')
    await expect(editPicker).toBeHidden()
    await expect(description).toHaveValue('[Story photo description]')
    await page.getByRole('button', { name: 'Change photo', exact: true }).click()
    const confirmedPicker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await confirmedPicker.getByLabel('Image description', { exact: true }).fill('[Photo described for this story]')
    await confirmedPicker.getByRole('button', { name: 'Use this image', exact: true }).click()
    await expect(description).toHaveValue('[Photo described for this story]')
    await page.getByText('Adjust focus point', { exact: true }).click()
    const focus = page.getByRole('button', { name: 'Choose focus point on image', exact: true })
    await focus.focus()
    await focus.press('Home')
    await focus.press('ArrowLeft')
    await expect(page.getByRole('img', { name: 'Card crop preview', exact: true })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Phone crop preview', exact: true })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Wide crop preview', exact: true })).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.getByRole('group', { name: 'Focus point', exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({
        path: resolve('../.r8-progress/round3/new-story-screen/' + info.project.name, 'photo-' + width + '.png'),
      })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.getByRole('textbox', { name: 'Story text', exact: true }).fill('[Ready story text]')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Story draft saved')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: resolve(folder, 'undated-editor-' + width + '.png') })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    const row = (
      await f.client.query(
        "SELECT e.id,v.values,e.published_version_id,p.published_version_id AS page_public FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id JOIN pages p ON p.site_id=$1 AND app.page_path(p.slug)=v.values->>'story_url' WHERE e.collection_id=$2 AND v.values->>'title'=$3",
        [f.siteId, f.collectionId, title],
      )
    ).rows[0]!
    expect(row.values.published_date).toBe('')
    expect(row.values.body).toContain('[Ready story text]')
    expect(row.values.body_is_sample).toBe(false)
    expect(row.values.photo).toMatchObject({ alt: '[Photo described for this story]', focal: { x: 0.49, y: 0.5 } })
    expect(row.published_version_id).toBeNull()
    expect(row.page_public).toBeNull()
    await page.getByRole('button', { name: 'Schedule', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Choose a story date')
    await expect(page.getByLabel('Story date (optional)', { exact: true })).toBeFocused()
    await page.getByLabel('Story date (optional)', { exact: true }).fill(new Date().toISOString().slice(0, 10))
    await page.getByRole('button', { name: 'Schedule', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Review first site publication', exact: true })).toBeVisible({
      timeout: 90000,
    })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'first-site-review-' + width + '.png') })
    }
    const editorUrl = page.url()
    await page.getByLabel('Title', { exact: true }).fill('[Unsaved story title]')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'leave-' + width + '.png') })
    }
    await page.keyboard.press('Escape')
    await expect(leave).toBeHidden()
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('[Unsaved story title]')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page).toHaveURL(editorUrl)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL('/sites/' + f.siteId + '/stories')
    await page.goto(editorUrl)
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(title)
    await page.getByLabel('Title', { exact: true }).fill('[Saved on leaving]')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.route(editorUrl, route =>
      route.request().method() === 'POST' ? route.abort('failed') : route.continue(),
    )
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('result could not be confirmed')
    await expect(page).toHaveURL(editorUrl)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'leave-error-' + width + '.png') })
    }
    await page.unroute(editorUrl)
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL('/sites/' + f.siteId + '/stories')
    const left = (
      await f.client.query(
        'SELECT v.values,e.published_version_id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.id=$1',
        [row.id],
      )
    ).rows[0]!
    expect(left.values.title).toBe('[Saved on leaving]')
    expect(left.published_version_id).toBeNull()
    expect(
      (
        await f.client.query('SELECT count(*)::int AS count FROM collection_entries WHERE collection_id=$1', [
          f.collectionId,
        ])
      ).rows[0]!.count,
    ).toBe(before + 1)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})

test('new-story Preview, Schedule and Publish save private words before opening their next step', async ({
  page,
}, info) => {
  test.setTimeout(150000)
  const f = await sawsoFixture(),
    mediaId = randomUUID(),
    folder = resolve('../.r8-progress/round3/new-story-screen/' + info.project.name)
  await mkdir(folder, { recursive: true })
  try {
    const bytes = await readFile(resolve('../apps/admin/public/cms-samples/r8-landscape.png')),
      processed = await processMediaBytes(
        {
          intentId: randomUUID(),
          siteId: f.siteId,
          uploadObjectKey: 'undated/input.png',
          finalKeyPrefix: 'undated/' + mediaId + '/',
          declaredMime: 'image/png',
          declaredBytes: bytes.length,
        },
        bytes,
      ),
      store = createFilesystemMediaStore(defaultMediaRoot()),
      original = processed.original
    await store.put(original.objectKey, original.data, original.mimeType)
    await f.client.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'[Story photo].png','[Story photo description]',$5,$6,$7,$8,'ready')",
      [
        mediaId,
        f.siteId,
        original.objectKey,
        original.sha256,
        original.width,
        original.height,
        original.bytes,
        original.mimeType,
      ],
    )
    for (const variant of processed.variants) {
      await store.put(variant.objectKey, variant.data, variant.mimeType)
      await f.client.query(
        'INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          mediaId,
          variant.kind,
          variant.objectKey,
          variant.sha256,
          variant.width,
          variant.height,
          variant.bytes,
          variant.mimeType,
        ],
      )
    }
    await signIn(page, 'root@example.test')
    for (const action of ['Preview', 'Schedule', 'Publish'] as const) {
      await page.goto('/sites/' + f.siteId + '/stories/new')
      await expect(page.getByRole('button', { name: action, exact: true })).toBeVisible()
      await page.getByLabel('Title', { exact: true }).fill('[New ' + action + ' story]')
      await page.getByLabel('Summary', { exact: true }).fill('[Description]')
      await page.getByRole('textbox', { name: 'Story text', exact: true }).fill('[Words before ' + action + ']')
      await page.getByLabel('Story date (optional)', { exact: true }).fill(new Date().toISOString().slice(0, 10))
      await page.getByRole('button', { name: 'Choose photo', exact: true }).click()
      await page
        .getByRole('dialog', { name: 'Choose from the media library', exact: true })
        .getByRole('option')
        .first()
        .click()
      await page
        .getByRole('dialog', { name: 'Choose from the media library', exact: true })
        .getByRole('button', { name: 'Use this image', exact: true })
        .click()
      await page.getByRole('main').getByRole('button', { name: action, exact: true }).click()
      if (action === 'Preview') {
        const preview = page.getByRole('dialog', { name: 'Saved story preview', exact: true })
        await expect(preview).toBeVisible()
        await expect(
          page.frameLocator('iframe[title="Saved story preview"]').getByRole('heading', { level: 1 }),
        ).toHaveText('[New Preview story]', { timeout: 30000 })
        await preview.getByRole('button', { name: 'Done', exact: true }).click()
      } else
        await expect(page.getByRole('button', { name: 'Review first site publication', exact: true })).toBeVisible({
          timeout: 90000,
        })
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        await page.screenshot({ path: resolve(folder, 'new-' + action.toLowerCase() + '-' + width + '.png') })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      }
      const rows = (
        await f.client.query(
          "SELECT e.published_version_id,v.values,p.published_version_id AS page_public FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id JOIN pages p ON p.site_id=$1 AND app.page_path(p.slug)=v.values->>'story_url' WHERE e.collection_id=$2 AND v.values->>'title'=$3",
          [f.siteId, f.collectionId, '[New ' + action + ' story]'],
        )
      ).rows
      expect(rows).toHaveLength(1)
      expect(rows[0]!.published_version_id).toBeNull()
      expect(rows[0]!.page_public).toBeNull()
      expect(rows[0]!.values.body).toContain('[Words before ' + action + ']')
      expect(rows[0]!.values.tags).toBe('')
    }
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
