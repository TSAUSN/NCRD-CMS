import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'
import { createStoriesModel, emptyStoriesSettings } from '@cms/schema'
async function publish(page: Page, count = 1) {
  const button = page.getByRole('button', { name: 'Publish selected (' + count + ')', exact: true })
  await button.click()
  await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
  await button.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
}
test('optional Story controls preserve untouched versions through author,Feature and group publishing while other field upgrades remain strict', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/story-optional-controls/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      model = createStoriesModel(emptyStoriesSettings()),
      fields = model.fields.filter(field => !['author', 'newsroom_rank'].includes(field.key)),
      day = new Date().toISOString().slice(0, 10)
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const collection = (
      await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        f.site,
        'stories',
        'Stories',
        'stories',
        JSON.stringify(fields),
        JSON.stringify(model.presentation),
      ])
    ).rows[0]!.collection_id
    await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
      collection,
      JSON.stringify(
        ['First', 'Second', 'Third'].map(word => ({
          id: null,
          stableKey: word.toLowerCase(),
          values: {
            title: '[' + word + ' story]',
            summary: '[Description]',
            published_date: day,
            story_url: '/visit',
            body: '<p>[Saved words]</p>',
          },
        })),
      ),
    ])
    const initial = (await c.query('SELECT revision FROM collections WHERE id=$1', [collection])).rows[0]!
    await c.query('SELECT app.publish_collection_schema($1,$2)', [collection, initial.revision])
    await c.query('SELECT app.publish_collection_entries($1,1)', [collection])
    await c.query('COMMIT')
    const rows = async () =>
        (
          await c.query(
            'SELECT e.id,e.stable_key,e.draft_version_id,e.published_version_id,v.schema_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index,e.id',
            [collection],
          )
        ).rows,
      original = await rows(),
      base = '/sites/' + f.site + '/stories',
      capture = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 950 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
        }
      }
    await signIn(page, 'root@example.test')
    await page.goto(base)
    await page.getByRole('button', { name: 'Update Stories', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Feature', exact: true })).toHaveCount(3)
    await page.goto('/sites/' + f.site + '/publishing?lists=1')
    await publish(page)
    expect(await rows()).toEqual(original)
    await page.goto(base + '/' + original[0]!.id)
    await page.getByLabel('Author (optional)', { exact: true }).fill('[Name]')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Story draft saved' })).toBeVisible()
    const authored = await rows()
    expect(authored[0]!.draft_version_id).not.toBe(original[0]!.draft_version_id)
    expect(authored[0]!.published_version_id).toBe(original[0]!.published_version_id)
    expect(authored.slice(1)).toEqual(original.slice(1))
    await capture('one-author-draft')
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Publish selected (1)', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    expect((await rows()).slice(1)).toEqual(original.slice(1))
    await page.goto(base)
    await page
      .getByRole('article', { name: '[Second story]', exact: true })
      .getByRole('button', { name: 'Feature', exact: true })
      .click()
    await expect(page.getByRole('status').filter({ hasText: 'Story changes saved' })).toBeVisible()
    const featured = await rows()
    expect(featured[2]).toEqual(original[2])
    expect(featured[1]!.draft_version_id).not.toBe(original[1]!.draft_version_id)
    await page.goto('/sites/' + f.site + '/publishing?lists=1')
    await expect(
      page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: 'Stories · items', exact: true }) }),
    ).toContainText('1 item changed')
    await capture('only-changed-story-ready')
    await publish(page)
    const published = await rows()
    expect(published[2]).toEqual(original[2])
    expect(published[0]!.values.author).toBe('[Name]')
    expect(published[1]!.values.newsroom_rank).toBe(1)
    expect(published[1]!.draft_version_id).toBe(published[1]!.published_version_id)
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    let head = (
      await c.query(
        'SELECT c.revision,c.entry_revision,v.fields,v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1',
        [collection],
      )
    ).rows[0]!
    let changed = (
      await c.query('SELECT * FROM app.save_collection_schema($1,$2,$3,$4)', [
        collection,
        head.revision,
        JSON.stringify(head.fields),
        JSON.stringify({ ...head.sort, stories: { ...head.sort.stories, publishUnreviewed: false } }),
      ])
    ).rows[0]!
    await c.query('SELECT app.publish_collection_schema($1,$2)', [collection, changed.revision])
    await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      collection,
      head.entry_revision,
      JSON.stringify(published.map(row => ({ id: row.id, stableKey: row.stable_key, values: row.values }))),
    ])
    expect(await rows()).toEqual(published)
    await c.query('COMMIT')
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    head = (
      await c.query(
        'SELECT c.revision,c.entry_revision,v.fields,v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1',
        [collection],
      )
    ).rows[0]!
    changed = (
      await c.query('SELECT * FROM app.save_collection_schema($1,$2,$3,$4)', [
        collection,
        head.revision,
        JSON.stringify([...head.fields, { key: 'extra', label: '[Extra field]', type: 'text', required: false }]),
        JSON.stringify(head.sort),
      ])
    ).rows[0]!
    await c.query('SELECT app.publish_collection_schema($1,$2)', [collection, changed.revision])
    await c.query('SAVEPOINT ordinary_upgrade')
    await expect(
      c.query('SELECT app.publish_collection_entries($1,$2)', [collection, head.entry_revision]),
    ).rejects.toMatchObject({
      code: 'CMS04',
      message: expect.stringContaining('saved against the published collection schema'),
    })
    await c.query('ROLLBACK TO SAVEPOINT ordinary_upgrade')
    await expect(
      c.query('SELECT * FROM app.publish_story_entries($1,$2,$3)', [
        collection,
        head.entry_revision,
        [published[0]!.id],
      ]),
    ).rejects.toMatchObject({
      code: 'CMS04',
      message: expect.stringContaining('saved against the published collection schema'),
    })
    await c.query('ROLLBACK')
    expect(await rows()).toEqual(published)
    await c.query('BEGIN')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const outsider = (await c.query("SELECT id FROM app_users WHERE email='contributor@example.test'")).rows[0]!.id
    await c.query('SELECT app.set_site_membership($1,$2,NULL)', [outsider, f.site])
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [outsider])
    const current = (await f.pool.query('SELECT draft_schema_version_id FROM collections WHERE id=$1', [collection]))
      .rows[0]!.draft_schema_version_id
    expect(
      (
        await c.query('SELECT app.story_controls_schema_compatible($1,$2) AS allowed', [
          published[0]!.schema_version_id,
          current,
        ])
      ).rows[0]!.allowed,
    ).toBe(false)
    expect(
      (await c.query('SELECT count(*)::int AS count FROM collections WHERE id=$1', [collection])).rows[0]!.count,
    ).toBe(0)
    await c.query('ROLLBACK')
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})

test('an earlier Story model gets an explicit reviewed controls update before individual editing,with all existing words and photos preserved', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/story-optional-controls/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      settings = {
        ...emptyStoriesSettings(),
        mainTags: [{ id: 'health', label: 'Health', keywords: [] }],
        secondaryTags: [{ id: 'africa', label: 'Africa', keywords: [], areas: [] }],
      },
      model = createStoriesModel(settings),
      fields = model.fields
        .filter(
          field => !['regions', 'reviewed', 'hidden', 'feed_removed', 'author', 'newsroom_rank'].includes(field.key),
        )
        .map(field =>
          field.key === 'published_date'
            ? { ...field, label: 'Published', required: true }
            : field.key === 'tags'
              ? { ...field, label: 'Sectors', required: true }
              : field.key === 'region'
                ? { key: 'region', type: 'select', label: 'Region', required: true, options: ['africa'] }
                : field,
        ),
      day = new Date().toISOString().slice(0, 10)
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const collection = (
      await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        f.site,
        'stories',
        'Stories',
        'stories',
        JSON.stringify(fields),
        JSON.stringify(model.presentation),
      ])
    ).rows[0]!.collection_id
    await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
      collection,
      JSON.stringify(
        ['First', 'Second'].map(word => ({
          id: null,
          stableKey: word.toLowerCase(),
          values: {
            title: '[' + word + ' legacy story]',
            summary: '[Saved description]',
            published_date: day,
            tags: 'health',
            region: 'africa',
            story_url: '/visit',
            body: '<p>[Saved legacy words]</p>',
          },
        })),
      ),
    ])
    const head = (await c.query('SELECT revision FROM collections WHERE id=$1', [collection])).rows[0]!
    await c.query('SELECT app.publish_collection_schema($1,$2)', [collection, head.revision])
    await c.query('SELECT app.publish_collection_entries($1,1)', [collection])
    await c.query('COMMIT')
    const rows = async () =>
        (
          await c.query(
            'SELECT e.id,e.draft_version_id,e.published_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index,e.id',
            [collection],
          )
        ).rows,
      original = await rows(),
      base = '/sites/' + f.site + '/stories'
    await signIn(page, 'root@example.test')
    await page.goto(base)
    await page.getByRole('button', { name: 'Update Stories', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Feature', exact: true })).toHaveCount(2)
    expect(await rows()).toEqual(original)
    await page.goto('/sites/' + f.site + '/publishing?lists=1')
    await expect(
      page.getByText('Update editing controls for 2 stories · used on 0 pages', { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publish selected (2)', exact: true })).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await page.screenshot({ path: resolve(folder, 'explicit-legacy-update-' + width + '.png') })
    }
    await publish(page, 2)
    const upgraded = await rows()
    for (let index = 0; index < original.length; index++) {
      expect(upgraded[index]!.draft_version_id).not.toBe(original[index]!.draft_version_id)
      expect(upgraded[index]!.draft_version_id).toBe(upgraded[index]!.published_version_id)
      for (const [key, value] of Object.entries(original[index]!.values))
        expect(upgraded[index]!.values[key]).toEqual(value)
    }
    await page.goto(base + '/' + upgraded[0]!.id)
    await page.getByLabel('Author (optional)', { exact: true }).fill('[Name]')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Story draft saved' })).toBeVisible()
    expect((await rows())[1]).toEqual(upgraded[1])
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
