import { E2E_PORTS } from '../test-ports.ts'
import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn, canvas } from './helpers.ts'
async function publish(page: Page, count: number) {
  const button = page.getByRole('button', { name: `Publish selected (${count})`, exact: true })
  await button.click()
  await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
  await button.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
}
test('a sourced number updates two published pages through review while Editors only pick and local labels stay', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/data-values/' + info.project.name),
    id = randomUUID(),
    other = randomUUID(),
    config = {
      schemaVersion: 1,
      name: 'Shared site look',
      dataValues: [
        {
          id,
          label: 'Projects',
          value: '152',
          unit: '',
          source: '2026 Annual Report, p. 4',
          sourcePageId: null,
          asOf: 'FY2025',
          status: 'matches-report',
          showSource: false,
        },
        {
          id: other,
          label: 'Countries in the global network',
          value: '69',
          unit: '',
          source: '2026 Annual Report, p. 4',
          sourcePageId: null,
          asOf: 'FY2025',
          status: 'matches-report',
          showSource: false,
        },
      ],
    },
    visitor = await browser.newContext({ javaScriptEnabled: false }),
    view = await visitor.newPage()
  try {
    await mkdir(folder, { recursive: true })
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      editor = (await c.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    async function command(user: string, sql: string, args: unknown[]) {
      await c.query('BEGIN')
      try {
        await c.query('SET LOCAL ROLE cms_authenticated_user')
        await c.query("SELECT set_config('app.user_id',$1,true)", [user])
        const result = await c.query(sql, args)
        await c.query('COMMIT')
        return result
      } catch (error) {
        await c.query('ROLLBACK')
        throw error
      }
    }
    const head = async () =>
      (
        await c.query(
          'SELECT h.revision,v.settings FROM site_settings h LEFT JOIN site_setting_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
          [f.site],
        )
      ).rows[0]!
    await expect(
      command(editor, 'SELECT app.save_site_settings_draft($1,0,$2)', [f.site, JSON.stringify(config)]),
    ).rejects.toMatchObject({ code: 'CMS02' })
    await expect(
      command(actor, 'SELECT app.save_site_settings_draft($1,0,$2)', [
        f.site,
        JSON.stringify({ ...config, dataValues: [{ ...config.dataValues[0], source: '' }] }),
      ]),
    ).rejects.toMatchObject({ code: 'CMS04' })
    await command(actor, 'SELECT app.save_site_settings_draft($1,0,$2)', [f.site, JSON.stringify(config)])
    const definition = (
      await c.query(
        "SELECT d.id,max(v.version)::int version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='core-stats' AND d.scope='global' GROUP BY d.id",
      )
    ).rows[0]!
    for (const [index, pageId] of f.pages.entries()) {
      const head = (
        await c.query(
          'SELECT p.revision,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [pageId],
        )
      ).rows[0]!
      await command(actor, 'SELECT app.save_page_draft($1,$2,$3,$4)', [
        pageId,
        head.revision,
        JSON.stringify([
          ...head.content,
          {
            section_def_id: definition.id,
            section_def_version: definition.version,
            values: {
              heading: '[Local impact]',
              stats: { items: ['i1'] },
              stats__i1__value: '152',
              stats__i1__label: '[Local label ' + index + ']',
              stats__i1__context: 'FY2025',
              __cms_data_values: { stats__i1__value: { parts: [{ valueId: id }] } },
            },
          },
        ]),
        JSON.stringify({ description: '[Locally reviewed number with a source]' }),
      ])
    }
    const pageRevision = (await c.query('SELECT revision FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!.revision
    await expect(
      command(actor, "SELECT app.publish_page($1,$2,3,NULL,'[]')", [f.pages[0], pageRevision]),
    ).rejects.toMatchObject({ code: 'CMS04' })
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/data')
    await expect(page.getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
    await expect(page.getByText('Used on 2 pages', { exact: true })).toBeVisible()
    async function capture(name: string, target: Page = page) {
      for (const width of [1440, 1024]) {
        await target.setViewportSize({ width, height: 950 })
        expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const records = target.locator('table[data-layout=records]')
        if (await records.isVisible()) {
          expect(await records.evaluate(n => n.getBoundingClientRect().width <= n.parentElement!.clientWidth + 1)).toBe(
            true,
          )
          if (name === 'numbers-list')
            expect(
              await records
                .getByRole('button', { name: 'Countries in the global network', exact: true })
                .locator('span')
                .evaluate(n => n.scrollWidth <= n.clientWidth + 1),
            ).toBe(true)
        }
        const details = target.getByRole('group', { name: 'Number details', exact: true })
        if (await details.isVisible()) {
          const handle = details.getByRole('separator', { name: 'Resize Number details', exact: true })
          await handle.press('End')
          await expect
            .poll(async () => {
              const panel = await details.boundingBox(),
                table = await target.locator('table[data-layout=records]').boundingBox()
              return panel!.x - table!.x - table!.width
            })
            .toBeGreaterThanOrEqual(0)
          await expect
            .poll(async () => (await target.locator('table[data-layout=records]').boundingBox())!.width)
            .toBeGreaterThanOrEqual(300)
          await handle.dblclick()
          await expect(details.getByRole('button', { name: 'Save draft', exact: true })).toBeInViewport()
        }
        await target.screenshot({ path: resolve(folder, name + '-' + width + '.png'), fullPage: true })
      }
    }
    await capture('numbers-list')
    await page.getByRole('button', { name: 'Add a number', exact: true }).click()
    await expect(page.getByLabel('What it counts', { exact: true })).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
    await capture('add-number')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page
      .getByRole('alertdialog', { name: 'Before you leave', exact: true })
      .getByRole('button', { name: 'Discard changes', exact: true })
      .click()
    await expect(page.getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
    expect((await head()).settings.dataValues).toHaveLength(2)
    await page.getByRole('button', { name: 'Countries in the global network', exact: true }).click()
    const fixed = page.getByRole('group', { name: 'Number details', exact: true })
    await expect(fixed.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
    await expect(fixed.locator('button[data-variant=primary],button[data-variant=publish]')).toHaveCount(1)
    await fixed.getByRole('button', { name: 'Number actions', exact: true }).click()
    await expect(fixed.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled()
    await expect(fixed.getByRole('button', { name: 'Mark as checked', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await fixed.getByLabel('Status', { exact: true }).selectOption('does-not-change')
    await expect(fixed.getByLabel('Value', { exact: true })).toHaveJSProperty('readOnly', true)
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Number draft saved' })).toBeVisible()
    await expect(fixed.getByRole('button', { name: 'Save draft', exact: true })).toBeInViewport()
    await capture('fixed-number')
    const fixedHead = await head()
    await expect(
      command(actor, 'SELECT app.save_site_settings_draft($1,$2,$3)', [
        f.site,
        fixedHead.revision,
        JSON.stringify({
          ...fixedHead.settings,
          dataValues: fixedHead.settings.dataValues.map((row: { id: string }) =>
            row.id === other ? { ...row, value: '70' } : row,
          ),
        }),
      ]),
    ).rejects.toMatchObject({ code: 'CMS04' })
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.goto('/sites/' + f.site + '/publishing')
    await expect(page.getByText(/Projects: added 152 · 2 pages/).first()).toBeVisible()
    await publish(page, 3)
    for (const path of ['/', '/visit']) {
      await view.goto('http://' + f.host + `:${E2E_PORTS.site}` + path)
      await expect(view.locator('.core-number')).toHaveText('152')
    }
    await page.goto('/sites/' + f.site + '/data')
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await page.getByLabel('Value', { exact: true }).fill('158')
    await capture('edit-number')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'draft saved' })).toBeVisible()
    for (const path of ['/', '/visit']) {
      await view.goto('http://' + f.host + `:${E2E_PORTS.site}` + path)
      await expect(view.locator('.core-number')).toHaveText('152')
    }
    const latest = await head()
    await expect(
      command(actor, 'SELECT app.save_site_settings_draft($1,$2,$3)', [
        f.site,
        latest.revision,
        JSON.stringify({
          ...latest.settings,
          dataValues: latest.settings.dataValues.filter((row: { id: string }) => row.id !== id),
        }),
      ]),
    ).rejects.toMatchObject({ code: 'CMS04' })
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
    await expect(page.getByText(/Projects changed from 152 to 158 · 2 pages/).first()).toBeVisible()
    await capture('number-publish-review')
    const apply = page.getByRole('button', { name: 'Publish selected (1)', exact: true })
    await apply.click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    for (const [index, path] of ['/', '/visit'].entries()) {
      await view.goto('http://' + f.host + `:${E2E_PORTS.site}` + path)
      await expect(view.locator('.core-number')).toHaveText('158')
      await expect(view.getByRole('heading', { name: '[Local label ' + index + ']', exact: true })).toBeVisible()
    }
    await page.goto('/sites/' + f.site + '/data')
    await page.getByRole('button', { name: 'Fill from a file', exact: true }).click()
    const rejected = page.getByRole('dialog', { name: 'Fill numbers from a file', exact: true })
    await rejected.getByLabel('Address', { exact: true }).fill('https://127.0.0.1/numbers.json')
    await rejected.getByRole('button', { name: 'Review file', exact: true }).click()
    await expect(rejected.getByRole('alert')).toContainText('public https')
    await rejected.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(rejected).toBeHidden()
    await page.goto('/sites/' + f.site + '/data')
    await page.getByRole('button', { name: 'Fill from a file', exact: true }).click()
    const fill = page.getByRole('dialog', { name: 'Fill numbers from a file', exact: true })
    await fill.getByLabel('Or choose a JSON or CSV file', { exact: true }).setInputFiles({
      name: 'numbers.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify([
          { label: 'Projects', value: '160' },
          { label: 'Countries in the global network', value: '70', source: '2026 Annual Report, p. 4' },
        ]),
      ),
    })
    await expect(fill.getByRole('button', { name: 'Save 1 change as a draft', exact: true })).toBeDisabled()
    await fill.getByLabel('Source for Projects', { exact: true }).fill('2026 Annual Report, p. 4')
    await capture('file-number-review')
    await fill.getByRole('button', { name: 'Save 1 change as a draft', exact: true }).click()
    await expect(fill).toBeHidden()
    expect((await head()).settings.dataValues.find((row: { id: string }) => row.id === id)).toMatchObject({
      value: '160',
      status: 'needs-checking',
    })
    expect((await head()).settings.dataValues.find((row: { id: string }) => row.id === other)).toMatchObject({
      value: '69',
      status: 'does-not-change',
    })
    await view.goto('http://' + f.host + `:${E2E_PORTS.site}/`)
    await expect(view.locator('.core-number')).toHaveText('158')
    await view.close()
    await page.close()
    const editorProfile = await browser.newContext(),
      editing = await editorProfile.newPage()
    try {
      await signIn(editing, 'editor@example.test')
      expect((await editing.request.get('/sites/' + f.site + '/data')).status()).toBe(404)
      await editing.goto('/pages/' + f.pages[0])
      await canvas(editing).getByText('158', { exact: true }).click()
      await expect(editing.getByLabel('Use a saved number', { exact: true })).toBeVisible()
      await editing.getByLabel('Use a saved number', { exact: true }).selectOption(other)
      await expect(canvas(editing).getByText('69', { exact: true })).toBeVisible()
      await expect(editing.getByLabel('Words before the number', { exact: true })).toBeHidden()
      await editing.locator('summary').filter({ hasText: 'Words around this number' }).click()
      await editing.getByLabel('Words before the number', { exact: true }).fill('[Prefix]')
      await editing.getByLabel('Words before the number', { exact: true }).fill('')
      await expect(editing.getByLabel('Words before the number', { exact: true })).toBeVisible()
      await capture('editor-number-picker', editing)
      await editing.getByRole('button', { name: 'Use a number just on this page', exact: true }).click()
      await editing.getByLabel('What it means', { exact: true }).fill('')
      await editing.getByRole('button', { name: 'Use a saved number', exact: true }).click()
      await editing.getByLabel('Use a saved number', { exact: true }).selectOption(other)
      await expect(editing.getByLabel('What it means', { exact: true })).toHaveValue('Countries in the global network')
      await editing.getByLabel('What it means', { exact: true }).fill('[Our local reach]')
      await editing.getByLabel('Use a saved number', { exact: true }).selectOption(id)
      await expect(editing.getByLabel('What it means', { exact: true })).toHaveValue('[Our local reach]')
      await expect(canvas(editing).getByText('158', { exact: true })).toBeVisible()
      await expect(editing.getByRole('link', { name: 'Data values', exact: true })).toHaveCount(0)
    } finally {
      await editorProfile.close()
    }
    const before = (await head()).settings
    expect(before.dataValues.find((row: { id: string }) => row.id === id).value).toBe('160')
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await visitor.close()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
