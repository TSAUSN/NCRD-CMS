import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { e2eTarget } from '../test-target.ts'
import { canvas, fetchPublic, publish, savedState, signIn } from './helpers.ts'

// V1's video, map and form sections framed whatever link an editor pasted,
// through a provider check in a script. V2 governs the same field: only that
// kind's providers are accepted, rebuilt into the provider's embed address,
// shown publicly behind a consent card, and allowed as a frame only on the
// pages that show one (governed-embeds.ts).
async function database() {
  const { database: name, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${name}` })
  await client.connect()
  return client
}

async function fixture(page: Page) {
  const client = await database()
  const slug = `video-${Date.now()}-${Math.floor(Math.random() * 10000)}`
  let pageId = ''
  try {
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const sourceHtml = '<section class="video"><h1>{{title}}</h1><div class="frame">{{clip}}</div></section>'
    const slots = [
      { id: 'title', kind: 'text' as const, label: 'Section Title', constraints: {} },
      {
        id: 'clip',
        kind: 'link' as const,
        label: 'Address to embed',
        constraints: {
          destinationOnly: true,
          embed: 'video',
          embedTitle: 'Embedded video',
          embedHelp: 'Paste a YouTube or Vimeo link.',
        },
      },
    ]
    const compiled = compileSection({
      sourceHtml,
      sourceCss: '.video{padding:24px}',
      slots,
      scopeSelector: sectionScopeSelector(slug)!,
    })
    expect(compiled.blocking).toEqual([])
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const definition = (
      await client.query(
        'SELECT * FROM app.save_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
        [
          slug,
          'Video',
          'Media',
          sourceHtml,
          '.video{padding:24px}',
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Governed embed fixture',
          false,
          'legacy',
          null,
          null,
          'site',
          site,
          0,
          null,
        ],
      )
    ).rows[0]!.section_def_id
    pageId = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, 'A year in ninety seconds']))
      .rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        {
          section_def_id: definition,
          section_def_version: 1,
          label: 'Video',
          hidden: false,
          hidden_at: [],
          values: { title: 'Watch' },
        },
      ]),
      '{}',
    ])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }
  await signIn(page, 'root@example.test')
  await page.goto(`/pages/${pageId}`)
  return slug
}

test('an editor pastes a video link, sees what visitors will be offered, and the public page frames only that provider', async ({
  page,
}) => {
  const slug = await fixture(page)
  const frame = canvas(page).locator('.frame')
  // Inserted with no link, the canvas shows V1's instruction; visitors would see nothing.
  await expect(frame).toContainText('Paste a YouTube or Vimeo link.')
  await frame.locator('[data-cms-slot="clip"]').click()
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  const address = inspector.getByLabel('Link from YouTube or Vimeo')
  await address.fill('https://example.org/watch?v=dQw4w9WgXcQ')
  await expect(
    inspector.getByText('This link is not one the page can show. Use a link from YouTube or Vimeo.'),
  ).toBeVisible()
  await address.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await expect(
    inspector.getByText('YouTube video. Visitors see a short notice and choose whether to load it.'),
  ).toBeVisible()
  // The canvas never mounts the provider: an inert card keeps the section selectable.
  await expect(frame).toContainText('YouTube video. Visitors choose whether to load it on the public page.')
  await expect(frame.locator('iframe')).toHaveCount(0)
  await expect(savedState(page)).toHaveText('All changes saved')

  await publish(page)
  const live = await fetchPublic(`/${slug}`)
  expect(live.status).toBe(200)
  expect(live.body).toContain('data-cms-embed-provider="youtube"')
  expect(live.body).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  expect(live.body).not.toMatch(/<iframe[^>]* src=/)
  expect(live.headers['content-security-policy']).toContain(
    "frame-src 'self' https://public.tableau.com https://www.youtube-nocookie.com",
  )
  // A page without an embed allows no provider frames.
  const home = await fetchPublic('/')
  expect(home.headers['content-security-policy']).toContain("frame-src 'self' https://public.tableau.com;")
})
