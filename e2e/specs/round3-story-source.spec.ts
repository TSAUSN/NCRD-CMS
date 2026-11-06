import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
import { checkStorySource, type StorySourceRunner } from '../../apps/admin/src/lib/story-source-check.ts'
import { initialSawsoSourceBaselines } from '../../apps/admin/src/lib/story-source-feed.ts'
test('manual Story check shows saved status, drafts, progress and safe retry without a public read', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/story-source/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let reads = 0,
    requests = 0,
    release: () => void = () => {},
    waiting: () => void = () => {},
    mode: 'ok' | 'network' | 'lost' = 'ok'
  const entered = new Promise<void>(resolve => {
      waiting = resolve
    }),
    gate = new Promise<void>(resolve => {
      release = resolve
    })
  const run: StorySourceRunner = async fn => {
    const c = await f.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE cms_authenticated_user')
      await c.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
      const value = await fn(c)
      await c.query('COMMIT')
      return value
    } catch (error) {
      await c.query('ROLLBACK')
      throw error
    } finally {
      c.release()
    }
  }
  const baseline = await f.pool.query(
      'SELECT e.stable_key,v.values,e.published_version_id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.id',
      [f.collectionId],
    ),
    source = initialSawsoSourceBaselines(baseline.rows.map(row => row.stable_key)).map(b => ({
      id: b.sourceId,
      title: b.fields.title,
      description: b.fields.summary,
      publishDate: b.fields.published_date,
      urlAlias: b.sourceId,
      redirectUrl: b.fields.old_address,
      headerImage: b.fields.image_url,
      published: 1,
      hideInMenu: 0,
    }))
  const wire = encodeURIComponent(
    JSON.stringify({
      objects: [
        ...source,
        {
          id: 'round3-source-new',
          title: 'Story refresh sample',
          description: 'Health in Zambia',
          publishDate: new Date().toISOString().slice(0, 10),
          urlAlias: 'round3-source-new',
          headerImage: 'https://example.test/source-photo.jpg',
          published: 1,
          hideInMenu: 0,
        },
      ],
    }),
  )
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  let probe = 0
  await page.route('**/api/sites/' + f.siteId + '/stories/check', async route => {
    if (route.request().method() === 'GET') {
      probe++
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      return
    }
    requests++
    const input = route.request().postDataJSON() as { collectionId: string; requestId: string }
    expect(input.collectionId).toBe(f.collectionId)
    const check = await checkStorySource(
      {
        run,
        readFeed: async () => {
          reads++
          if (reads === 1) {
            waiting()
            await gate
          }
          if (mode === 'network') throw new Error('synthetic connection failure')
          return wire
        },
      },
      f.siteId,
      f.collectionId,
      input.requestId,
    )
    if (mode === 'lost') {
      mode = 'ok'
      await route.abort('failed')
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ check }) })
  })
  let publicReads = 0
  await page.route('https://sawso.org/**', async route => {
    publicReads++
    await route.abort()
  })
  try {
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/stories')
    await page.evaluate(
      async url => {
        await fetch(url)
      },
      '/api/sites/' + f.siteId + '/stories/check',
    )
    expect(probe).toBe(1)
    expect(reads).toBe(0)
    await expect(page.getByText(/Feed not checked yet/)).toBeVisible()
    await capture('before')
    await page.getByRole('button', { name: 'Check for new stories', exact: true }).click()
    await entered
    await expect(page.getByRole('button', { name: 'Checking stories…', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeDisabled()
    await expect(page.getByRole('checkbox', { name: 'Reviewed', exact: true }).first()).toBeDisabled()
    await capture('checking')
    release()
    await expect(page.getByText(/1 new story, 0 updated, 0 no longer/)).toBeVisible()
    await expect(page.getByText(/Feed checked .*Eastern time/)).toBeVisible()
    await capture('complete')
    expect(reads).toBe(1)
    await page.getByRole('button', { name: 'Review new stories', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Story status', exact: true })).toHaveValue('review')
    const added = page.getByRole('article', { name: 'Story refresh sample', exact: true })
    await expect(added).toBeVisible()
    await expect(added.getByText('Needs review', { exact: true })).toBeVisible()
    await expect(
      added
        .getByRole('group', { name: 'Project Sectors', exact: true })
        .getByRole('button', { name: 'Health', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('searchbox', { name: 'Search titles and descriptions' }).fill('Story refresh sample')
    await capture('new-draft')
    await page.reload()
    await expect(page.getByText(/Feed checked .*Eastern time/)).toBeVisible()
    expect(reads).toBe(1)
    mode = 'network'
    await page.getByRole('button', { name: 'Check for new stories', exact: true }).click()
    await expect(
      page.getByText('The feed could not be reached. Saved stories are unchanged. Check again when connected.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.getByText(/last successful check/)).toBeVisible()
    await capture('failed')
    expect(reads).toBe(2)
    mode = 'lost'
    await page.getByRole('button', { name: 'Check for new stories', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Retry check', exact: true })).toBeVisible()
    await expect(
      page.getByText('The connection was lost. Retry this check to see its saved result. Saved stories are safe.', {
        exact: true,
      }),
    ).toBeVisible()
    expect(reads).toBe(3)
    await capture('connection-lost')
    await page.getByRole('button', { name: 'Retry check', exact: true }).click()
    await expect(page.getByText(/0 new stories, 0 updated, 0 no longer/)).toBeVisible()
    expect(reads).toBe(3)
    expect(requests).toBe(4)
    const current = (
      await f.pool.query(
        'SELECT e.stable_key,v.values,e.published_version_id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.id',
        [f.collectionId],
      )
    ).rows
    expect(current.filter(row => baseline.rows.some(old => old.stable_key === row.stable_key))).toEqual(baseline.rows)
    expect(current).toHaveLength(baseline.rows.length + 1)
    expect(current.find(row => row.stable_key === 'feed-round3-source-new')?.published_version_id).toBeNull()
    const suffix = randomUUID().slice(0, 8),
      email = 'refresh-editor-' + suffix + '@example.test'
    await run(async c => {
      const actor = (await c.query('SELECT app.provision_user($1,$2) AS id', [email, '[Name]'])).rows[0]!.id
      await c.query("SELECT app.set_site_membership($1,$2,'editor')", [actor, f.siteId])
    })
    const editor = await browser.newContext({ baseURL: new URL(page.url()).origin })
    try {
      const view = await editor.newPage()
      await signIn(view, email)
      await view.goto('/sites/' + f.siteId + '/stories')
      await expect(view.getByRole('button', { name: 'Check for new stories', exact: true })).toHaveCount(0)
      await expect(view.getByText(/Feed checked .*Eastern time/)).toBeVisible()
      await view.screenshot({ path: resolve(folder, 'editor-1440.png') })
    } finally {
      await editor.close()
    }
    expect(publicReads).toBe(0)
  } finally {
    release()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
