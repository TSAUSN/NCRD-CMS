import { E2E_PORTS } from '../test-ports.ts'
import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
import { corePageDefinitions } from '../../apps/admin/src/lib/core-pages.ts'
import { sawsoSection } from '../../apps/admin/src/lib/sawso-pages.ts'
import { rawRequest } from './http.ts'
const title = 'Primary Health Care to Support the Growing Chikankata Community'
async function published(page: Page, siteId: string) {
  await page.goto('/sites/' + siteId + '/publishing?lists=1')
  const button = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
  await button.click()
  const sample = page.getByRole('checkbox', { name: /Publish with sample content/ })
  await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible({
    timeout: 60000,
  })
  if (await sample.isVisible()) await sample.check()
  const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings', exact: true })
  if (await reason.isVisible())
    await reason.fill('Reviewing this isolated local sample fixture before checking story visibility.')
  await button.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 60000 })
}
test('Stories supports instant tagging, review/hide, every list filter and normal publication to public feeds', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/story-visibility/' + info.project.name)
  await mkdir(folder, { recursive: true })
  const base = '/sites/' + f.siteId + '/stories',
    row = () => page.getByRole('article', { name: title, exact: true }),
    settled = () => expect(page.getByRole('status').filter({ hasText: 'Story changes saved' })).toBeVisible()
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  try {
    const record = (
      await f.client.query(
        "SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND v.values->>'title'=$2",
        [f.collectionId, title],
      )
    ).rows[0]!
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const defs = await corePageDefinitions(f.client),
      manual = (
        await f.client.query("SELECT app.create_page($1,'manual-story-placement','[Manual story selection]') AS id", [
          f.siteId,
        ])
      ).rows[0]!.id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      manual,
      JSON.stringify([
        sawsoSection(defs, 'page-header', 'Page header', { heading: '[Manual story selection]', intro: '' }),
        sawsoSection(defs, 'stories', 'Stories', {
          heading: '[Manual stories]',
          empty_line: 'No stories here right now.',
          stories: { readerKey: 'stories', selection: { mode: 'manual', stableKeys: [record.stable_key] } },
        }),
      ]),
      '{}',
    ])
    await f.client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto(base)
    await expect(page.locator('[data-story-id]')).toHaveCount(34)
    await expect(page.getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
    await capture('main')
    await page.getByRole('searchbox', { name: 'Search titles and descriptions', exact: true }).fill('24-kilometer')
    await expect(page.getByRole('article')).toHaveCount(1)
    await row().getByRole('button', { name: 'Education', exact: true }).click()
    await row().getByRole('button', { name: 'Asia', exact: true }).click()
    await expect(row().getByRole('checkbox', { name: 'Reviewed', exact: true })).toBeChecked()
    await settled()
    await capture('tagged')
    await page.reload()
    await expect(row().getByRole('button', { name: 'Education', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(row().getByRole('button', { name: 'Asia', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await row().getByRole('checkbox', { name: 'Reviewed', exact: true }).uncheck()
    await settled()
    await page.getByRole('combobox', { name: 'Story status', exact: true }).selectOption('review')
    await expect(row()).toBeVisible()
    await page.getByRole('combobox', { name: 'Story status', exact: true }).selectOption('all')
    await row().getByRole('checkbox', { name: 'Reviewed', exact: true }).check()
    await settled()
    await row().getByRole('button', { name: 'Health', exact: true }).click()
    await row().getByRole('button', { name: 'Education', exact: true }).click()
    await settled()
    await page.getByRole('combobox', { name: 'Story status', exact: true }).selectOption('untagged')
    await expect(row()).toBeVisible()
    await capture('missing-tags')
    await page.getByRole('combobox', { name: 'Story status', exact: true }).selectOption('all')
    await row().getByRole('button', { name: 'Education', exact: true }).click()
    await settled()
    await page.getByRole('combobox', { name: 'Project Sectors', exact: true }).selectOption('education')
    await page.getByRole('combobox', { name: 'Regions', exact: true }).selectOption('asia')
    await expect(row()).toBeVisible()
    await page.getByRole('combobox', { name: 'Regions', exact: true }).selectOption('europe')
    await expect(page.getByRole('heading', { name: 'No stories match these filters', exact: true })).toBeVisible()
    await capture('empty')
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
    await page.getByRole('combobox', { name: 'Story status', exact: true }).selectOption('review')
    await expect(page.getByRole('article', { name: title, exact: true })).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Story status', exact: true }).selectOption('removed')
    await expect(page.getByRole('article')).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Story status', exact: true }).selectOption('all')
    await page.getByRole('searchbox', { name: 'Search titles and descriptions', exact: true }).fill('Chikankata')
    await row().getByRole('checkbox', { name: 'Hide from feeds', exact: true }).check()
    await settled()
    await page.getByRole('combobox', { name: 'Story status', exact: true }).selectOption('hidden')
    await expect(row()).toBeVisible()
    await capture('hidden-draft')
    await page.getByRole('combobox', { name: 'Story status', exact: true }).selectOption('all')
    await row().getByRole('checkbox', { name: 'Hide from feeds', exact: true }).uncheck()
    await settled()
    await published(page, f.siteId)
    expect((await rawRequest({ host: f.hostname, path: '/ways-we-help/education' })).body).toContain(title)
    expect((await rawRequest({ host: f.hostname, path: '/manual-story-placement' })).body).toContain(title)
    await page.goto(base + '?q=Chikankata&status=live')
    await expect(row()).toBeVisible()
    await row().getByRole('checkbox', { name: 'Hide from feeds', exact: true }).check()
    await settled()
    expect((await rawRequest({ host: f.hostname, path: '/ways-we-help/education' })).body).toContain(title)
    await published(page, f.siteId)
    expect((await rawRequest({ host: f.hostname, path: '/ways-we-help/education' })).body).not.toContain(title)
    const story = (
      await f.client.query(
        "SELECT v.values->>'story_url' AS path FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.published_version_id WHERE e.collection_id=$1 AND v.values->>'title'=$2",
        [f.collectionId, title],
      )
    ).rows[0]!
    const direct = await rawRequest({ host: f.hostname, path: story.path })
    expect(direct.status).toBe(404)
    expect(direct.body).not.toContain(title)
    expect(direct.headers['cache-control']).toBe('no-store')
    const placement = await rawRequest({ host: f.hostname, path: '/manual-story-placement' })
    expect(placement.status).toBe(200)
    expect(placement.body).not.toContain(title)
    expect((await rawRequest({ host: f.hostname, path: '/sitemap.xml' })).body).not.toContain(story.path)
    const kept = (
      await f.client.query(
        'SELECT e.id,e.archived_at,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.id=$1',
        [record.id],
      )
    ).rows[0]!
    expect(kept.id).toBe(record.id)
    expect(kept.archived_at).toBeNull()
    expect(kept.values.title).toBe(title)
    expect(kept.values.hidden).toBe(true)
    const publicContext = await browser.newContext({ javaScriptEnabled: false }),
      publicPage = await publicContext.newPage()
    try {
      for (const width of [1440, 1024, 390]) {
        await publicPage.setViewportSize({ width, height: 900 })
        const response = await publicPage.goto('http://' + f.hostname + `:${E2E_PORTS.site}` + story.path)
        expect(response!.status()).toBe(404)
        await expect(publicPage.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible()
        await publicPage.screenshot({ path: resolve(folder, 'hidden-article-' + width + '.png') })
      }
    } finally {
      await publicContext.close()
    }
    await page.goto(base + '?q=Chikankata')
    await row().getByRole('checkbox', { name: 'Hide from feeds', exact: true }).uncheck()
    await settled()
    await published(page, f.siteId)
    const restored = await rawRequest({ host: f.hostname, path: story.path })
    expect(restored.status).toBe(200)
    expect(restored.body).toContain(title)
    expect((await rawRequest({ host: f.hostname, path: '/manual-story-placement' })).body).toContain(title)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
test('failed and conflicting tag saves retain choices, retry safely, and preserve another editor’s article draft', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(),
    suffix = randomUUID().slice(0, 8),
    email = 'list-editor-' + suffix + '@example.test',
    folder = resolve('../.r8-progress/round3/story-visibility/' + info.project.name)
  await mkdir(folder, { recursive: true })
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const editor = (await f.client.query('SELECT app.provision_user($1,$2) AS id', [email, '[Name]'])).rows[0]!.id
    await f.client.query("SELECT app.set_site_membership($1,$2,'editor')", [editor, f.siteId])
    await f.client.query('UPDATE app_users SET auth_subject=$1 WHERE id=$2', ['local|' + email, editor])
    await f.client.query('COMMIT')
    await signIn(page, email)
    await page.goto('/sites/' + f.siteId + '/stories?q=Chikankata')
    const row = page.getByRole('article', { name: title, exact: true })
    await expect(page.getByRole('link', { name: 'Manage tags', exact: true })).toHaveCount(0)
    let failures = 2
    await page.route('**/sites/*/stories*', async route => {
      if (failures > 0 && route.request().method() === 'POST') {
        failures--
        await route.abort('failed')
      } else await route.continue()
    })
    await row.getByRole('button', { name: 'Family Care', exact: true }).click()
    const error = page.getByRole('alertdialog', { name: "Story changes weren't saved", exact: true })
    await expect(error).toBeVisible()
    await error.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeDisabled()
    await expect(page.getByRole('link', { name: 'Preview', exact: true })).toHaveCount(0)
    await expect(row.getByRole('button', { name: 'Family Care', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Review unsaved changes', exact: true }).click()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'save-error-' + width + '.png') })
    }
    await error.getByRole('button', { name: 'Retry changes', exact: true }).click()
    await expect(error).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: 'Story changes saved' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Preview', exact: true })).toBeVisible()
    await page.reload()
    await expect(row.getByRole('button', { name: 'Family Care', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const current = (await f.client.query('SELECT entry_revision FROM collections WHERE id=$1', [f.collectionId]))
        .rows[0]!,
      entries = (
        await f.client.query(
          'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index,e.id',
          [f.collectionId],
        )
      ).rows,
      target = entries.find(e => e.values.title === title)!
    await f.client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      f.collectionId,
      current.entry_revision,
      JSON.stringify(
        entries.map(e => ({
          id: e.id,
          stableKey: e.stable_key,
          values:
            e.id === target.id ? { ...e.values, body: '<p>[Separate draft text]</p>', body_is_sample: true } : e.values,
        })),
      ),
    ])
    await f.client.query('COMMIT')
    await row.getByRole('button', { name: 'Education', exact: true }).click()
    await expect(error).toBeVisible()
    await expect(error).toContainText('Someone else changed Stories')
    await error.getByRole('button', { name: 'Retry changes', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Story changes saved' })).toBeVisible()
    const saved = (
      await f.client.query(
        'SELECT v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.id=$1',
        [target.id],
      )
    ).rows[0]!.values
    expect(saved.body).toBe('<p>[Separate draft text]</p>')
    expect(saved.tags.split(',')).toContain('education')
    expect(saved.tags.split(',')).toContain('family-care')
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
