import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn, canvas } from '../helpers.ts'
import { scriptlessPreviewHtml, SCRIPTLESS_PREVIEW_SANDBOX } from '../../../apps/admin/src/lib/scriptless-preview.ts'

test('private editing and scriptless previews permit only the approved font resources while keeping the host gate', async ({
  page,
  browser,
}) => {
  const f = await sawsoFixture(true),
    folder = resolve('../.r8-progress/round3/preview-fonts', browser.browserType().name()),
    violations: string[] = []
  await mkdir(folder, { recursive: true })
  try {
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const theme = (
      await f.client.query(
        'SELECT t.revision,v.tokens FROM themes t JOIN theme_versions v ON v.id=t.draft_version_id WHERE t.site_id=$1',
        [f.siteId],
      )
    ).rows[0]!
    const tokens = {
      ...theme.tokens,
      fonts: {
        ...theme.tokens.fonts,
        heading: "'trajan-pro-3', 'Source Serif 4', Georgia, serif",
        body: "'proxima-nova', 'Open Sans', Arial, sans-serif",
        adobeKit: { id: 'euh2hvn', enabled: true, domains: [f.hostname] },
      },
    }
    await f.client.query('SELECT app.save_theme_draft($1,$2,$3)', [f.siteId, theme.revision, JSON.stringify(tokens)])
    await f.client.query('COMMIT')
    const home = (
      await f.pool.query("SELECT id,draft_version_id FROM pages WHERE site_id=$1 AND slug='' AND archived_at IS NULL", [
        f.siteId,
      ])
    ).rows[0]!
    page.on('console', message => {
      if (/Content Security Policy|Refused to/.test(message.text()) && /typekit/.test(message.text()))
        violations.push(message.text())
    })
    await signIn(page, 'root@example.test')
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/preview/' + home.draft_version_id)
    await page.goto('/pages/' + home.id + '?site=draft')
    await expect(canvas(page).locator('link[data-cms-adobe-kit]')).toHaveCount(1)
    const policy = (await response).headers()['content-security-policy']!
    expect(policy).toContain("style-src 'unsafe-inline' https://use.typekit.net https://p.typekit.net")
    expect(policy).toContain("font-src 'self' https://use.typekit.net")
    expect(policy).not.toContain('script-src https:')
    await expect
      .poll(
        () =>
          canvas(page)
            .locator('body')
            .evaluate(() => Array.from(document.fonts).some(face => face.family.includes('trajan-pro-3'))),
        { timeout: 15000 },
      )
      .toBe(true)
    const editable = await canvas(page)
      .locator('body')
      .evaluate(async () => {
        await document.fonts.ready
        try {
          return (await document.fonts.load('16px "trajan-pro-3"')).length > 0
        } catch {
          return false
        }
      })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'editor-' + width + '.png'), fullPage: true })
    }
    const preview = await page.request.post('/api/sites/' + f.siteId + '/design/preview', {
      data: { versionId: home.draft_version_id, tokens },
    })
    expect(preview.status()).toBe(200)
    expect(preview.headers()['content-security-policy']).toContain("script-src 'none'")
    const html = scriptlessPreviewHtml(await preview.text(), new URL(page.url()).origin)
    await page.evaluate(
      ({ html, sandbox }) => {
        const frame = document.createElement('iframe')
        frame.title = 'Font policy specimen'
        frame.setAttribute('sandbox', sandbox)
        frame.srcdoc = html
        document.body.append(frame)
      },
      { html, sandbox: SCRIPTLESS_PREVIEW_SANDBOX },
    )
    const frame = page.frameLocator('iframe[title="Font policy specimen"]')
    await expect(frame.locator('link[data-cms-adobe-kit]')).toHaveCount(1)
    const scriptless = await frame.locator('body').evaluate(async () => {
      await document.fonts.ready
      try {
        return (await document.fonts.load('16px "trajan-pro-3"')).length > 0
      } catch {
        return false
      }
    })
    const blocked = await page.request.post('/api/sites/' + f.siteId + '/design/preview', {
      data: {
        versionId: home.draft_version_id,
        tokens: {
          ...tokens,
          fonts: { ...tokens.fonts, adobeKit: { ...tokens.fonts.adobeKit, domains: ['unlisted.localhost'] } },
        },
      },
    })
    expect(blocked.status()).toBe(200)
    expect(await blocked.text()).not.toContain('data-cms-adobe-kit')
    expect(violations).toEqual([])
    await writeFile(
      resolve(folder, 'font-loading.json'),
      JSON.stringify(
        {
          editable,
          scriptless,
          actualBrowserAddress: new URL(page.url()).hostname,
          siteAllowedAddress: f.hostname,
          violations,
          needsOwner:
            editable && scriptless
              ? []
              : ['Adobe kit address entitlement or network availability: ' + new URL(page.url()).hostname],
        },
        null,
        2,
      ),
    )
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
