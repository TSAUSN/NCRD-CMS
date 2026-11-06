import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { echelonFixture } from './fixtures/echelon.ts'
import { signIn, canvas } from './helpers.ts'
import { rawRequest } from './http.ts'

test('national home, published directory, no-JS search/contact and local brand fonts work on real pages', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000)
  const fixture = await echelonFixture(false, true, true),
    { pool, client, actor, site } = fixture,
    folder = resolve('../.r8-progress/echelon/national')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    const home = fixture.pages.find(row => row.slug === '')!.id
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + site + '/publishing')
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('checkbox', { name: /Publish with sample content/ }).check()
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    const host = fixture.hostname,
      empty = await rawRequest({ host, path: '/chapters' })
    expect(empty.status).toBe(200)
    expect(empty.body).toContain('Chapter pages will appear here when they are published.')
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE cms_authenticated_user')
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const chapter = (
      await client.query(
        "SELECT c.id,c.revision,v.config FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.site_id=$1 AND c.slug='detroit'",
        [site],
      )
    ).rows[0]!
    await client.query('SELECT app.publish_chapter_setup($1,$2)', [chapter.id, chapter.revision])
    await client.query('COMMIT')
    const visitor = await browser.newContext({ javaScriptEnabled: false })
    const view = await visitor.newPage()
    try {
      await mkdir(folder, { recursive: true })
      for (const width of [1440, 1024, 390]) {
        await view.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
        await view.goto('http://' + host + `:${E2E_PORTS.site}/`)
        await expect(view.getByRole('heading', { name: 'Contact Echelon', exact: true })).toBeVisible()
        expect(await view.locator('body').innerText()).not.toContain('Jordan Lee')
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.screenshot({ path: resolve(folder, 'home-' + width + '.png'), fullPage: true })
        await view.getByRole('searchbox').fill('Detroit')
        await view.getByRole('button', { name: 'Search', exact: true }).click()
        await expect(view.getByRole('link', { name: 'Visit their website ↗', exact: true })).toHaveAttribute(
          'href',
          'https://example.test/chapters/detroit',
        )
        await expect(view.getByRole('status')).toContainText('1 chapter found')
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.screenshot({ path: resolve(folder, 'finder-' + width + '.png'), fullPage: true })
      }
      await view.getByRole('searchbox').fill('No matching chapter')
      await view.getByRole('button', { name: 'Search', exact: true }).click()
      await expect(view.getByRole('status')).toContainText('No chapters match your search.')
      await view.screenshot({ path: resolve(folder, 'finder-empty-390.png'), fullPage: true })
      await view.goto('http://' + host + `:${E2E_PORTS.site}/`)
      for (const [label, value] of [
        ['First name', '[Name]'],
        ['Last name', '[Name]'],
        ['Email', 'visitor@example.test'],
        ['Phone', '123'],
        ['Comments', '[Local acceptance message]'],
      ] as const)
        await view.getByRole('textbox', { name: label + ' (required)', exact: true }).fill(value)
      await view.getByRole('button', { name: 'Send message', exact: true }).click()
      await expect(view.getByRole('status')).toContainText('Thank you. Your message has been saved.')
      expect((await pool.query('SELECT message FROM contact_messages WHERE site_id=$1', [site])).rows).toHaveLength(1)
    } finally {
      await visitor.close()
    }
    await page.goto('http://' + host + `:${E2E_PORTS.site}/`)
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.fonts.check('400 16px "Creato Display"'))).toBe(true)
    expect(
      await page.evaluate(() =>
        Array.from(document.fonts).some(font => font.family.includes('Creato Display') && font.status === 'loaded'),
      ),
    ).toBe(true)
    const fontUrls = await page.evaluate(() =>
      Array.from(document.styleSheets)
        .flatMap(sheet =>
          Array.from(sheet.cssRules)
            .filter(rule => rule instanceof CSSFontFaceRule)
            .map(rule => rule.cssText),
        )
        .filter(rule => rule.includes('Creato Display'))
        .map(rule => rule.match(/url\(["']?([^"')]+)/)?.[1]),
    )
    expect(fontUrls).toHaveLength(7)
    for (const path of fontUrls) {
      expect(path).toMatch(/^\/__cms\/fonts\//)
      expect((await rawRequest({ host, path: path! })).status).toBe(200)
    }
    const alien = await rawRequest({ host: 'demo.staging.localhost', path: '/' })
    expect(alien.body).not.toContain('Creato Display')
    await page.goto('/pages/' + home)
    await expect(canvas(page).getByRole('heading', { name: 'Contact Echelon', exact: true })).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await page.screenshot({ path: resolve(folder, 'editor-' + width + '.png'), fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.getByRole('button', { name: 'Phone', exact: true }).click()
    expect(
      await canvas(page)
        .locator('html')
        .evaluate(node => node.scrollWidth <= node.clientWidth),
    ).toBe(true)
    await page.screenshot({ path: resolve(folder, 'editor-phone-1024.png'), fullPage: true })
    expect(errors).toEqual([])
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    if (site) await pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [site])
    client.release()
    await pool.end()
  }
})
