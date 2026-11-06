import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { e2eTarget } from '../test-target.ts'
import { canvas, fetchPublic, publish, saveDraft, savedState, signIn } from './helpers.ts'

// V1 Echelon's registration rule (src/event-readiness.js; SPEC §6.9): a
// registration call to action that still points at its "#register" placeholder
// is hidden on the live page, but shown on the editing canvas so an editor can
// select it and give it a real address. With one, and published, it appears and
// the “coming soon” note steps aside. V2 does this without a public script.
async function database() {
  const { database: name, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${name}` })
  await client.connect()
  return client
}

async function fixture(page: Page) {
  const client = await database()
  const slug = `registration-${Date.now()}-${Math.floor(Math.random() * 10000)}`
  try {
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const sourceHtml =
      '<section class="hero"><h1>{{title}}</h1><a class="button registration-unavailable" href="{{dest}}" data-registration-cta="">{{words}}</a>' +
      '<p class="status" data-registration-status="">Registration details coming soon</p></section>'
    const sourceCss =
      '.registration-unavailable{display:none!important}.button{display:inline-flex;padding:8px 16px;background:#5c1f22;color:#fff}'
    const slots = [
      { id: 'title', label: 'Hero title', kind: 'text' as const, constraints: {} },
      { id: 'dest', label: 'Register · destination', kind: 'link' as const, constraints: { destinationOnly: true } },
      { id: 'words', label: 'Register · label', kind: 'text' as const, constraints: {} },
    ]
    const compiled = compileSection({ sourceHtml, sourceCss, slots, scopeSelector: sectionScopeSelector(slug)! })
    expect(compiled.blocking).toEqual([])
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const definition = (
      await client.query(
        'SELECT * FROM app.save_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
        [
          slug,
          'Event hero',
          'Tests',
          sourceHtml,
          sourceCss,
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Registration fixture',
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
    const pageId = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, 'Event registration']))
      .rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        {
          section_def_id: definition,
          section_def_version: 1,
          label: 'Hero',
          hidden: false,
          hidden_at: [],
          values: { title: 'Echelon Symposium', dest: { url: '#register' }, words: 'Register Now' },
        },
      ]),
      '{}',
    ])
    await client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto(`/pages/${pageId}`)
    return slug
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }
}

test('a placeholder registration button can be edited on the canvas and goes live once it has a real address', async ({
  page,
}) => {
  const slug = await fixture(page)
  const button = canvas(page).locator('a[data-registration-cta]')
  await expect(button).toBeVisible()
  await expect(button).toHaveAttribute('title', 'Hidden on the published page until it links to a registration address')

  // Published as it is, the placeholder stays hidden and the note shows.
  await publish(page)
  let live = await fetchPublic(`/${slug}`)
  expect(live.status).toBe(200)
  expect(live.body).toContain(
    '<a class="button registration-unavailable" href="#register" data-registration-cta="">Register Now</a>',
  )
  expect(live.body).toContain('<p class="status" data-registration-status="">Registration details coming soon</p>')

  await button.click()
  const group = page.getByRole('complementary', { name: 'Inspector' }).getByRole('group', { name: 'Register' })
  await group.getByRole('button', { name: 'Change', exact: true }).click()
  await group.getByLabel('Address', { exact: true }).fill('https://events.example.org/echelon/register')
  await page
    .getByRole('dialog', { name: 'Change link', exact: true })
    .getByRole('button', { name: 'Done', exact: true })
    .click()
  await saveDraft(page)
  await expect(savedState(page)).toHaveText('All changes saved')
  await expect(button).toHaveAttribute('href', 'https://events.example.org/echelon/register')
  await expect(button).toBeVisible()
  await publish(page)
  live = await fetchPublic(`/${slug}`)
  expect(live.body).toContain(
    '<a class="button" href="https://events.example.org/echelon/register" data-registration-cta="">Register Now</a>',
  )
  expect(live.body).toContain(
    '<p class="status registration-unavailable" data-registration-status="">Registration details coming soon</p>',
  )
  expect(live.body).not.toMatch(/<script/i)
})
