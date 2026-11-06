import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { compileSection, sectionScopeSelector } from '../../packages/renderer/src/index.ts'
import { e2eTarget } from '../test-target.ts'
import { canvas, signIn } from './helpers.ts'
import { rawRequest } from './http.ts'
async function capture(page: Page, name: string, engine: string) {
  const folder = resolve('../.r8-progress/step-5/native-lists/' + engine)
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await expect(page.getByText('Opening the page preview…', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Updating page preview…', { exact: true })).toHaveCount(0)
    await expect
      .poll(() =>
        page.locator('.canvas-viewport').evaluate(viewport => {
          const frame = viewport.querySelector('iframe')
          return (
            !frame ||
            viewport.getAttribute('data-zoom') !== 'fit' ||
            Math.abs(
              frame.getBoundingClientRect().width -
                Math.min(
                  viewport.clientWidth - parseFloat(getComputedStyle(viewport).paddingInlineStart || '0'),
                  parseFloat(getComputedStyle(frame).width),
                ),
            ) < 2
          )
        }),
      )
      .toBe(true)
    await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await expect(
    page
      .getByRole('toolbar', { name: 'Selected section actions', exact: true })
      .getByText('Workshops', { exact: true }),
  ).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(
    () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
}
test('an Editor edits and adds native workshops in original table markup, with valid empty-state controls and private drafts', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const target = e2eTarget(),
    client = new Client({ connectionString: `postgres://cms:cms@${target.host}:${target.port}/${target.database}` })
  await client.connect()
  let listId = '',
    pageId = '',
    slug = ''
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await client.query('BEGIN')
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const suffix = randomUUID().slice(0, 8),
      publicHost = 'r8-original-' + suffix + '.staging.localhost',
      tokens = (
        await client.query(
          "SELECT v.tokens FROM sites s JOIN themes h ON h.site_id=s.id JOIN theme_versions v ON v.id=h.published_version_id WHERE s.slug='demo'",
        )
      ).rows[0]!.tokens,
      site = (
        await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
          'r8-original-' + suffix,
          'Original list editing',
          'general',
          publicHost,
          JSON.stringify(tokens),
          '[]',
        ])
      ).rows[0]!.id
    const editor = (await client.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    await client.query("SELECT app.set_site_membership($1,$2,'editor')", [editor, site])
    const reader = 'workshops',
      fields = [
        { key: 'title', label: 'Workshop title', type: 'text', required: false },
        { key: 'presenter', label: 'Presenter', type: 'text', required: false },
      ]
    const list = (
      await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        site,
        'workshops-' + suffix,
        'Workshops',
        reader,
        JSON.stringify(fields),
        JSON.stringify({
          schemaVersion: 1,
          titleField: 'title',
          subtitleField: 'presenter',
          imageField: null,
          groupField: null,
        }),
      ])
    ).rows[0]!
    listId = list.collection_id
    await client.query('SELECT * FROM app.publish_collection_schema($1,$2)', [listId, list.revision])
    await client.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
      listId,
      JSON.stringify([
        {
          id: null,
          stableKey: 'source-workshop',
          values: { title: 'Original workshop', presenter: 'Original presenter' },
        },
      ]),
    ])
    await client.query('SELECT * FROM app.publish_collection_entries($1,1)', [listId])
    const slots = [
        {
          id: 'workshops',
          kind: 'repeat' as const,
          label: 'Workshops',
          constraints: {
            collection: true,
            item: {
              unit: 'Workshop',
              fields: [
                { id: 'title', kind: 'text', label: 'Workshop title' },
                { id: 'presenter', kind: 'text', label: 'Presenter' },
              ],
            },
          },
        },
      ],
      html =
        '<div><h1>Original workshop table</h1><table data-toggle="table"><thead><tr><th>Workshop title</th><th>Presenter</th></tr></thead><tbody>{{#workshops}}<tr><th>{{title}}</th><td>{{presenter}}</td></tr>{{/workshops}}</tbody></table></div>',
      definitionSlug = 'original-list-' + suffix,
      compiled = compileSection({ sourceHtml: html, slots, scopeSelector: sectionScopeSelector(definitionSlug)! })
    const def = (
      await client.query(
        'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        [
          definitionSlug,
          'Workshops',
          'Better Together',
          html,
          '',
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Original list browser fixture',
          false,
          'legacy',
          null,
          null,
          'site',
          site,
        ],
      )
    ).rows[0]!
    slug = 'original-list-' + suffix
    pageId = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, 'Original workshop table']))
      .rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        {
          section_def_id: def.section_def_id,
          section_def_version: 1,
          values: { workshops: { readerKey: reader, selection: { mode: 'automatic', limit: 200 } } },
        },
      ]),
      '{}',
    ])
    await client.query('SELECT app.publish_theme($1,1)', [site])
    await client.query('SELECT app.publish_global_elements($1,1,1)', [site])
    await client.query('SELECT app.publish_page($1,1,1,NULL,$2)', [pageId, '[]'])
    await client.query('SELECT app.publish_navigation($1,1)', [site])
    await client.query('SELECT app.save_site_file_bundle($1,0,$2)', [
      site,
      JSON.stringify({
        version: 1,
        files: [],
        styles: [],
        scripts: [],
        original: {
          version: 1,
          definitions: [{ section_def_id: def.section_def_id, section_def_version: 1 }],
          pages: [{ pageId, html: { lang: 'en' }, body: {}, header: false, footer: false, quirks: true }],
        },
      }),
    ])
    await client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + site + '/publishing')
    await page.getByRole('button', { name: 'Publish selected (1)', exact: true }).click()
    const review = page.getByLabel('Selected changes review', { exact: true })
    await expect(review).toContainText('Site scripts and files')
    await review.getByRole('button', { name: 'Publish selected (1)', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    const publicBefore = await rawRequest({ host: publicHost, path: '/' + slug })
    expect(publicBefore.status).toBe(200)
    expect(publicBefore.body).toContain('<tr><th>Original workshop</th><td>Original presenter</td></tr>')
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL(/\/sign-in(?:[?#]|$)/)
    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + pageId)
    await expect(page.getByText('Opening the page preview…', { exact: true })).toHaveCount(0)
    await canvas(page).getByText('Original workshop', { exact: true }).click()
    await expect(
      page
        .getByRole('toolbar', { name: 'Selected list item actions', exact: true })
        .getByRole('button', { name: 'Edit workshop', exact: true }),
    ).toBeVisible()
    expect(
      await canvas(page)
        .locator('body')
        .evaluate(() => document.compatMode),
    ).toBe('BackCompat')
    const ghost = canvas(page).locator('[data-cms-editor-list-ghost]')
    await expect(ghost).toHaveCount(1)
    await expect(canvas(page).locator('tbody > div,tbody > cms-slot')).toHaveCount(0)
    await capture(page, 'original-table-selected', info.project.name)
    // Quirks mode folds CSS class case; minified .a/.A must never turn a
    // button into a fixed toast. The vendor also owns its scrollable wrapper.
    await expect(ghost.getByRole('button', { name: 'Add workshop', exact: true })).toHaveCSS('position', 'static')
    await canvas(page)
      .locator('table')
      .evaluate(table => {
        const wrapper = document.createElement('div'),
          body = document.createElement('div')
        wrapper.className = 'bootstrap-table'
        body.className = 'fixed-table-body'
        table.before(wrapper)
        wrapper.append(body)
        body.append(table)
      })
    await expect.poll(() => ghost.evaluate(node => node.closest('.bootstrap-table') === null)).toBe(true)
    // The original Bootstrap table rebuilds its rows during a search or sort.
    await canvas(page)
      .locator('tbody')
      .evaluate(node => {
        node.innerHTML = [...node.querySelectorAll('[data-cms-entry]')].map(row => row.outerHTML).join('')
      })
    await expect(ghost.getByRole('button', { name: 'Add workshop', exact: true })).toBeVisible()
    await ghost.getByRole('button', { name: 'Add workshop', exact: true }).click()
    const adding = page.getByRole('dialog', { name: 'Add workshop', exact: true })
    await expect(adding.getByRole('button', { name: 'Save workshop', exact: true })).toBeDisabled()
    await capture(page, 'new-workshop-empty', info.project.name)
    await adding.getByLabel('Workshop title', { exact: false }).fill('A coordinator addition')
    await adding.getByLabel('Presenter', { exact: true }).fill('New presenter')
    await adding.getByRole('button', { name: 'Save workshop', exact: true }).click()
    await expect(adding).toBeHidden()
    await expect(canvas(page).getByText('A coordinator addition', { exact: true })).toBeVisible()
    expect((await rawRequest({ host: publicHost, path: '/' + slug })).body).toBe(publicBefore.body)
    await capture(page, 'new-workshop-private', info.project.name)
    await page.getByRole('button', { name: 'Phone', exact: true }).click()
    await capture(page, 'original-table-phone', info.project.name)
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const revision = (await client.query('SELECT entry_revision FROM collections WHERE id=$1', [listId])).rows[0]!
      .entry_revision
    await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [listId, revision, '[]'])
    await client.query('COMMIT')
    await page.reload()
    await expect(page.getByText('Opening the page preview…', { exact: true })).toHaveCount(0)
    await canvas(page).getByRole('heading', { name: 'Original workshop table', exact: true }).click()
    await expect(canvas(page).locator('[data-cms-entry]')).toHaveCount(0)
    await expect(canvas(page).getByRole('button', { name: 'Add workshop', exact: true })).toBeVisible()
    await expect(canvas(page).locator('tbody > div,tbody > cms-slot')).toHaveCount(0)
    expect((await rawRequest({ host: publicHost, path: '/' + slug })).body).toBe(publicBefore.body)
    await capture(page, 'original-table-empty-list', info.project.name)
    expect(errors).toEqual([])
  } finally {
    await client.query('ROLLBACK')
    await client.end()
  }
})
