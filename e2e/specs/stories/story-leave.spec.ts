import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { processMediaBytes } from '../../../apps/worker/src/media.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../../packages/platform/src/local/index.ts'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'
test('Story search navigation keeps words, refuses failed saves and resumes the chosen page after a private save or discard', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/story-leave/' + info.project.name),
    title = '[Leave destination ' + randomUUID().slice(0, 8) + ']'
  await mkdir(folder, { recursive: true })
  const store = createFilesystemMediaStore(defaultMediaRoot()),
    objects: string[] = []
  let native = 0
  page.on('dialog', async dialog => {
    native++
    await dialog.dismiss()
  })
  try {
    const entry = (
        await f.pool.query(
          "SELECT e.id,e.published_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND v.values->>'title'=$2",
          [f.collectionId, 'Primary Health Care to Support the Growing Chikankata Community'],
        )
      ).rows[0]!,
      editor = (await f.pool.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    await f.client.query("SELECT app.set_site_membership($1,$2,'editor')", [editor, f.siteId])
    const destination = (
      await f.client.query('SELECT app.create_page($1,$2,$3) AS id', [
        f.siteId,
        'leave-' + randomUUID().slice(0, 8),
        title,
      ])
    ).rows[0]!.id
    await f.client.query("SELECT app.save_page_draft($1,0,'[]','{}')", [destination])
    await f.client.query('COMMIT')
    await signIn(page, 'editor@example.test')
    const storyUrl = '/sites/' + f.siteId + '/stories/' + entry.id
    await page.goto(storyUrl)
    const search = page.getByRole('dialog', { name: 'Search or jump to', exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    const attempt = async () => {
      await page.keyboard.press('Control+k')
      await expect(search).toBeVisible()
      await search.getByRole('combobox').fill(title)
      await search.getByRole('option').filter({ hasText: title }).click()
      await expect(search).toHaveCount(0)
      await expect(leave).toBeVisible()
    }
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      }
    }
    await page.getByLabel('Summary', { exact: true }).fill('[Saved while leaving]')
    await attempt()
    await capture('saved-story-choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page.getByLabel('Summary', { exact: true })).toHaveValue('[Saved while leaving]')
    await expect(search).toHaveCount(0)
    await attempt()
    await page.keyboard.press('Escape')
    await expect(leave).toHaveCount(0)
    await page.getByLabel('Title', { exact: true }).fill('')
    await attempt()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Check the title')
    await expect(page).toHaveURL(storyUrl)
    await capture('saved-story-save-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await page.getByLabel('Title', { exact: true }).fill(entry.values.title)
    await attempt()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL('/pages/' + destination)
    const saved = (
      await f.pool.query(
        'SELECT v.values,e.published_version_id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.id=$1',
        [entry.id],
      )
    ).rows[0]!
    expect(saved.values.summary).toBe('[Saved while leaving]')
    expect(saved.published_version_id).toBe(entry.published_version_id)
    const count = (
      await f.pool.query('SELECT count(*)::int AS n FROM collection_entries WHERE collection_id=$1', [f.collectionId])
    ).rows[0]!.n
    await page.goto('/sites/' + f.siteId + '/stories/new')
    await page.getByLabel('Title', { exact: true }).fill('[Unsaved new story]')
    await page.getByLabel('Summary', { exact: true }).fill('[New private words]')
    await attempt()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Choose a lead photo')
    await capture('new-story-save-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('[Unsaved new story]')
    await attempt()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL('/pages/' + destination)
    expect(
      (await f.pool.query('SELECT count(*)::int AS n FROM collection_entries WHERE collection_id=$1', [f.collectionId]))
        .rows[0]!.n,
    ).toBe(count)
    const mediaId = randomUUID(),
      bytes = await readFile(resolve('../apps/admin/public/cms-samples/r8-landscape.png')),
      processed = await processMediaBytes(
        {
          intentId: randomUUID(),
          siteId: f.siteId,
          uploadObjectKey: 'story-leave/input.png',
          finalKeyPrefix: 'story-leave/' + mediaId + '/',
          declaredMime: 'image/png',
          declaredBytes: bytes.length,
        },
        bytes,
      ),
      original = processed.original
    for (const file of [original, ...processed.variants]) {
      await store.put(file.objectKey, file.data, file.mimeType)
      objects.push(file.objectKey)
    }
    await f.pool.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'[Story photo].png','[Sample landscape]',$5,$6,$7,$8,'ready')",
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
    for (const variant of processed.variants)
      await f.pool.query(
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
    await page.goto('/sites/' + f.siteId + '/stories/new')
    await page.getByLabel('Title', { exact: true }).fill('[Saved new story on leaving]')
    await page.getByLabel('Summary', { exact: true }).fill('[Saved new story summary]')
    await page.getByRole('button', { name: 'Choose photo', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await picker.getByRole('option').first().click()
    await picker.getByLabel('Image description', { exact: true }).fill('[Sample photo description]')
    await picker.getByRole('button', { name: 'Use this image', exact: true }).click()
    await attempt()
    await capture('new-story-save-choice')
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL('/pages/' + destination)
    const created = (
      await f.pool.query(
        "SELECT v.values,e.published_version_id,p.published_version_id AS article_public FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id JOIN pages p ON p.site_id=$1 AND app.page_path(p.slug)=v.values->>'story_url' WHERE e.collection_id=$2 AND v.values->>'title'='[Saved new story on leaving]'",
        [f.siteId, f.collectionId],
      )
    ).rows
    expect(created).toHaveLength(1)
    expect(created[0].values).toMatchObject({
      summary: '[Saved new story summary]',
      photo: { alt: '[Sample photo description]' },
    })
    expect(created[0].published_version_id).toBeNull()
    expect(created[0].article_public).toBeNull()
    expect(
      (await f.pool.query('SELECT count(*)::int AS n FROM collection_entries WHERE collection_id=$1', [f.collectionId]))
        .rows[0]!.n,
    ).toBe(count + 1)
    expect(native).toBe(0)
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
    for (const key of objects) await store.remove(key)
  }
})
