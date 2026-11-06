import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseSiteArchive } from '@cms/schema'
import { signIn } from './helpers.ts'

test('archive leave recovery creates no site, keeps bytes privately and restores no layout approval', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const pool = new Pool({
      connectionString: `postgres://cms:cms@127.0.0.1:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
    }),
    c = await pool.connect(),
    folder = resolve('../.r8-progress/round3/archive-import-leave/' + info.project.name),
    created: string[] = []
  let sourceId = ''
  try {
    await mkdir(folder, { recursive: true })
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      suffix = randomUUID().slice(0, 8)
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const theme = (
      await c.query(
        "SELECT v.tokens FROM themes t JOIN sites s ON s.id=t.site_id JOIN theme_versions v ON v.id=t.published_version_id WHERE s.slug='demo'",
      )
    ).rows[0]!.tokens
    sourceId = (
      await c.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        'archive-source-' + suffix,
        '[Local archive source]',
        'resource',
        'archive-source-' + suffix + '.staging.localhost',
        JSON.stringify(theme),
        '[]',
      ])
    ).rows[0]!.id
    const sourcePage = (await c.query('SELECT app.create_page($1,$2,$3) AS id', [sourceId, '', '[Local archive page]']))
      .rows[0]!.id
    await c.query('SELECT app.save_page_draft($1,0,$2,$3)', [sourcePage, '[]', '{}'])
    await c.query('COMMIT')
    await signIn(page, 'root@example.test')
    const exported = await page.request.get('/api/sites/' + sourceId + '/export')
    expect(exported.status()).toBe(200)
    const archive = await exported.json(),
      fileVersion = randomUUID()
    archive.content.site_files = []
    archive.content.site_file_versions = [
      {
        id: fileVersion,
        version: 1,
        reviewed_at: new Date().toISOString(),
        bundle: {
          version: 1,
          files: [],
          scripts: [],
          styles: [],
          original: {
            version: 1,
            definitions: [],
            pages: [{ pageId: sourcePage, html: {}, body: {}, header: true, footer: true }],
          },
        },
      },
    ]
    archive.content.site_file_heads = [{ revision: 1, draft_version_id: fileVersion, published_version_id: null }]
    parseSiteArchive(archive)
    const bytes = Buffer.from(JSON.stringify(archive)),
      inputFile = { name: 'local-archive.json', mimeType: 'application/json', buffer: bytes },
      allSites = async () => (await pool.query('SELECT * FROM sites ORDER BY id')).rows,
      before = await allSites(),
      heads = (
        await pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          sourceId,
        ])
      ).rows,
      address = '/sites/import',
      slug = 'recovered-import-' + suffix
    const shot = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 950 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    }
    await page.goto(address)
    const input = page.getByLabel('Content archive (.json, up to 64 MB)', { exact: true }),
      name = page.getByLabel('New site name', { exact: true }),
      short = page.getByLabel('New short address', { exact: true }),
      ack = page.getByRole('checkbox', { name: 'I reviewed the original page layouts.', exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      sites = () =>
        page
          .getByRole('complementary', { name: 'CMS navigation', exact: true })
          .getByRole('link', { name: 'All sites', exact: true })
          .click(),
      load = async () => {
        await expect(input).toBeEnabled()
        await input.setInputFiles(inputFile)
        await expect(name).toBeVisible()
      }
    await expect(input).toBeEnabled()
    await sites()
    await expect(leave).toHaveCount(0)
    await expect(page).toHaveURL(/\/sites$/)
    await page.goto(address)
    await load()
    await name.fill('[Discarded import setup]')
    await shot('edited')
    await sites()
    await expect(leave).toContainText('Import setup and archive')
    await shot('leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('[Discarded import setup]')
    await sites()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).not.toHaveURL(/\/sites\/import/)
    expect(await allSites()).toEqual(before)
    await page.goto(address)
    await load()
    await name.fill('[Recovered import setup]')
    await short.fill(slug)
    await ack.check()
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put
      ;(window as any).originalPut = original
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
        const request = original.apply(this, args)
        if (this.name === 'setups') request.addEventListener('success', () => this.transaction.abort())
        return request
      }
    })
    await sites()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('could not save')
    await shot('storage-error')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('[Recovered import setup]')
    await page.evaluate(() => {
      IDBObjectStore.prototype.put = (window as any).originalPut
    })
    await sites()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).not.toHaveURL(/\/sites\/import/)
    expect(await allSites()).toEqual(before)
    await page.goto(address)
    await expect(name).toHaveValue('[Recovered import setup]')
    await expect(short).toHaveValue(slug)
    await expect(ack).not.toBeChecked()
    await expect(page.getByText('Loaded archive: local-archive.json', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create private draft copy', exact: true })).toBeDisabled()
    await shot('restored')
    await ack.scrollIntoViewIfNeeded()
    await shot('restored-review')
    const isolated = await browser.newContext({ baseURL: new URL(page.url()).origin })
    try {
      const view = await isolated.newPage()
      await signIn(view, 'root@example.test')
      await view.goto(address)
      await expect(view.getByLabel(/Content archive/)).toBeEnabled()
      await expect(view.getByRole('heading', { name: 'Review this import', exact: true })).toHaveCount(0)
    } finally {
      await isolated.close()
    }
    await ack.check()
    await short.fill('Invalid address!')
    await page.getByRole('button', { name: 'Create private draft copy', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('lowercase words')
    await expect(short).toHaveValue('Invalid address!')
    await expect(page.getByRole('main').getByRole('alert')).toBeInViewport()
    await shot('invalid')
    await short.fill(slug)
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.delete
      ;(window as any).originalDelete = original
      IDBObjectStore.prototype.delete = function (key) {
        if (this.name === 'setups') throw new DOMException('Synthetic unavailable storage', 'QuotaExceededError')
        return original.call(this, key)
      }
    })
    await page.getByRole('button', { name: 'Clear saved import setup', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not be cleared')
    await expect(name).toHaveValue('[Recovered import setup]')
    await expect(page.getByRole('main').getByRole('alert')).toBeInViewport()
    await shot('clear-error')
    await page.evaluate(() => {
      IDBObjectStore.prototype.delete = (window as any).originalDelete
    })
    await page.getByRole('button', { name: 'Clear saved import setup', exact: true }).click()
    await expect(name).toHaveCount(0)
    await sites()
    await expect(leave).toHaveCount(0)
    expect(await allSites()).toEqual(before)
    await page.goto(address)
    await load()
    await name.fill('[Recovered import setup]')
    await short.fill(slug)
    await ack.check()
    let release!: () => void
    const waiting = new Promise<void>(resolve => {
        release = resolve
      }),
      requests: string[] = []
    await page.route('**/api/sites/import', async route => {
      requests.push(route.request().postDataJSON().requestId)
      if (requests.length === 1) {
        await waiting
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Import could not be confirmed. Retry with the same file and destination.' }),
        })
      } else await route.continue()
    })
    await page.getByRole('button', { name: 'Create private draft copy', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Importing content…', exact: true })).toBeDisabled()
    await expect(name).toBeDisabled()
    await shot('pending')
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('wait')
      await dialog.accept()
    })
    await sites()
    await expect(page).toHaveURL(/\/sites\/import/)
    release()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('could not be confirmed')
    await expect(name).toHaveValue('[Recovered import setup]')
    await expect(page.getByRole('main').getByRole('alert')).toBeInViewport()
    await shot('command-error')
    expect(await allSites()).toEqual(before)
    await sites()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).not.toHaveURL(/\/sites\/import/)
    await page.goto(address)
    await expect(name).toHaveValue('[Recovered import setup]')
    await expect(ack).not.toBeChecked()
    await ack.check()
    await page.getByRole('button', { name: 'Create private draft copy', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Your site content was imported as private drafts.')
    expect(requests).toHaveLength(2)
    expect(requests[1]).toBe(requests[0])
    const copy = (await page.getByRole('link', { name: 'Open imported site', exact: true }).getAttribute('href'))!
      .split('/')
      .at(-1)!
    created.push(copy)
    expect((await allSites()).filter(site => !before.some(old => old.id === site.id))).toHaveLength(1)
    expect(
      (await pool.query('SELECT published_version_id FROM pages WHERE site_id=$1', [copy])).rows.every(
        row => row.published_version_id === null,
      ),
    ).toBe(true)
    expect(
      (
        await pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          sourceId,
        ])
      ).rows,
    ).toEqual(heads)
    await page.goto(address)
    await expect(input).toBeEnabled()
    await expect(name).toHaveCount(0)
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    for (const site of [sourceId, ...created].filter(Boolean))
      await pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [site])
    c.release()
    await pool.end()
  }
})
