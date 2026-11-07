import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { signIn } from '../helpers.ts'

test('visual section leave keeps or discards fields and saves only through a current preview and note', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const pool = new Pool({
      connectionString: `postgres://cms:cms@127.0.0.1:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
    }),
    folder = resolve('../.r8-progress/round3/section-author-leave/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const site = (await pool.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id,
      address = '/sites/' + site + '/sections/new',
      title = 'Local visual ' + randomUUID().slice(0, 8),
      heads = (await pool.query('SELECT id,draft_version_id,published_version_id FROM pages ORDER BY id')).rows,
      definitions = async () =>
        (await pool.query('SELECT id FROM section_defs WHERE site_id=$1 AND name=$2', [site, title])).rows
    const shot = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    }
    await signIn(page, 'root@example.test')
    await page.goto(address)
    const name = page.getByRole('textbox', { name: 'Section name', exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      pages = () =>
        page
          .getByRole('complementary', { name: 'CMS navigation', exact: true })
          .getByRole('link', { name: 'Pages', exact: true })
          .click()
    await pages()
    await expect(leave).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp('/sites/' + site + '/pages$'))
    await page.goto(address)
    await name.fill(title)
    await shot('visual-edited')
    await pages()
    await expect(leave).toContainText('Visual section')
    await shot('visual-leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue(title)
    await pages()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/sites/' + site + '/pages$'))
    expect(await definitions()).toEqual([])
    await page.goto(address)
    await expect(name).toHaveValue('')
    await name.fill(title)
    await pages()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Check and preview')
    await shot('visual-validation')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await expect(page.getByTitle('Visual section preview', { exact: true })).toBeVisible()
    await pages()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Describe what changed')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await page.locator('#section-change-note').fill('[Local section change note]')
    let release!: () => void
    const waiting = new Promise<void>(resolve => {
        release = resolve
      }),
      pattern = '**/sites/' + site + '/sections/new**'
    await page.route(pattern, async route => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
        await waiting
        await route.fulfill({ status: 503, body: 'Synthetic unavailable' })
      } else await route.continue()
    })
    await pages()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('button', { name: 'Keep editing', exact: true })).toBeDisabled()
    await expect(name).toBeDisabled()
    await shot('visual-pending')
    release()
    await expect(leave.getByRole('alert')).toContainText('could not be completed')
    await shot('visual-error')
    expect(await definitions()).toEqual([])
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue(title)
    await page.unroute(pattern)
    await pages()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/sites/' + site + '/pages$'))
    const rows = await definitions()
    expect(rows).toHaveLength(1)
    expect(
      (await pool.query('SELECT version FROM section_def_versions WHERE section_def_id=$1', [rows[0]!.id])).rows,
    ).toEqual([{ version: 1 }])
    expect((await pool.query('SELECT id,draft_version_id,published_version_id FROM pages ORDER BY id')).rows).toEqual(
      heads,
    )
  } finally {
    await pool.end()
  }
})

test('separate visual and HTML drafts survive a mode switch and both use the ordinary checked save on departure', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const pool = new Pool({
      connectionString: `postgres://cms:cms@127.0.0.1:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
    }),
    folder = resolve('../.r8-progress/round3/section-author-leave/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const site = (await pool.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id,
      address = '/sites/' + site + '/sections/new',
      suffix = randomUUID().slice(0, 8),
      visual = 'Local paired visual ' + suffix,
      html = 'Local paired HTML ' + suffix,
      heads = (await pool.query('SELECT id,draft_version_id,published_version_id FROM pages ORDER BY id')).rows
    const shot = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    }
    await signIn(page, 'root@example.test')
    await page.goto(address)
    await page.getByRole('textbox', { name: 'Section name', exact: true }).fill(visual)
    await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await expect(page.getByTitle('Visual section preview', { exact: true })).toBeVisible()
    await page.locator('#section-change-note').fill('[Paired visual note]')
    await page.getByRole('button', { name: 'HTML template', exact: true }).click()
    const name = page.getByLabel('What is this section called?', { exact: true })
    await name.fill(html)
    await page.getByLabel('HTML', { exact: true }).fill('<section><h2>{{heading}}</h2></section>')
    await shot('html-edited')
    await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Preview again', exact: true })).toBeVisible()
    await page.locator('#source-change-note').fill('[Paired HTML note]')
    await page.getByRole('button', { name: 'Visual builder', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Section name', exact: true })).toHaveValue(visual)
    await page.getByRole('button', { name: 'HTML template', exact: true }).click()
    await expect(name).toHaveValue(html)
    await page
      .getByRole('complementary', { name: 'CMS navigation', exact: true })
      .getByRole('link', { name: 'Pages', exact: true })
      .click()
    const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toContainText('Visual section')
    await expect(leave).toContainText('HTML section')
    await shot('paired-leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue(html)
    await page
      .getByRole('complementary', { name: 'CMS navigation', exact: true })
      .getByRole('link', { name: 'Pages', exact: true })
      .click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/sites/' + site + '/pages$'))
    const rows = (
      await pool.query('SELECT id,name FROM section_defs WHERE site_id=$1 AND name=ANY($2::text[]) ORDER BY name', [
        site,
        [visual, html],
      ])
    ).rows
    expect(rows).toHaveLength(2)
    for (const row of rows)
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM section_def_versions WHERE section_def_id=$1', [row.id]))
          .rows[0]!.count,
      ).toBe(1)
    expect((await pool.query('SELECT id,draft_version_id,published_version_id FROM pages ORDER BY id')).rows).toEqual(
      heads,
    )
  } finally {
    await pool.end()
  }
})

test('Create another starts a clean HTML draft while keeping its chosen category', async ({ page }) => {
  const pool = new Pool({
    connectionString: `postgres://cms:cms@127.0.0.1:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
  })
  try {
    const site = (await pool.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + site + '/sections/new')
    await page.getByRole('button', { name: 'HTML template', exact: true }).click()
    await page
      .getByLabel('What is this section called?', { exact: true })
      .fill('Local next section ' + randomUUID().slice(0, 8))
    await page.getByLabel('Group it under', { exact: true }).fill('Tests')
    await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Preview again', exact: true })).toBeVisible()
    await page.locator('#source-change-note').fill('[Local next-section note]')
    await page.getByRole('button', { name: 'Save this section', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Section saved', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Create another', exact: true }).click()
    await expect(page.getByLabel('What is this section called?', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Group it under', { exact: true })).toHaveValue('Tests')
    await page
      .getByRole('complementary', { name: 'CMS navigation', exact: true })
      .getByRole('link', { name: 'Pages', exact: true })
      .click()
    await expect(page.getByRole('alertdialog', { name: 'Before you leave', exact: true })).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp('/sites/' + site + '/pages$'))
  } finally {
    await pool.end()
  }
})
