import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { SOURCE_DRAWINGS, sourceSampleValues, type SlotDef } from '@cms/schema'
import { e2eTarget } from '../test-target.ts'
import { canvas, fetchPublic, publish, savedState, signIn } from './helpers.ts'

// LIB-02: V1's numbered cards as a list an editor grows, reorders and trims
// in the inspector, edits on the canvas like any other words, and publishes.
const [heart, home] = Object.entries(SOURCE_DRAWINGS)
const compass = Object.entries(SOURCE_DRAWINGS).find(([, drawing]) => drawing.label === 'Compass')!

async function database() {
  const { database: name, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${name}` })
  await client.connect()
  return client
}

async function fixture(page: Page) {
  const client = await database()
  const slug = `cards-${Date.now()}-${Math.floor(Math.random() * 10000)}`
  let pageId = ''
  try {
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const sourceHtml =
      '<section class="grid"><h1>{{heading}}</h1><div class="cards">{{#cards}}<article class="card">' +
      '<span class="icon" aria-hidden="true">{{icon}}</span><h3>{{title}}</h3></article>{{/cards}}</div></section>'
    const slots: SlotDef[] = [
      { id: 'heading', kind: 'text', label: 'Heading', constraints: { sourceSample: 'Why it works' } },
      {
        id: 'cards',
        kind: 'repeat',
        label: 'Cards',
        constraints: {
          item: {
            unit: 'Card',
            min: 1,
            max: 6,
            fields: [
              { id: 'icon', kind: 'text', label: 'Icon', constraints: { presentation: 'v1-source-drawings' } },
              { id: 'title', kind: 'text', label: 'Title', constraints: {} },
            ],
            samples: [
              { icon: heart![0], title: 'Compassionate care' },
              { icon: home![0], title: 'Safe places' },
              { icon: heart![0], title: 'Local roots' },
            ],
          },
        },
      },
    ]
    const sourceCss =
      '.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.card{padding:16px;border:1px solid #ccc}'
    const compiled = compileSection({ sourceHtml, sourceCss, slots, scopeSelector: sectionScopeSelector(slug)! })
    expect(compiled.blocking).toEqual([])
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const definition = (
      await client.query(
        'SELECT * FROM app.save_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
        [
          slug,
          'Feature grid',
          'Cards',
          sourceHtml,
          sourceCss,
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Repeated items fixture',
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
    pageId = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, 'What we do'])).rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        {
          section_def_id: definition,
          section_def_version: 1,
          label: 'Feature grid',
          hidden: false,
          hidden_at: [],
          values: sourceSampleValues(slots),
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
  return { slug, pageId }
}

async function draftValues(pageId: string): Promise<Record<string, unknown>> {
  const client = await database()
  try {
    return (
      await client.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [pageId],
      )
    ).rows[0]!.content[0].values
  } finally {
    await client.end()
  }
}

test('an editor adds, reorders, rewords and removes cards, and the published page shows the list as left', async ({
  page,
}) => {
  const { slug, pageId } = await fixture(page),
    cards = canvas(page).locator('.card:not([data-cms-editor-ghost])'),
    cardTitle = canvas(page).locator('[data-cms-slot="cards__i2__title"]'),
    beforeHover = await cardTitle.boundingBox()
  await expect(cards).toHaveCount(3)
  await cardTitle.hover()
  await expect(page.getByRole('toolbar', { name: 'Selected card actions' })).toHaveCount(0)
  await expect.poll(async () => Math.abs((await cardTitle.boundingBox())!.y - beforeHover!.y)).toBeLessThan(1)
  await cardTitle.click()
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await expect(inspector.getByLabel('Title', { exact: true })).toHaveValue('Safe places')
  await inspector.getByRole('button', { name: 'Back', exact: true }).click()
  const list = inspector.getByRole('group', { name: 'Cards', exact: true })
  await expect(list.locator('li')).toHaveCount(3)
  await list.getByRole('button', { name: 'Add a card', exact: true }).click()
  await expect(inspector.getByLabel('Title', { exact: true })).toHaveValue('')
  await expect(cards).toHaveCount(4)
  await expect(canvas(page).locator('[data-cms-editor-ghost]')).toHaveCount(0)
  await inspector.getByLabel('Title', { exact: true }).fill('Local roots')
  await inspector.getByRole('button', { name: 'Compass', exact: true }).click()
  await inspector.getByRole('button', { name: 'Done', exact: true }).click()
  for (const n of [4, 3, 2]) {
    await list.getByRole('button', { name: `Actions for Card ${n}`, exact: true }).click()
    await list.getByRole('button', { name: `Move Card ${n} up`, exact: true }).click()
  }
  await expect(canvas(page).locator('.card h3')).toHaveText([
    'Local roots',
    'Compassionate care',
    'Safe places',
    'Local roots',
  ])
  const fresh = canvas(page).locator('[data-cms-slot="cards__i4__title"]')
  await fresh.click()
  await fresh.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
  await page.keyboard.type(' together')
  await expect(savedState(page)).toHaveText('All changes saved')
  await expect(canvas(page).locator('.card h3')).toHaveText([
    'Local roots together',
    'Compassionate care',
    'Safe places',
    'Local roots',
  ])
  await expect(cards.first().locator('.icon svg')).toHaveCount(1)
  await inspector.getByRole('button', { name: 'Back', exact: true }).click()
  await list.getByRole('button', { name: 'Actions for Card 3', exact: true }).click()
  await list.getByRole('button', { name: 'Remove Card 3', exact: true }).click()
  await expect(canvas(page).locator('.card h3')).toHaveText([
    'Local roots together',
    'Compassionate care',
    'Local roots',
  ])
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click()
  await expect(canvas(page).locator('.card h3')).toHaveText([
    'Local roots together',
    'Compassionate care',
    'Safe places',
    'Local roots',
  ])
  await list.getByRole('button', { name: 'Actions for Card 4', exact: true }).click()
  await list.getByRole('button', { name: 'Remove Card 4', exact: true }).click()
  await expect(canvas(page).locator('.card h3')).toHaveText([
    'Local roots together',
    'Compassionate care',
    'Safe places',
  ])
  await expect(savedState(page)).toHaveText('All changes saved')
  expect(await draftValues(pageId)).toMatchObject({
    cards: { items: ['i4', 'i1', 'i2'] },
    cards__i4__title: 'Local roots together',
    cards__i4__icon: compass[0],
  })
  expect(await draftValues(pageId)).not.toHaveProperty('cards__i3__title')
  await publish(page)
  const live = await fetchPublic('/' + slug)
  expect(live.status).toBe(200)
  expect([...live.body.matchAll(/<h3>([^<]*)<\/h3>/g)].map(match => match[1])).toEqual([
    'Local roots together',
    'Compassionate care',
    'Safe places',
  ])
  expect(live.body).toContain(`<span class="icon" aria-hidden="true">${compass[1].svg}</span>`)
  expect(live.body).not.toContain('data-cms-slot')
})
