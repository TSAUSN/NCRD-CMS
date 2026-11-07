import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'
import { createStoryDraft } from '../../../apps/admin/src/lib/stories-create.ts'
import { processMediaBytes } from '../../../apps/worker/src/media.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../../packages/platform/src/local/index.ts'
test('Coming up keeps undated stories private through Cancel, chooses a day and queues two exact stories independently', async ({
  page,
  browser,
}) => {
  test.setTimeout(240000)
  const f = await sawsoFixture(true),
    worker = 'calendar-' + randomUUID(),
    mediaId = randomUUID(),
    folder = resolve('../.r8-progress/round3/story-calendar', browser.browserType().name()),
    title = '[Calendar story]'
  let pulse: ReturnType<typeof setInterval> | undefined
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  try {
    await mkdir(folder, { recursive: true })
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/publishing')
    const publish = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
    await publish.click()
    await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible({
      timeout: 90000,
    })
    const sample = page.getByRole('checkbox', { name: /Publish with sample content/ })
    if (await sample.isVisible()) await sample.check()
    const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
    if (await reason.isVisible())
      await reason.fill('Reviewed the complete private sample site for calendar verification.')
    await publish.click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 90000 })
    const bytes = await readFile(resolve('../apps/admin/public/cms-samples/r8-landscape.png')),
      processed = await processMediaBytes(
        {
          intentId: randomUUID(),
          siteId: f.siteId,
          uploadObjectKey: 'calendar/input.png',
          finalKeyPrefix: 'calendar/' + mediaId + '/',
          declaredMime: 'image/png',
          declaredBytes: bytes.length,
        },
        bytes,
      ),
      store = createFilesystemMediaStore(defaultMediaRoot()),
      original = processed.original
    await store.put(original.objectKey, original.data, original.mimeType)
    await f.client.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'[Story photo].png','[Photo description]',$5,$6,$7,$8,'ready')",
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
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    let revision = String(
      (await f.client.query('SELECT entry_revision FROM collections WHERE id=$1', [f.collectionId])).rows[0]!
        .entry_revision,
    )
    const entries: Array<Awaited<ReturnType<typeof createStoryDraft>>> = []
    for (const name of [title, '[Other ready story]']) {
      const created = await createStoryDraft(f.client, f.siteId, f.collectionId, revision, {
        title: name,
        summary: '[Story description]',
        tags: ['health'],
        region: 'africa',
        published_date: '',
        body: '<p>[Full story text]</p>',
        photoId: mediaId,
        photoAlt: '[Photo description]',
      })
      revision = created.revision
      entries.push(created)
    }
    const rows = (
      await f.client.query(
        'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.id',
        [f.collectionId],
      )
    ).rows
    await f.client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      f.collectionId,
      revision,
      JSON.stringify(
        rows.map(row => ({
          id: row.id,
          stableKey: row.stable_key,
          values: entries.some(e => e.entryId === row.id) ? { ...row.values, reviewed: true } : row.values,
        })),
      ),
    ])
    await f.client.query('COMMIT')
    await f.pool.query(
      "INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','synthetic-calendar-e2e')",
      [worker],
    )
    pulse = setInterval(() => {
      void f.pool.query('UPDATE job_heartbeats SET last_seen_at=now() WHERE worker_id=$1', [worker]).catch(() => {})
    }, 5000)
    const snapshot = async () =>
        JSON.stringify(
          (
            await f.pool.query(
              'SELECT e.*,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.id',
              [f.collectionId],
            )
          ).rows,
        ),
      before = await snapshot(),
      base = '/sites/' + f.siteId + '/stories'
    await page.goto(base + '?view=soon')
    await expect(page.getByRole('heading', { name: 'Ready, no date yet', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choose day for ' + title, exact: true })).toBeVisible()
    await capture('calendar')
    await page.getByRole('searchbox', { name: 'Find a ready story', exact: true }).fill('Other ready')
    await expect(page.getByRole('button', { name: 'Choose day for ' + title, exact: true })).toHaveCount(0)
    await page.getByRole('searchbox', { name: 'Find a ready story', exact: true }).fill('')
    await page.getByRole('button', { name: 'Choose day for ' + title, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Choose a story day', exact: true })
    await dialog.getByLabel('Story day', { exact: true }).fill('2026-11-02')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(await snapshot()).toBe(before)
    const date = new Date(Date.now() + 7 * 86400000),
      day = date.toISOString().slice(0, 10)
    while (!(await page.locator('time[datetime="' + day + '"]').count()))
      await page.getByRole('button', { name: 'Next month', exact: true }).click()
    if (browser.browserType().name() === 'chromium') {
      await page
        .getByRole('button', { name: 'Choose day for ' + title, exact: true })
        .dragTo(page.locator('time[datetime="' + day + '"]').locator('..'))
      await expect(dialog).toBeVisible()
    } else await page.getByRole('button', { name: 'Choose day for ' + title, exact: true }).click()
    await dialog.getByLabel('Story day', { exact: true }).fill(day)
    await capture('day-choice')
    await dialog.getByRole('button', { name: 'Review schedule', exact: true }).click()
    const schedule = page.getByRole('dialog', { name: 'Publish later', exact: true })
    await expect(schedule).toBeVisible({ timeout: 90000 })
    await expect(schedule.locator('input[type=datetime-local]')).toHaveValue(day + 'T09:00')
    await expect(schedule.getByRole('list').first()).toContainText(title)
    await expect(schedule.getByRole('list').first()).not.toContainText('[Other ready story]')
    if (await schedule.getByRole('checkbox', { name: /Publish with sample content/ }).isVisible())
      await schedule.getByRole('checkbox', { name: /Publish with sample content/ }).check()
    const why = schedule.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
    if (await why.isVisible()) await why.fill('Reviewed isolated sample story and calendar schedule.')
    await capture('schedule-review')
    await schedule.getByRole('button', { name: 'Schedule selected changes', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Scheduling request saved.' })).toBeVisible({
      timeout: 90000,
    })
    const job = (
        await f.pool.query(
          "SELECT id,item_id,status FROM scheduled_actions WHERE site_id=$1 AND item_type='release' ORDER BY created_at DESC LIMIT 1",
          [f.siteId],
        )
      ).rows[0]!,
      snapshotItems = (await f.pool.query('SELECT snapshot FROM site_releases WHERE id=$1', [job.item_id])).rows[0]!
        .snapshot
    expect(snapshotItems.find((item: { entryIds?: string[] }) => item.entryIds)?.entryIds).toEqual([
      entries[0]!.entryId,
    ])
    expect(job.status).toBe('pending')
    const privateRows = (
      await f.pool.query(
        'SELECT e.published_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.id=ANY($1::uuid[]) ORDER BY e.id',
        [entries.map(e => e.entryId)],
      )
    ).rows
    expect(privateRows.every(row => row.published_version_id === null)).toBe(true)
    expect(privateRows.find(row => row.values.title === '[Other ready story]')!.values.published_date).toBe('')
    const exceptChosen = (rows: Array<{ id: string }>) => rows.filter(row => row.id !== entries[0]!.entryId)
    expect(exceptChosen(JSON.parse(await snapshot()))).toEqual(exceptChosen(JSON.parse(before)))
    await page.goto(base + '?view=soon')
    while (!(await page.locator('time[datetime="' + day + '"]').count()))
      await page.getByRole('button', { name: 'Next month', exact: true }).click()
    await expect(
      page.getByRole('group', { name: 'Story calendar' }).getByRole('link', { name: new RegExp('Calendar story') }),
    ).toContainText('Scheduled')
    await capture('scheduled')
    const otherDay = new Date(date.getTime() + 86400000).toISOString().slice(0, 10)
    await page.getByRole('button', { name: 'Choose day for [Other ready story]', exact: true }).click()
    await dialog.getByLabel('Story day', { exact: true }).fill(otherDay)
    await dialog.getByRole('button', { name: 'Review schedule', exact: true }).click()
    await expect(schedule).toBeVisible({ timeout: 90000 })
    await expect(schedule).toContainText('You can keep working on other stories.')
    await expect(schedule.locator('input[type=datetime-local]')).toHaveValue(otherDay + 'T09:00')
    if (await schedule.getByRole('checkbox', { name: /Publish with sample content/ }).isVisible())
      await schedule.getByRole('checkbox', { name: /Publish with sample content/ }).check()
    if (await why.isVisible()) await why.fill('Reviewed the second isolated Story schedule.')
    await schedule.getByRole('button', { name: 'Schedule selected changes', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Scheduling request saved.' })).toBeVisible({
      timeout: 90000,
    })
    const both = (
      await f.pool.query(
        "SELECT j.id,j.status,r.id AS release_id,r.snapshot FROM scheduled_actions j JOIN site_releases r ON r.id=j.item_id WHERE j.site_id=$1 AND j.item_type='release' ORDER BY j.created_at",
        [f.siteId],
      )
    ).rows
    expect(both).toHaveLength(2)
    expect(both.every(row => row.status === 'pending')).toBe(true)
    expect(both.find(row => row.id === job.id)!.snapshot).toEqual(snapshotItems)
    for (const row of both)
      expect(row.snapshot.find((item: { entryIds?: string[] }) => item.entryIds)?.entryIds).toHaveLength(1)
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const scopes = (
      await f.client.query(
        'SELECT app.story_release_fingerprint(r.site_id,r.snapshot)=sc.before_hash AS current FROM site_releases r JOIN site_release_story_scopes sc ON sc.release_id=r.id WHERE r.id=ANY($1::uuid[])',
        [both.map(row => row.release_id)],
      )
    ).rows
    expect(scopes).toHaveLength(2)
    expect(scopes.every(row => row.current === true)).toBe(true)
    await f.client.query('COMMIT')
    await page.goto(base + '?view=soon')
    while (!(await page.locator('time[datetime="' + otherDay + '"]').count()))
      await page.getByRole('button', { name: 'Next month', exact: true }).click()
    await expect(
      page.getByRole('group', { name: 'Story calendar' }).getByRole('link').filter({ hasText: 'Scheduled' }),
    ).toHaveCount(2)
    await expect(page.getByRole('heading', { name: 'No undated stories ready', exact: true })).toBeVisible()
    await capture('two-scheduled')
    await page.getByRole('heading', { name: 'No undated stories ready', exact: true }).scrollIntoViewIfNeeded()
    await capture('ready-empty')
    await page.goto(base + '/' + entries[0]!.entryId)
    await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('[Changed scheduled Story description]')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Story draft saved')
    await page.goto(base + '?view=soon')
    while (!(await page.locator('time[datetime="' + otherDay + '"]').count()))
      await page.getByRole('button', { name: 'Next month', exact: true }).click()
    const calendar = page.getByRole('group', { name: 'Story calendar' })
    await expect(calendar.getByRole('link', { name: /Calendar story/ })).toContainText('Needs review')
    await expect(calendar.getByRole('link', { name: /Calendar story/ })).toHaveAttribute(
      'href',
      base + '/' + entries[0]!.entryId,
    )
    await expect(calendar.getByRole('link', { name: /Other ready story/ })).toContainText('Scheduled')
    await capture('needs-review')
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    for (const row of both) await f.client.query('SELECT app.cancel_page_schedule($1)', [row.id])
    await f.client.query('COMMIT')
  } finally {
    if (pulse) clearInterval(pulse)
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [worker])
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
