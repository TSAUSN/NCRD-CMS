import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { e2eTarget } from '../test-target.ts'
import { STAGING_ORIGIN, fetchPublic, publish, signIn } from './helpers.ts'

// D3: V1's FAQ search ran on a page script. V2 marks the box for one fixed,
// code-owned filter that runs only on public pages carrying a marked box,
// under its own hash; without JavaScript the box stays disabled.
async function database() {
  const { database: name, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${name}` })
  await client.connect()
  return client
}

const QUESTIONS = [
  ['How should the HNI be cited?', 'Cite the index by name and date.'],
  ['What does the index measure?', 'Services provided across five areas of need.'],
  ['How often is it updated?', 'Monthly, as service records arrive.'],
]

async function fixture(page: Page) {
  const client = await database()
  const slug = `faq-${Date.now()}-${Math.floor(Math.random() * 10000)}`
  let pageId = ''
  try {
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const sourceHtml =
      '<section class="faq"><h1>{{title}}</h1>' +
      '<input type="search" class="faq-search" aria-label="Search frequently asked questions" disabled data-cms-faq-filter>' +
      QUESTIONS.map(
        ([question, answer]) => `<details class="faq-item"><summary>${question}</summary><p>${answer}</p></details>`,
      ).join('') +
      '<p class="faq-no-results" hidden data-cms-faq-empty>No questions match your search. <button type="button" disabled data-cms-faq-clear>Clear the filter</button></p></section>'
    const slots = [{ id: 'title', kind: 'text' as const, label: 'Title', constraints: {} }]
    const css = '.faq{padding:24px}.faq-item{display:block;padding:8px 0}'
    const compiled = compileSection({ sourceHtml, sourceCss: css, slots, scopeSelector: sectionScopeSelector(slug)! })
    expect(compiled.blocking).toEqual([])
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const definition = (
      await client.query(
        'SELECT * FROM app.save_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
        [
          slug,
          'FAQ',
          'Content',
          sourceHtml,
          css,
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'FAQ filter fixture',
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
    pageId = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, 'Frequently asked questions']))
      .rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        {
          section_def_id: definition,
          section_def_version: 1,
          label: 'FAQ',
          hidden: false,
          hidden_at: [],
          values: { title: 'Questions' },
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

test('a published FAQ search filters its questions with the one governed script, and stays disabled without JavaScript', async ({
  page,
  browser,
}) => {
  const slug = await fixture(page)
  await publish(page)

  const live = await fetchPublic(`/${slug}`)
  expect(live.status).toBe(200)
  expect(live.body.match(/<script>/g)).toHaveLength(1)
  expect(live.headers['content-security-policy']).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/)
  // A page without a marked search box carries no script.
  const home = await fetchPublic('/')
  expect(home.body).not.toContain('<script>')
  expect(home.headers['content-security-policy']).not.toContain('script-src')

  await page.goto(`${STAGING_ORIGIN}/${slug}`)
  const search = page.getByRole('searchbox', { name: 'Search frequently asked questions' })
  await expect(search).toBeEnabled()
  const questions = page.locator('.faq-item')
  await search.fill('cite')
  await expect(questions.filter({ visible: true })).toHaveCount(1)
  await expect(questions.filter({ visible: true })).toContainText('How should the HNI be cited?')
  await search.fill('nothing like this')
  await expect(questions.filter({ visible: true })).toHaveCount(0)
  await expect(page.getByText('No questions match your search.')).toBeVisible()
  await page.getByRole('button', { name: 'Clear the filter' }).click()
  await expect(questions.filter({ visible: true })).toHaveCount(3)
  await expect(page.getByText('No questions match your search.')).toBeHidden()
  await expect(search).toBeFocused()

  const scriptless = await browser.newContext({ javaScriptEnabled: false })
  try {
    const plain = await scriptless.newPage()
    await plain.goto(`${STAGING_ORIGIN}/${slug}`)
    await expect(plain.getByRole('searchbox', { name: 'Search frequently asked questions' })).toBeDisabled()
    await expect(plain.locator('.faq-item')).toHaveCount(3)
  } finally {
    await scriptless.close()
  }
})
