import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sectionStartingValues } from '@cms/schema'
import { demoSpeakersCollection } from '@cms/seeds'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn, treeLabels } from '../helpers.ts'
test('page-linked list leave preserves page words, cancels cleanly and saves only valid private items before navigation', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/inline-list-leave/' + info.project.name),
    destinationTitle = '[Inline destination ' + randomUUID().slice(0, 8) + ']'
  await mkdir(folder, { recursive: true })
  let release = () => {},
    native = 0
  page.on('dialog', async dialog => {
    native++
    await dialog.dismiss()
  })
  try {
    await c.query('BEGIN')
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const model = demoSpeakersCollection,
      created = (
        await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
          f.site,
          'speakers',
          '[Speakers]',
          'speakers',
          JSON.stringify(model.fields),
          JSON.stringify(model.presentation),
        ])
      ).rows[0]!,
      listId = created.collection_id
    await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [listId, created.revision])
    await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
      listId,
      JSON.stringify([
        { id: null, stableKey: 'opening', values: { name: '[Name]', role: '[Role]', bio: '', photo: '' } },
      ]),
    ])
    await c.query('SELECT * FROM app.publish_collection_entries($1,1)', [listId])
    const pageId = f.pages[0]!,
      content = []
    for (const slug of ['core-page-header', 'core-speakers-grid']) {
      const def = (
        await c.query(
          'SELECT d.id,v.version,v.slots FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug=$1 AND d.site_id IS NULL ORDER BY v.version DESC LIMIT 1',
          [slug],
        )
      ).rows[0]!
      content.push({
        section_def_id: def.id,
        section_def_version: def.version,
        values: {
          ...sectionStartingValues(def.slots),
          heading: slug === 'core-page-header' ? '[Page words]' : '[Speakers]',
        },
        label: slug === 'core-page-header' ? 'Page header' : 'Speakers',
        hidden: false,
        hidden_at: [],
      })
    }
    const revision = (await c.query('SELECT revision FROM pages WHERE id=$1', [pageId])).rows[0]!.revision
    await c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      pageId,
      revision,
      JSON.stringify(content),
      JSON.stringify({ description: '[Page description]', noindex: false }),
    ])
    const destination = (
      await c.query('SELECT app.create_page($1,$2,$3) AS id', [
        f.site,
        'inline-destination-' + randomUUID().slice(0, 8),
        destinationTitle,
      ])
    ).rows[0]!.id
    await c.query('COMMIT')
    const readPage = async () =>
        (
          await f.pool.query(
            'SELECT p.published_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
            [pageId],
          )
        ).rows[0]!,
      readItems = async () =>
        (
          await f.pool.query(
            'SELECT e.id,e.published_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.id',
            [listId],
          )
        ).rows,
      beforePage = await readPage(),
      beforeItems = await readItems(),
      base = '/pages/' + pageId
    await signIn(page, 'editor@example.test')
    await page.goto(base + '?section=0')
    await page.locator('#slot-0-heading').fill('[Kept page draft]')
    await expect.poll(async () => (await readPage()).content[0].values.heading).toBe('[Kept page draft]')
    await treeLabels(page).nth(1).click()
    const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true }),
      adding = page.getByRole('dialog', { name: 'Add speaker', exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      search = page.getByRole('dialog', { name: 'Search or jump to', exact: true }),
      name = adding.getByLabel(/^Name/),
      role = adding.getByLabel(/^Role/)
    const capture = async (label: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 900 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, label + '-' + width + '.png') })
        }
      },
      attempt = async () => {
        await page.keyboard.press('Control+k')
        await search.getByRole('combobox').fill(destinationTitle)
        await search.getByRole('option').filter({ hasText: destinationTitle }).click()
        await expect(search).toHaveCount(0)
        await expect(leave).toBeVisible()
      }
    await inspector.getByRole('button', { name: 'Add speaker', exact: true }).click()
    await name.fill('[Cancelled name]')
    await adding.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(adding).toHaveCount(0)
    expect(await readItems()).toEqual(beforeItems)
    expect((await readPage()).content[0].values.heading).toBe('[Kept page draft]')
    await inspector.getByRole('button', { name: 'Add speaker', exact: true }).click()
    await name.fill('[Unsaved name]')
    await role.fill('[Role]')
    await attempt()
    await capture('choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('[Unsaved name]')
    await attempt()
    await page.keyboard.press('Escape')
    await expect(leave).toHaveCount(0)
    await expect(role).toHaveValue('[Role]')
    await attempt()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL('/pages/' + destination)
    expect(await readItems()).toEqual(beforeItems)
    expect(await readPage()).toEqual(beforePage)
    await page.goto(base + '?section=1')
    await inspector.getByRole('button', { name: 'Add speaker', exact: true }).click()
    await role.fill('[Role]')
    await attempt()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Name is required')
    await capture('validation-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await name.fill('[Saved inline name]')
    let fail = true
    await page.route('**/pages/' + pageId + '*', async route => {
      if (fail && route.request().method() === 'POST' && route.request().postData()?.includes('entryRevision')) {
        fail = false
        await route.abort('failed')
      } else await route.continue()
    })
    await attempt()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('save could not be confirmed')
    await capture('save-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('[Saved inline name]')
    expect(await readItems()).toEqual(beforeItems)
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let waiting = false
    await page.route('**/pages/' + pageId + '*', async route => {
      if (!waiting && route.request().method() === 'POST' && route.request().postData()?.includes('entryRevision')) {
        waiting = true
        await gate
      }
      await route.fallback()
    })
    await attempt()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('status')).toContainText('Saving your draft')
    await capture('saving-before-leaving')
    release()
    await expect(page).toHaveURL('/pages/' + destination)
    const items = await readItems(),
      made = items.filter(item => item.values.name === '[Saved inline name]')
    expect(items).toHaveLength(beforeItems.length + 1)
    expect(made).toHaveLength(1)
    expect(made[0].published_version_id).toBeNull()
    expect(items.find(item => item.id === beforeItems[0].id)).toEqual(beforeItems[0])
    expect(await readPage()).toEqual(beforePage)
    expect(native).toBe(0)
  } finally {
    release()
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
