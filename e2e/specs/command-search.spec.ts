import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { echelonFixture } from './fixtures/echelon.ts'
import { signIn, canvas } from './helpers.ts'
test('search supports keyboard, scoped pages, item drawers, errors and guarded navigation', async ({ page }) => {
  test.setTimeout(120_000)
  const f = await echelonFixture(true),
    folder = resolve('../.r8-progress/echelon/search'),
    errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const capture = async (name: string) => {
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (name !== 'item-drawer') {
        const search = page.getByRole('dialog', { name: 'Search or jump to', exact: true }),
          field = search.getByRole('combobox')
        const fit = await field.evaluate(node => {
          const field = node.getBoundingClientRect(),
            parent = node.parentElement!.getBoundingClientRect(),
            style = getComputedStyle(node),
            ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)
          return { left: field.left - ring >= parent.left, right: field.right + ring <= parent.right }
        })
        expect(fit).toEqual({ left: true, right: true })
        const list = search.getByRole('listbox'),
          options = list.getByRole('option')
        if (await options.count()) {
          await expect(search.getByText(/results? · Scroll or use ↑ ↓ to see all/)).toBeVisible()
          await field.press('ArrowUp')
          const selected = list.locator('[aria-selected="true"]'),
            item = await selected.boundingBox(),
            bounds = await list.boundingBox()
          expect(item!.y).toBeGreaterThanOrEqual(bounds!.y)
          expect(item!.y + item!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height)
          await field.press('ArrowDown')
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  try {
    await mkdir(folder, { recursive: true })
    const peoriaSearchName = 'Peoria Chapter search ' + randomBytes(4).toString('hex')
    const longName = 'Long speaker ' + 'an extended name and role '.repeat(12) + '(sample)'
    const token = randomBytes(32).toString('base64url'),
      email = 'search-' + token.slice(0, 8).toLowerCase() + '@example.test'
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const user = (await f.client.query('SELECT app.provision_user($1,$2) AS id', [email, 'Search volunteer (sample)']))
      .rows[0]!.id
    const chapter = (await f.client.query("SELECT id FROM chapters WHERE site_id=$1 AND slug='peoria'", [f.site]))
      .rows[0]!.id
    await f.client.query('SELECT app.assign_chapter_editor($1,$2,true)', [chapter, user])
    // Other scenarios can have an active Echelon copy. Give this page its own
    // searchable CMS name, while keeping the actual chapter heading and scope.
    const peoria = (
      await f.client.query("SELECT id,revision,slug FROM pages WHERE site_id=$1 AND slug='chapters/peoria'", [f.site])
    ).rows[0]!
    await f.client.query('SELECT app.rename_page($1,$2,$3,$4)', [
      peoria.id,
      peoria.revision,
      peoriaSearchName,
      peoria.slug,
    ])
    const list = (
      await f.client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        f.site,
        'search-speakers',
        'Speakers',
        'speakers',
        JSON.stringify([{ key: 'name', label: 'Name', type: 'text', required: true }]),
        JSON.stringify({
          schemaVersion: 1,
          titleField: 'name',
          subtitleField: null,
          imageField: null,
          groupField: null,
        }),
      ])
    ).rows[0]!.collection_id
    await f.client.query('SELECT app.save_collection_entries($1,0,$2)', [
      list,
      JSON.stringify([
        { id: null, stableKey: 'search-one', values: { name: 'Avery Brooks (sample)' } },
        { id: null, stableKey: 'search-long', values: { name: longName } },
      ]),
    ])
    await f.client.query('SELECT app.queue_local_chapter_sign_in($1,$2,$3)', [
      email,
      token,
      `http://127.0.0.1:${E2E_PORTS.admin}`,
    ])
    await f.client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.getByRole('button', { name: /Search or jump to/ }).click()
    let dialog = page.getByRole('dialog', { name: 'Search or jump to', exact: true }),
      input = dialog.getByRole('combobox')
    await expect(input).toBeFocused()
    await expect(dialog.getByRole('option').first()).toBeVisible()
    await capture('initial')
    await input.fill('Avery')
    await expect(dialog.getByRole('option')).toHaveCount(1)
    await expect(dialog.getByRole('option')).toContainText('Avery Brooks (sample)')
    await capture('list-item')
    await input.press('Enter')
    const drawer = page.getByRole('dialog', { name: 'Edit speaker', exact: true })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('textbox', { name: /^Name/ })).toHaveValue('Avery Brooks (sample)')
    await capture('item-drawer')
    await drawer.getByRole('textbox', { name: /^Name/ }).fill('Unsaved name (sample)')
    await page.keyboard.press('Control+k')
    dialog = page.getByRole('dialog', { name: 'Search or jump to', exact: true })
    input = dialog.getByRole('combobox')
    await input.fill(peoriaSearchName)
    await expect(dialog.getByRole('option')).toHaveCount(1)
    await expect(dialog.getByRole('option').getByText(peoriaSearchName, { exact: true })).toBeVisible()
    await input.press('Enter')
    const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(drawer.getByRole('textbox', { name: /^Name/ })).toHaveValue('Unsaved name (sample)')
    await drawer.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.keyboard.press('Control+k')
    input = page.getByRole('dialog', { name: 'Search or jump to', exact: true }).getByRole('combobox')
    await input.fill(peoriaSearchName)
    await expect(dialog.getByRole('option')).toHaveCount(1)
    await expect(dialog.getByRole('option').getByText(peoriaSearchName, { exact: true })).toBeVisible()
    await input.press('ArrowDown')
    await input.press('Enter')
    await expect(canvas(page).locator('h1')).toHaveText('Peoria Chapter')
    await canvas(page).locator('h1').press('Control+k')
    dialog = page.getByRole('dialog', { name: 'Search or jump to', exact: true })
    await expect(dialog).toBeVisible()
    await capture('canvas-search')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+k')
    dialog = page.getByRole('dialog', { name: 'Search or jump to', exact: true })
    await dialog.getByRole('combobox').fill('Long speaker')
    await expect(dialog.getByRole('option').locator('strong')).toHaveText(longName)
    await capture('long-result')
    await page.keyboard.press('Escape')
    await page.context().clearCookies()
    await page.goto('/auth/local-chapter?code=' + token)
    await expect(canvas(page).locator('h1')).toHaveText('Peoria Chapter')
    await page.keyboard.press('Control+k')
    dialog = page.getByRole('dialog', { name: 'Search or jump to', exact: true })
    input = dialog.getByRole('combobox')
    await expect(dialog.getByRole('option').filter({ hasText: 'Peoria Chapter' })).toHaveCount(1)
    await capture('scoped')
    await input.fill('North Texas')
    await expect(dialog.getByRole('status')).toContainText('No matches')
    await expect(dialog.getByRole('option')).toHaveCount(0)
    await capture('no-matches')
    await page.route('**/pages/*', route =>
      route.request().method() === 'POST' ? route.abort('failed') : route.continue(),
    )
    await input.fill('Peoria')
    await expect(dialog.getByRole('alert')).toContainText('Couldn’t load results')
    await capture('error')
    await page.unroute('**/pages/*')
    await dialog.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(dialog.getByRole('option')).toHaveCount(1)
    await input.fill('Avery')
    await expect(dialog.getByRole('status')).toContainText('No matches')
    await input.fill('Settings')
    await expect(dialog.getByRole('status')).toContainText('No matches')
    expect(errors).toEqual([])
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.archive()
    f.client.release()
    await f.pool.end()
  }
})
