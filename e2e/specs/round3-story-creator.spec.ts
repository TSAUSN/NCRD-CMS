import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
import { createStoryDraft } from '../../apps/admin/src/lib/stories-create.ts'
import { processMediaBytes } from '../../apps/worker/src/media.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../packages/platform/src/local/index.ts'

test('a content creator saves and previews one private story, with atomic retries and no general page or publication rights', async ({
  page,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/story-creator/' + info.project.name),
    email = 'story-creator-' + randomUUID().slice(0, 8) + '@example.test',
    mediaId = randomUUID(),
    title = '[Content creator story]'
  let creator = ''
  const objects: string[] = []
  async function as(actor: string, fn: () => Promise<void>, commit = false) {
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    try {
      await fn()
      await f.client.query(commit ? 'COMMIT' : 'ROLLBACK')
    } catch (error) {
      await f.client.query('ROLLBACK')
      throw error
    }
  }
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
    }
  }
  try {
    await mkdir(folder, { recursive: true })
    const bytes = await readFile(resolve('../apps/admin/public/cms-samples/r8-landscape.png')),
      processed = await processMediaBytes(
        {
          intentId: randomUUID(),
          siteId: f.siteId,
          uploadObjectKey: 'creator/input.png',
          finalKeyPrefix: 'creator/' + mediaId + '/',
          declaredMime: 'image/png',
          declaredBytes: bytes.length,
        },
        bytes,
      ),
      store = createFilesystemMediaStore(defaultMediaRoot()),
      original = processed.original
    await store.put(original.objectKey, original.data, original.mimeType)
    objects.push(original.objectKey)
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
      objects.push(variant.objectKey)
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
    creator = (await f.client.query('SELECT app.provision_user($1,$2) id', [email, '[Name]'])).rows[0]!.id
    await f.client.query('SELECT app.set_site_membership($1,$2,$3)', [creator, f.siteId, 'contributor'])
    await f.client.query('UPDATE app_users SET auth_subject=$1 WHERE id=$2', ['local|' + email, creator])
    await f.client.query('COMMIT')
    const revision = String(
        (await f.pool.query('SELECT entry_revision FROM collections WHERE id=$1', [f.collectionId])).rows[0]!
          .entry_revision,
      ),
      input = {
        title,
        summary: '[Private story description]',
        tags: ['health'],
        region: 'africa',
        published_date: '',
        photoId: mediaId,
        photoAlt: '[Photo description]',
        body: '<p>[Story words]</p>',
      },
      request = randomUUID(),
      before = (
        await f.pool.query(
          'SELECT id,revision,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id',
          [f.siteId],
        )
      ).rows
    await as(creator, async () => {
      const first = await createStoryDraft(f.client, f.siteId, f.collectionId, revision, input, request),
        retry = await createStoryDraft(f.client, f.siteId, f.collectionId, revision, input, request)
      expect(retry).toEqual({ ...first, replayed: true })
      expect(
        (await f.client.query('SELECT published_version_id FROM pages WHERE id=$1', [first.pageId])).rows[0]!
          .published_version_id,
      ).toBeNull()
      expect(
        (await f.client.query('SELECT count(*)::int n FROM story_draft_receipts WHERE request_id=$1', [request]))
          .rows[0]!.n,
      ).toBe(1)
    })
    expect(
      (
        await f.pool.query(
          'SELECT id,revision,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id',
          [f.siteId],
        )
      ).rows,
    ).toEqual(before)
    expect(
      (await f.pool.query('SELECT count(*)::int n FROM story_draft_receipts WHERE request_id=$1', [request])).rows[0]!
        .n,
    ).toBe(0)
    await as(creator, async () => {
      await expect(
        f.client.query('SELECT app.create_page($1,$2,$3)', [f.siteId, 'ordinary-creator-page', '[Ordinary page]']),
      ).rejects.toThrow(/not permitted to manage pages/)
    })
    await as(creator, async () => {
      await expect(
        f.client.query('SELECT app.publish_story_entries($1,$2,$3)', [f.collectionId, revision, []]),
      ).rejects.toThrow(/not permitted|publisher|publish/)
    })
    const foreign = (
      await f.pool.query('SELECT id FROM collection_entries WHERE collection_id=$1 AND archived_at IS NULL LIMIT 1', [
        f.collectionId,
      ])
    ).rows[0]!.id
    await as(creator, async () => {
      await expect(
        f.client.query('SELECT app.create_private_story_page($1,$2)', [f.collectionId, foreign]),
      ).rejects.toThrow(/own private story/)
    })
    await as(creator, async () => {
      await expect(
        f.client.query('SELECT app.create_private_story_page($1,$2)', [randomUUID(), foreign]),
      ).rejects.toThrow(/Stories unavailable/)
    })
    await as(creator, async () => {
      await expect(
        createStoryDraft(f.client, f.siteId, f.collectionId, revision, { ...input, photoId: randomUUID() }),
      ).rejects.toThrow(/ready photo/)
    })
    await as(creator, async () => {
      const rows = (
          await f.client.query(
            'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.id',
            [f.collectionId],
          )
        ).rows,
        key = 'creator-attempt-' + randomUUID()
      await f.client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        f.collectionId,
        revision,
        JSON.stringify([
          ...rows.map(row => ({ id: row.id, stableKey: row.stable_key, values: row.values })),
          {
            id: null,
            stableKey: key,
            values: {
              ...rows[0]!.values,
              title: '[Ordinary page attempt]',
              summary: '[Description]',
              story_url: '/ordinary-page',
              photo: { src: '/media/' + mediaId + '/wide', alt: '[Photo description]', decorative: false },
            },
          },
        ]),
      ])
      const entry = (
        await f.client.query('SELECT id FROM collection_entries WHERE collection_id=$1 AND stable_key=$2', [
          f.collectionId,
          key,
        ])
      ).rows[0]!.id
      await expect(
        f.client.query('SELECT app.create_private_story_page($1,$2)', [f.collectionId, entry]),
      ).rejects.toThrow(/story address/)
    })
    await as(creator, async () => {
      await expect(createStoryDraft(f.client, randomUUID(), f.collectionId, revision, input)).rejects.toThrow(
        /unavailable/,
      )
    })
    await signIn(page, email)
    await page.goto('/?site=' + f.siteId)
    await page.getByRole('link', { name: 'Add a story', exact: true }).click()
    await expect(page).toHaveURL('/sites/' + f.siteId + '/stories/new')
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Schedule', exact: true })).toHaveCount(0)
    await expect(page.getByText('Advanced', { exact: true })).toHaveCount(0)
    await page.getByLabel('Title', { exact: true }).fill('[Discarded story]')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL('/sites/' + f.siteId + '/stories')
    expect(
      (
        await f.pool.query(
          'SELECT id,revision,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id',
          [f.siteId],
        )
      ).rows,
    ).toEqual(before)
    await page.getByRole('button', { name: 'Add story', exact: true }).click()
    await page.getByLabel('Title', { exact: true }).fill(title)
    await page.getByLabel('Summary', { exact: true }).fill(input.summary)
    await page.getByRole('textbox', { name: 'Story text', exact: true }).fill('[Story words]')
    await page.getByRole('button', { name: 'Health', exact: true }).click()
    await page.getByRole('button', { name: 'Africa', exact: true }).click()
    await page.getByRole('button', { name: 'Choose photo', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await picker.getByRole('option').first().click()
    await picker.getByRole('button', { name: 'Use this image', exact: true }).click()
    await capture('new-private-story')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page).toHaveURL(/\/stories\/[0-9a-f-]+$/)
    const entryId = page.url().split('/').at(-1)!,
      saved = (
        await f.pool.query(
          "SELECT e.id,e.published_version_id,v.values,p.id page_id,p.published_version_id page_public FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id JOIN pages p ON p.site_id=e.site_id AND app.page_path(p.slug)=v.values->>'story_url' WHERE e.id=$1",
          [entryId],
        )
      ).rows[0]!
    expect(saved.values.title).toBe(title)
    expect(saved.published_version_id).toBeNull()
    expect(saved.page_public).toBeNull()
    await capture('saved-private-story')
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const preview = page.getByRole('dialog', { name: 'Saved story preview', exact: true })
    await expect(
      page.frameLocator('iframe[title="Saved story preview"]').getByRole('heading', { level: 1 }),
    ).toHaveText(title, { timeout: 30000 })
    await expect(
      page.getByRole('status').filter({ hasText: 'Story draft saved. Nothing is published.' }),
    ).toBeAttached()
    await capture('private-preview')
    await preview.getByRole('button', { name: 'Done', exact: true }).click()
    await as(creator, async () => {
      await expect(
        f.client.query('SELECT app.create_private_story_page($1,$2)', [f.collectionId, entryId]),
      ).rejects.toThrow()
    })
    expect((await f.pool.query('SELECT count(*)::int n FROM pages WHERE site_id=$1', [f.siteId])).rows[0]!.n).toBe(
      before.length + 1,
    )
    expect((await f.pool.query('SELECT count(*)::int n FROM story_source_checks')).rows[0]!.n).toBe(0)
  } finally {
    for (const object of objects) await createFilesystemMediaStore(defaultMediaRoot()).remove(object)
    await f.client.query('ROLLBACK').catch(() => {})
    if (creator) {
      await as(
        f.actor,
        async () => {
          await f.client.query("SELECT app.set_user_status($1,'disabled')", [creator])
        },
        true,
      )
      await f.pool.query('DELETE FROM site_memberships WHERE site_id=$1 AND user_id=$2', [f.siteId, creator])
    }
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
