import { E2E_PORTS } from '../test-ports.ts'
import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'
import { enableSiteStories } from '../../apps/admin/src/lib/stories-enable.ts'
import { createStoryDraft } from '../../apps/admin/src/lib/stories-create.ts'
import { saveStoryDetails } from '../../apps/admin/src/lib/stories-edit.ts'
import { submitSingleStoryReview, prepareSingleStoryReview } from '../../apps/admin/src/lib/story-review.ts'
import { processMediaBytes } from '../../apps/worker/src/media.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../packages/platform/src/local/index.ts'

test('a single Story uses the existing review Inbox, immutable evidence and paired approval while other stories remain private', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await siteLookFixture(),
    client = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/story-review/' + info.project.name),
    suffix = randomUUID().slice(0, 8),
    accounts = [
      { email: 'story-author-' + suffix + '@example.test', role: 'contributor' },
      { email: 'story-reviewer-' + suffix + '@example.test', role: 'site_admin' },
      { email: 'story-outsider-' + suffix + '@example.test', role: null },
    ],
    users: string[] = [],
    objects: string[] = [],
    mediaId = randomUUID(),
    title = 'Community story for review',
    originalWords = 'Saved story words ready for review.',
    latestWords = 'Updated story words ready for a final decision.'
  let collection = '',
    entry = '',
    other = '',
    article = '',
    path = ''
  const reviewerContext = await browser.newContext(),
    reviewer = await reviewerContext.newPage()
  const root = (await f.pool.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
  async function as<T>(actor: string, fn: () => Promise<T>, commit = true): Promise<T> {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE cms_authenticated_user')
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    try {
      const result = await fn()
      await client.query(commit ? 'COMMIT' : 'ROLLBACK')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
  const capture = async (active: Page, name: string) => {
    for (const width of [1440, 1024]) {
      await active.setViewportSize({ width, height: 950 })
      expect(await active.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await active.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
    }
  }
  const story = () => '/sites/' + f.site + '/stories/' + entry
  const counts = async () =>
    (await f.pool.query('SELECT count(*)::int n FROM submissions WHERE site_id=$1', [f.site])).rows[0]!.n
  async function updateBody(id: string, body: string) {
    await as(users[0]!, async () => {
      const row = (
          await client.query(
            'SELECT c.entry_revision,v.values FROM collections c JOIN collection_entries e ON e.collection_id=c.id JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE c.id=$1 AND e.id=$2',
            [collection, id],
          )
        ).rows[0]!,
        v = row.values
      await saveStoryDetails(client, f.site, collection, id, String(row.entry_revision), {
        title: v.title,
        summary: v.summary,
        tags: [],
        region: '',
        regions: [],
        published_date: v.published_date,
        countries: '',
        body: '<p>' + body + '</p>',
        body_is_sample: false,
      })
    })
  }
  async function submit() {
    await page.goto(story())
    await page.getByRole('button', { name: 'Submit for review', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Send story for review', exact: true })
    await expect(dialog).toBeVisible()
    await dialog
      .getByLabel('Note for the reviewer (optional)', { exact: true })
      .fill('Please review the saved story and its photo.')
    await dialog.getByRole('button', { name: 'Submit for review', exact: true }).click()
    await expect(page).toHaveURL(/\/inbox\?review=[0-9a-f-]+$/)
    return new URL(page.url()).searchParams.get('review')!
  }
  try {
    await mkdir(folder, { recursive: true })
    await as(root, async () => {
      for (const account of accounts) {
        const id = (await client.query('SELECT app.provision_user($1,$2) id', [account.email, '[Name]'])).rows[0]!.id
        users.push(id)
        if (account.role) await client.query('SELECT app.set_site_membership($1,$2,$3)', [id, f.site, account.role])
      }
      const enabled = await enableSiteStories(client, f.site, {
        mainLabel: 'Main tags',
        secondaryLabel: 'Secondary tags',
        publishUnreviewed: true,
      })
      collection = enabled.collectionId
      const rev = (await client.query('SELECT revision FROM collections WHERE id=$1', [collection])).rows[0]!.revision
      await client.query('SELECT * FROM app.publish_collection_schema($1,$2)', [collection, rev])
    })
    for (const [index, account] of accounts.entries())
      await f.pool.query('UPDATE app_users SET auth_subject=$1 WHERE id=$2', ['local|' + account.email, users[index]])
    const bytes = await readFile(resolve('../apps/admin/public/cms-samples/r8-landscape.png')),
      processed = await processMediaBytes(
        {
          intentId: randomUUID(),
          siteId: f.site,
          uploadObjectKey: 'story-review/input.png',
          finalKeyPrefix: 'story-review/' + mediaId + '/',
          declaredMime: 'image/png',
          declaredBytes: bytes.length,
        },
        bytes,
      ),
      store = createFilesystemMediaStore(defaultMediaRoot()),
      original = processed.original
    await store.put(original.objectKey, original.data, original.mimeType)
    objects.push(original.objectKey)
    await f.pool.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'Story review photo.png','Landscape illustration for this local story.',$5,$6,$7,$8,'ready')",
      [
        mediaId,
        f.site,
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
    }
    await as(users[0]!, async () => {
      let revision = String(
        (await client.query('SELECT entry_revision FROM collections WHERE id=$1', [collection])).rows[0]!
          .entry_revision,
      )
      for (const name of [title, 'Another private story']) {
        const created = await createStoryDraft(client, f.site, collection, revision, {
          title: name,
          summary: 'A saved description for this community story.',
          tags: [],
          region: '',
          published_date: new Date().toISOString().slice(0, 10),
          photoId: mediaId,
          photoAlt: 'Landscape illustration for this local story.',
          body: '<p>' + originalWords + '</p>',
        })
        revision = created.revision
        if (!entry) {
          entry = created.entryId
          article = created.pageId
        } else other = created.entryId
      }
    })
    path = (await f.pool.query('SELECT app.page_path(slug) path FROM pages WHERE id=$1', [article])).rows[0]!.path
    expect(
      (await page.request.get(`http://127.0.0.1:${E2E_PORTS.site}` + path, { headers: { host: f.host } })).status(),
    ).toBe(404)
    await signIn(page, accounts[0]!.email)
    await page.goto(story())
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Submit for review', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'Send story for review', exact: true })
    await expect(dialog).toContainText('only this saved story')
    await dialog.getByText('What changed', { exact: true }).click()
    await capture(page, 'send-review')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(await counts()).toBe(0)
    await page.getByRole('button', { name: 'Submit for review', exact: true }).click()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await counts()).toBe(0)
    const first = await submit()
    await expect(page.getByRole('region', { name: 'Story changes', exact: true })).toContainText(
      'Added story: ' + title,
    )
    await page.getByRole('tab', { name: 'Preview', exact: true }).click()
    await expect(
      page.frameLocator('iframe[title="Submitted version of ' + title + '"]').getByText(originalWords, { exact: true }),
    ).toBeVisible()
    await capture(page, 'author-waiting')
    await as(
      users[0]!,
      async () => {
        await expect(
          client.query("UPDATE story_review_pins SET manifest='{}'::jsonb WHERE submission_id=$1", [first]),
        ).rejects.toMatchObject({ code: '42501' })
      },
      false,
    )
    await updateBody(other, 'Other private story words changed.')
    expect((await f.pool.query('SELECT status FROM submissions WHERE id=$1', [first])).rows[0]!.status).toBe('open')
    await as(
      users[0]!,
      async () => {
        const pin = (
          await client.query('SELECT page_version_id,entry_version_id FROM story_review_pins WHERE submission_id=$1', [
            first,
          ])
        ).rows[0]!
        const manifest = (await client.query('SELECT app.story_review_manifest($1) manifest', [pin.page_version_id]))
          .rows[0]!.manifest
        expect(JSON.stringify(manifest)).toContain(originalWords)
        expect(JSON.stringify(manifest)).not.toContain('Other private story words changed.')
        await expect(
          client.query('SELECT * FROM app.approve_page_submission($1,3,NULL,$2)', [first, '[]']),
        ).rejects.toThrow(/not permitted/)
      },
      false,
    )
    await as(
      users[2]!,
      async () => {
        const version = (await f.pool.query('SELECT version_id FROM submissions WHERE id=$1', [first])).rows[0]!
          .version_id
        expect(
          (await client.query('SELECT app.story_review_manifest($1) manifest', [version])).rows[0]!.manifest,
        ).toBeNull()
        expect((await client.query('SELECT * FROM story_review_pins WHERE submission_id=$1', [first])).rows).toEqual([])
      },
      false,
    )
    await updateBody(entry, latestWords)
    expect((await f.pool.query('SELECT status FROM submissions WHERE id=$1', [first])).rows[0]!.status).toBe(
      'superseded',
    )
    await page.reload()
    await page.getByRole('tab', { name: 'Preview', exact: true }).click()
    await expect(
      page.frameLocator('iframe[title="Submitted version of ' + title + '"]').getByText(originalWords, { exact: true }),
    ).toBeVisible()
    await expect(
      page.frameLocator('iframe[title="Submitted version of ' + title + '"]').getByText(latestWords, { exact: true }),
    ).toHaveCount(0)
    await capture(page, 'superseded-evidence')
    await page.goto(story())
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(
      page.frameLocator('iframe[title="Saved story preview"]').getByText(latestWords, { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('dialog', { name: 'Saved story preview', exact: true })
      .getByRole('button', { name: 'Done', exact: true })
      .click()
    await as(
      users[1]!,
      async () => {
        await expect(
          client.query('SELECT * FROM app.approve_page_submission($1,3,NULL,$2)', [first, '[]']),
        ).rejects.toThrow(/no longer waiting/)
      },
      false,
    )
    const second = await submit()
    await signIn(reviewer, accounts[1]!.email)
    await reviewer.goto('/inbox?review=' + second)
    await reviewer.getByRole('tab', { name: 'Preview', exact: true }).click()
    await expect(
      reviewer
        .frameLocator('iframe[title="Submitted version of ' + title + '"]')
        .getByText(latestWords, { exact: true }),
    ).toBeVisible()
    await capture(reviewer, 'reviewer-evidence')
    await reviewer.getByRole('button', { name: 'Return with feedback', exact: true }).click()
    const returned = reviewer.getByRole('dialog', { name: 'Return this page for changes?', exact: true })
    await returned
      .getByLabel('What should change?', { exact: true })
      .fill('Please check the photo description before publishing.')
    await returned.getByRole('button', { name: 'Return with feedback', exact: true }).click()
    await expect(reviewer.getByRole('status').filter({ hasText: 'Returned' })).toBeVisible()
    expect(
      (await f.pool.query('SELECT published_version_id FROM collection_entries WHERE id=$1', [entry])).rows[0]!
        .published_version_id,
    ).toBeNull()
    const final = await submit()
    const prepared = await as(users[0]!, () => prepareSingleStoryReview(client, f.site, collection, entry), false)
    await as(users[0]!, async () => {
      const same = await submitSingleStoryReview(
        client,
        f.site,
        collection,
        entry,
        prepared,
        'Please review the saved story and its photo.',
      )
      expect(same.submissionId).toBe(final)
    })
    await reviewer.goto('/inbox?review=' + final)
    await reviewer.getByRole('button', { name: 'Approve and publish', exact: true }).click()
    const approval = reviewer.getByRole('alertdialog', { name: 'Approve and publish this version?', exact: true })
    await capture(reviewer, 'approval-confirmation')
    await approval.getByRole('button', { name: 'Approve and publish', exact: true }).click()
    await expect(reviewer.getByRole('status').filter({ hasText: 'Approved and published' })).toBeVisible({
      timeout: 30000,
    })
    await capture(reviewer, 'approved')
    const saved = (
      await f.pool.query(
        "SELECT e.id,e.published_version_id,v.values,p.published_version_id article_public FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id JOIN pages p ON p.site_id=e.site_id AND app.page_path(p.slug)=v.values->>'story_url' WHERE e.id=ANY($1::uuid[])",
        [[entry, other]],
      )
    ).rows
    expect(saved.find(row => row.id === entry)!.published_version_id).not.toBeNull()
    expect(saved.find(row => row.id === entry)!.article_public).not.toBeNull()
    expect(saved.find(row => row.id === other)!.published_version_id).toBeNull()
    expect(saved.find(row => row.id === other)!.article_public).toBeNull()
    const publicPage = await page.request.get(`http://127.0.0.1:${E2E_PORTS.site}` + path, {
      headers: { host: f.host },
    })
    expect(publicPage.status()).toBe(200)
    expect(await publicPage.text()).toContain(latestWords)
    await reviewer.goto('http://' + f.host + `:${E2E_PORTS.site}` + path)
    await expect(reviewer.getByText(latestWords, { exact: true })).toBeVisible()
    await expect(reviewer.getByRole('link', { name: 'Newsroom', exact: true })).toHaveCount(0)
    for (const width of [1440, 1024, 390]) {
      await reviewer.setViewportSize({ width, height: 950 })
      expect(await reviewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await reviewer.screenshot({ path: resolve(folder, 'public-' + width + '.png'), fullPage: true })
    }
    expect((await f.pool.query('SELECT count(*)::int n FROM story_source_checks')).rows[0]!.n).toBe(0)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    if (users.length) {
      await as(root, async () => {
        for (const user of users) await client.query("SELECT app.set_user_status($1,'disabled')", [user])
      })
      await f.pool.query('DELETE FROM site_memberships WHERE site_id=$1 AND user_id=ANY($2::uuid[])', [f.site, users])
    }
    for (const object of objects) await createFilesystemMediaStore(defaultMediaRoot()).remove(object)
    await reviewerContext.close()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    client.release()
    await f.pool.end()
  }
})
