import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'
import { rawRequest } from '../http.ts'
async function publish(page: Page) {
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Publish selected (1)', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
}
test('Search & sharing keeps tags private until review, rejects scripts, provides an authenticated published-only sitemap and preserves staging noindex', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/search-sharing/' + info.project.name),
    other = await browser.newContext()
  try {
    await mkdir(folder, { recursive: true })
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    await c.query('SELECT app.create_page($1,$2,$3)', [f.site, 'private-sitemap-page', '[Private page]'])
    await c.query('COMMIT')
    const base = '/sites/' + f.site + '/settings/search',
      tags = page.getByLabel('Site verification tags', { exact: true }),
      hints = page.getByLabel('Hints for search engines (optional)', { exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      before = (await rawRequest({ host: f.host, path: '/' })).body,
      capture = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 950 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
        }
      }
    await signIn(page, 'root@example.test')
    await page.goto(base)
    await expect(page.getByRole('heading', { name: 'Search & sharing', exact: true })).toBeVisible()
    await capture('search-empty')
    await tags.fill('<script src="https://example.test/script.js"></script>')
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
    await page.getByRole('link', { name: 'Social accounts', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Use a quoted verification tag')
    await capture('unsupported-tag-kept')
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL('/sites/' + f.site + '/settings/social')
    await page.goto(base)
    await expect(tags).toHaveValue('')
    await tags.fill(
      '<meta name="google-site-verification" content="local-token"> <meta content="bing-token" name="msvalidate.01">',
    )
    await hints.fill('help & "neighbors"')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Site settings draft saved' })).toBeVisible()
    expect((await rawRequest({ host: f.host, path: '/' })).body).toBe(before)
    await capture('search-saved-private')
    const version = (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!
        .published_version_id,
      preview = await page.request.get('/preview/' + version + '?visit=1&site=draft')
    expect(await preview.text()).toContain('<meta name="google-site-verification" content="local-token">')
    await publish(page)
    const published = (await rawRequest({ host: f.host, path: '/' })).body
    expect(published).toContain('<meta name="google-site-verification" content="local-token">')
    expect(published).toContain('<meta name="msvalidate.01" content="bing-token">')
    expect(published).toContain('<meta name="keywords" content="help &amp; &quot;neighbors&quot;">')
    expect(published).toContain('<meta name="robots" content="noindex,nofollow">')
    expect(published.match(/<link rel="canonical"[^>]+>/)?.[0]).toBe(before.match(/<link rel="canonical"[^>]+>/)?.[0])
    expect(published.match(/<meta name="description"[^>]+>/)?.[0]).toBe(
      before.match(/<meta name="description"[^>]+>/)?.[0],
    )
    await page.goto(base)
    const href = await page.getByRole('link', { name: 'View sitemap', exact: true }).getAttribute('href')
    expect(href).toBe('/sites/' + f.site + '/settings/sitemap')
    const sitemap = await page.request.get(href!)
    expect(sitemap.status()).toBe(200)
    expect(sitemap.headers()['cache-control']).toBe('no-store, private')
    expect(sitemap.headers()['x-robots-tag']).toBe('noindex, nofollow')
    const xml = await sitemap.text()
    expect(xml).toContain('<loc>http://' + f.host + `:${E2E_PORTS.site}/</loc>`)
    expect(xml).toContain('/visit</loc>')
    expect(xml).not.toContain('private-sitemap-page')
    const publicMap = await rawRequest({ host: f.host, path: '/sitemap.xml' })
    expect(publicMap.status).toBe(404)
    expect(publicMap.headers['cache-control']).toBe('no-store')
    const editor = await other.newPage()
    await signIn(editor, 'editor@example.test')
    expect((await editor.request.get(base)).status()).toBe(404)
    expect((await editor.request.get(href!)).status()).toBe(404)
    await tags.clear()
    await hints.clear()
    await publish(page)
    expect((await rawRequest({ host: f.host, path: '/' })).body).toBe(before)
    await page.goto(base)
    const row = (
      await c.query(
        'SELECT h.revision,v.settings FROM site_settings h JOIN site_setting_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
        [f.site],
      )
    ).rows[0]!
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    await c.query('SELECT app.save_site_settings_draft($1,$2,$3)', [
      f.site,
      row.revision,
      JSON.stringify({ ...row.settings, search: { verification: [], hints: '[Concurrent hints]' } }),
    ])
    await c.query('COMMIT')
    await hints.fill('[My kept hints]')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Site settings changed' })).toBeVisible()
    await expect(hints).toHaveValue('[My kept hints]')
    await capture('search-conflict-keeps-fields')
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await other.close()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
