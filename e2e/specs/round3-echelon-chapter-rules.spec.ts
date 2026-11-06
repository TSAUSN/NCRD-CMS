import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ChapterSetup, sectionStartingValues } from '@cms/schema'
import { echelonFixture } from './fixtures/echelon.ts'
import { echelonChapterTemplate } from '../../packages/seeds/src/echelon-chapter-template.ts'
import { saveChapterInTransaction } from '../../apps/admin/src/lib/chapters.ts'
import { enableSiteStories } from '../../apps/admin/src/lib/stories-enable.ts'
import { signIn, canvas } from './helpers.ts'
test('chapter availability is enforced behind the library, shared text stays protected, and generated jumps follow current visible sections', async ({
  page,
}, info) => {
  test.setTimeout(180000)
  const f = await echelonFixture(false, false),
    folder = resolve('../.r8-progress/round3/echelon-chapter-rules/' + info.project.name),
    email = 'chapter-' + randomUUID().slice(0, 8) + '@example.test'
  let id = '',
    volunteer = ''
  try {
    await mkdir(folder, { recursive: true })
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    await enableSiteStories(f.client, f.site, {
      mainLabel: 'Main tags',
      secondaryLabel: 'Secondary tags',
      publishUnreviewed: true,
    })
    const chapter = await saveChapterInTransaction(
      f.client,
      f.site,
      null,
      '0',
      'reviewed-chapter',
      ChapterSetup.parse({
        name: '[Reviewed chapter]',
        destination: 'page',
        pageId: null,
        externalUrl: null,
        updateMode: 'chapter-editors',
        contact: { name: '[Name]', role: '[Role]', email: 'private@example.test' },
        sections: {},
      }),
    )
    id = chapter.config.pageId!
    const definitions = (
        await f.client.query(
          "SELECT d.id,d.slug,d.name,v.version,v.slots FROM section_defs d JOIN LATERAL(SELECT version,slots FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.scope='global' AND d.slug LIKE 'core-%'",
        )
      ).rows,
      photo = { src: '/cms-samples/r8-landscape.png', alt: '[Chapter photo]', decorative: false },
      content = echelonChapterTemplate(definitions, {
        logo: photo,
        photo,
        portrait: photo,
        photo_two: photo,
        photo_three: photo,
      }),
      head = (await f.client.query('SELECT revision FROM pages WHERE id=$1', [id])).rows[0]!
    await f.client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      id,
      head.revision,
      JSON.stringify(content),
      JSON.stringify({ description: '[Chapter rules check]' }),
    ])
    const story = definitions.find(row => row.slug === 'core-stories')!,
      storyPage = (
        await f.client.query('SELECT app.create_page($1,$2,$3) id', [
          f.site,
          'national-story-check',
          '[National Story source]',
        ])
      ).rows[0]!.id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      storyPage,
      JSON.stringify([
        { section_def_id: story.id, section_def_version: story.version, values: sectionStartingValues(story.slots) },
      ]),
      JSON.stringify({ description: '[National Stories stay available]' }),
    ])
    const source = (await f.client.query('SELECT draft_version_id FROM pages WHERE id=$1', [storyPage])).rows[0]!
      .draft_version_id
    await f.client.query('SELECT app.save_page_recipe($1,NULL,0,$2,$3,$4)', [
      f.site,
      '[Story template]',
      source,
      JSON.stringify([{ index: 0, sample: true }]),
    ])
    volunteer = (await f.client.query('SELECT app.provision_user($1,$2) id', [email, '[Chapter editor]'])).rows[0]!.id
    await f.client.query('SELECT app.assign_chapter_editor($1,$2,true)', [chapter.id, volunteer])
    await f.client.query('COMMIT')
    const current = (
      await f.pool.query(
        'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [id],
      )
    ).rows[0]!
    async function refused(actor: string, content: unknown, pattern: RegExp) {
      await f.client.query('BEGIN')
      await f.client.query('SET LOCAL ROLE cms_authenticated_user')
      await f.client.query("SELECT set_config('app.user_id',$1,true)", [actor])
      try {
        await expect(
          f.client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
            id,
            current.revision,
            JSON.stringify(content),
            JSON.stringify(current.meta),
          ]),
        ).rejects.toThrow(pattern)
      } finally {
        await f.client.query('ROLLBACK')
      }
    }
    for (const part of ['about', 'what', 'faq']) {
      const changed = structuredClone(current.content)
      changed.find(
        (row: { values: Record<string, unknown> }) => row.values.__cms_chapter_part === part,
      ).values.heading = '[Changed shared heading]'
      await refused(volunteer, changed, /shared section is kept by site editors/)
    }
    for (const slug of [
      'core-stories',
      'core-echelon-directory',
      'core-echelon-leadership',
      'core-chapter-directory',
    ]) {
      const definition = definitions.find(row => row.slug === slug)!
      await refused(
        f.actor,
        [
          ...current.content,
          {
            section_def_id: definition.id,
            section_def_version: definition.version,
            values: sectionStartingValues(definition.slots),
          },
        ],
        /Stories and national-only sections/,
      )
    }
    const bound = structuredClone(current.content)
    bound[0].values.__cms_test_binding = { nested: [{ readerKey: 'stories' }] }
    await refused(f.actor, bound, /Stories and national-only sections/)
    const code = structuredClone(current.content)
    code[0].raw_html = '<p>[Page-owned code]</p>'
    await refused(f.actor, code, /uses shared sections/)
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + id + '?section=1')
    await expect(page.getByRole('status').filter({ hasText: 'Made from this page' })).toBeVisible()
    await expect(page.locator('.inspector').getByRole('button', { name: 'Done', exact: true })).toBeVisible()
    await page.locator('.inspector').getByRole('button', { name: 'Done', exact: true }).focus()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('status').filter({ hasText: 'Made from this page' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Add at end', exact: true }).click()
    const library = page.getByRole('dialog', { name: 'Add a section', exact: true })
    await library.getByLabel('Search sections', { exact: true }).fill('Stories')
    await expect(library.getByTestId('library-card-core-stories')).toHaveCount(0)
    await library.getByLabel('Search sections', { exact: true }).fill('Chapter directory')
    await expect(library.getByTestId('library-card-core-echelon-directory')).toHaveCount(0)
    await expect(library.getByTestId('library-card-core-chapter-directory')).toHaveCount(0)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await canvas(page)
        .locator('html')
        .evaluate(() => document.fonts.ready)
      await page.screenshot({ path: resolve(folder, 'library-' + width + '.png') })
    }
    await library.getByRole('button', { name: 'Page templates', exact: true }).click()
    await expect(
      library.getByText('No saved templates fit this chapter page. Choose a section instead.', { exact: true }),
    ).toBeVisible()
    await expect(library.getByRole('heading', { name: '[Story template]', exact: true })).toHaveCount(0)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await canvas(page)
        .locator('html')
        .evaluate(() => document.fonts.ready)
      await page.screenshot({ path: resolve(folder, 'template-empty-' + width + '.png') })
    }
    await library.getByRole('button', { name: 'Back', exact: true }).click()
    await page.goto('/sites/' + f.site + '/chapters')
    await page
      .locator('tr[data-chapter-id="' + chapter.id + '"]')
      .getByRole('button', { name: '[Reviewed chapter]', exact: true })
      .click()
    await page
      .getByRole('dialog', { name: '[Reviewed chapter]', exact: true })
      .getByRole('button', { name: 'Invite a volunteer', exact: true })
      .click()
    const invitation = page.getByRole('dialog', { name: 'Invite an editor for [Reviewed chapter]', exact: true })
    await invitation.getByRole('textbox', { name: /^Volunteer name/ }).fill('[Chapter editor]')
    await invitation.getByRole('textbox', { name: /^Volunteer email/ }).fill(email)
    await invitation.getByRole('button', { name: 'Invite chapter editor', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Chapter editor invited.' })).toContainText(
      'no email was sent',
    )
    const link = (
      await f.pool.query(
        'SELECT link FROM local_chapter_outbox WHERE chapter_id=$1 AND recipient=$2 ORDER BY created_at DESC,id LIMIT 1',
        [chapter.id, email],
      )
    ).rows[0]!.link as string
    await page.context().clearCookies()
    await page.goto(link)
    await expect(page).toHaveURL(new RegExp('/pages/' + id + '$'))
    await page.goto('/pages/' + id + '?section=2')
    await expect(page.getByRole('status').filter({ hasText: 'Site editors only' })).toBeVisible()
    await expect(page.getByLabel('Heading', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await canvas(page)
        .locator('html')
        .evaluate(() => document.fonts.ready)
      await page.screenshot({ path: resolve(folder, 'shared-' + width + '.png') })
    }
    await page.locator('.inspector').getByRole('button', { name: 'Back', exact: true }).click()
    await page.goto('/pages/' + id + '?section=9')
    await expect(page.getByRole('status').filter({ hasText: 'Site editors only' })).toBeVisible()
    await page.locator('.inspector').getByRole('button', { name: 'Done', exact: true }).click()
    await page.goto('/pages/' + id + '?section=3')
    await page
      .locator('.inspector')
      .getByLabel('First paragraph', { exact: true })
      .fill('[Chapter-owned updated words]')
    await expect(canvas(page).getByText('[Chapter-owned updated words]', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    await expect(page.getByRole('button', { name: 'Submit for review', exact: true })).toBeVisible()
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const latest = (
      await f.client.query(
        'SELECT c.revision,v.config FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.id=$1',
        [chapter.id],
      )
    ).rows[0]!
    await saveChapterInTransaction(f.client, f.site, chapter.id, latest.revision, 'reviewed-chapter', {
      ...latest.config,
      sections: { ...latest.config.sections, socialFirst: true, events: false },
    })
    const stored = (
      await f.client.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [id],
      )
    ).rows[0]!.content
    expect(stored[1].values.__cms_chapter_part).toBe('social')
    expect(
      stored.find((row: { values: Record<string, unknown> }) => row.values.__cms_chapter_part === 'paragraph').values
        .paragraph_one,
    ).toBe('[Chapter-owned updated words]')
    expect(
      JSON.stringify(
        stored.find((row: { values: Record<string, unknown> }) => row.values.__cms_chapter_part === 'jumps').values,
      ),
    ).not.toContain('#ech-demo-events')
    await f.client.query('COMMIT')
    await page.goto('/pages/' + id + '?section=1')
    await expect(canvas(page).getByRole('link', { name: 'Events', exact: true })).toHaveCount(0)
    expect(await f.pool.query('SELECT count(*)::int n FROM story_source_checks').then(result => result.rows[0].n)).toBe(
      0,
    )
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    f.client.release()
    await f.pool.end()
  }
})
