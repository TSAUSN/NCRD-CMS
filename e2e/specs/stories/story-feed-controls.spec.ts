import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { DEFAULT_THEME_TOKENS, storyDateInFeed, storyMatchesTags } from '@cms/schema'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn, saveDraft } from '../helpers.ts'
import { enableSiteStories } from '../../../apps/admin/src/lib/stories-enable.ts'
import { changeStoriesTags } from '../../../apps/admin/src/lib/stories-tags.ts'
test('page Story controls use each site catalog, preserve drafts, combine tag groups and clear both archive links', async ({
  page,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/story-feed-controls/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let otherSite = ''
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
    }
  }
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const editor = (await f.client.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    await f.client.query("SELECT app.set_site_membership($1,$2,'editor')", [editor, f.siteId])
    const source = (
        await f.client.query(
          "SELECT p.id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug='ways-we-help/education'",
          [f.siteId],
        )
      ).rows[0]!,
      defs = (
        await f.client.query("SELECT id FROM section_defs WHERE slug='core-stories' AND scope='global'")
      ).rows.map(row => row.id),
      index = source.content.findIndex((section: { section_def_id: string }) => defs.includes(section.section_def_id)),
      section = source.content[index]
    otherSite = (
      await f.client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        'feed-choice-' + randomUUID().slice(0, 8),
        '[Site]',
        'resource',
        null,
        JSON.stringify(DEFAULT_THEME_TOKENS),
        '[]',
      ])
    ).rows[0]!.id
    await f.client.query("SELECT app.set_site_membership($1,$2,'editor')", [editor, otherSite])
    const otherPage = (
      await f.client.query("SELECT app.create_page($1,'stories-page','[Stories page]') AS id", [otherSite])
    ).rows[0]!.id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      otherPage,
      JSON.stringify([
        {
          ...section,
          values: {
            heading: '[Story heading]',
            stories: { readerKey: 'stories', selection: { mode: 'automatic', limit: 6 } },
            empty_mode: 'line',
            empty_line: 'No matching stories yet.',
            newsroom: { url: '', label: '' },
          },
        },
      ]),
      '{}',
    ])
    await f.client.query('COMMIT')
    await signIn(page, 'editor@example.test')
    const url = '/pages/' + source.id + '?section=' + index
    await page.goto(url)
    const panel = page.getByRole('complementary', { name: 'Inspector' }),
      main = panel.getByRole('group', { name: 'Project Sectors', exact: true }),
      secondary = panel.getByRole('group', { name: 'Regions', exact: true }),
      frame = page.frameLocator('iframe[title="Page canvas"]'),
      feed = frame.locator('[data-cms-section="' + index + '"]')
    await expect(main.getByRole('button', { name: 'Education', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.getByLabel('Maximum stories')).toHaveValue('6')
    await expect(panel.getByLabel('Maximum stories').locator('option')).toHaveCount(6)
    await expect(panel.locator('[data-inspector-slot="more"]')).toHaveCount(0)
    const tree = page.getByRole('complementary', { name: 'Page structure' })
    await expect(tree.getByRole('button', { name: 'More stories', exact: true })).toHaveCount(0)
    await expect(tree.getByRole('button', { name: 'Archive link (optional)', exact: true })).toBeVisible()
    await main.getByRole('button', { name: 'Health', exact: true }).click()
    await secondary.getByRole('button', { name: 'Africa', exact: true }).click()
    await panel.getByLabel('Maximum stories').selectOption('3')
    const tags = { main: ['education', 'health'], secondary: ['africa'] },
      rows = (
        await f.pool.query(
          'SELECT v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1',
          [f.collectionId],
        )
      ).rows,
      expected = rows.filter(
        row => storyMatchesTags(row.values, tags.main, tags.secondary) && storyDateInFeed(row.values.published_date),
      ).length
    await expect(feed.locator('.core-story-card')).toHaveCount(Math.min(3, expected))
    await capture('two-groups')
    await panel.locator('[data-inspector-slot="newsroom"]').getByRole('button', { name: 'Change', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Change link', exact: true })
    await dialog
      .getByRole('group', { name: 'Link destination type' })
      .getByRole('button', { name: 'Website', exact: true })
      .click()
    await dialog.getByLabel('Address', { exact: true }).fill('')
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(feed.locator('.core-story-desktop-link,.core-story-more')).toHaveCount(0)
    await saveDraft(page)
    const saved = (
      await f.pool.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [source.id],
      )
    ).rows[0]!.content[index].values
    expect(saved.stories.selection).toMatchObject({ storyTags: tags, limit: 3, maxAgeMonths: 13 })
    expect(saved.newsroom.url).toBe('')
    await page.route('**/collection-options?**', route => route.fulfill({ status: 500, body: 'Unavailable' }))
    await page.goto(url)
    await expect(panel.getByRole('alert').filter({ hasText: 'Story choices could not be loaded' })).toBeVisible()
    await capture('choices-error')
    await page.unroute('**/collection-options?**')
    await panel.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(main.getByRole('button', { name: 'Health', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(secondary.getByRole('button', { name: 'Africa', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.goto('/pages/' + otherPage + '?section=0')
    await expect(panel.getByText('Stories are not set up for this site.', { exact: false })).toBeVisible()
    await capture('no-library')
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const enabled = await enableSiteStories(f.client, otherSite, {
      mainLabel: 'Programs',
      secondaryLabel: 'Areas',
      publishUnreviewed: true,
    })
    for (const operation of [
      { action: 'add', group: 'main', label: 'Food support', keywords: [], areas: [] },
      { action: 'add', group: 'secondary', label: 'North', keywords: [], areas: [] },
    ]) {
      const head = (
        await f.client.query('SELECT revision,entry_revision FROM collections WHERE id=$1', [enabled.collectionId])
      ).rows[0]!
      await changeStoriesTags(
        f.client,
        otherSite,
        enabled.collectionId,
        String(head.revision),
        String(head.entry_revision),
        operation,
      )
    }
    await f.client.query('COMMIT')
    await page.reload()
    await expect(
      panel
        .getByRole('group', { name: 'Programs', exact: true })
        .getByRole('button', { name: 'Food support', exact: true }),
    ).toBeVisible()
    await expect(
      panel.getByRole('group', { name: 'Areas', exact: true }).getByRole('button', { name: 'North', exact: true }),
    ).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Health', exact: true })).toHaveCount(0)
    await expect(panel.getByLabel('Maximum stories').locator('option')).toHaveCount(200)
    await expect(frame.getByText('No matching stories yet.', { exact: true })).toBeVisible({ timeout: 30000 })
    await capture('own-catalog')
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=ANY($1::uuid[])', [
      [f.siteId, ...(otherSite ? [otherSite] : [])],
    ])
    f.client.release()
    await f.pool.end()
  }
})
