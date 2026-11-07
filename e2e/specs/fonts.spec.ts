import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { compileSection, renderPage, CSS_POLICY_VERSION, type SiteShell } from '@cms/renderer'
import { publicSecurityHeaders } from '../../apps/site/src/lib/public-security.ts'
test('approved Adobe fonts are host-gated with working stand-ins and narrow CSP at public widths', async ({
  browser,
}) => {
  const heading = "'trajan-pro-3', 'Source Serif 4', Georgia, serif",
    body = "'proxima-nova', 'Open Sans', Arial, sans-serif",
    host = 'sawso-fonts.staging.localhost'
  const compiled = compileSection({
    sourceHtml: '<section><h1>{{heading}}</h1><p>{{intro}}</p></section>',
    sourceCss: '',
    slots: [
      { id: 'heading', kind: 'text', label: 'Heading', constraints: {} },
      { id: 'intro', kind: 'text', label: 'Introduction', constraints: {} },
    ],
  })
  const theme = {
    fonts: { heading, body, adobeKit: { id: 'euh2hvn' as const, enabled: true, domains: [host] } },
    presentation: {
      kind: 'panels' as const,
      canvas: '#d9d9d9',
      layout: 'national' as const,
      headings: 'small-caps' as const,
    },
  }
  const shell: SiteShell = {
    site: { id: 'site', slug: 'sample', name: '[Site]' },
    theme,
    navigation: [],
    canonical_host: null,
    staging_host: host,
  }
  const manifest = {
    page: { id: 'page', version_id: 'version', title: 'What We Do', path: '/' },
    meta: {},
    sections: [
      {
        instance: {
          section_def_id: 'section',
          section_def_version: 1,
          values: {
            heading: 'What We Do',
            intro: 'The national template keeps each site’s words, photos and heading font separate.',
          },
        },
        def: {
          section_def_id: 'section',
          slug: 'font-specimen',
          version: 1,
          compiled_ast: compiled.ast,
          css: compiled.css,
          css_policy_version: CSS_POLICY_VERSION,
        },
      },
    ],
  }
  const context = await browser.newContext(),
    page = await context.newPage(),
    requests: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (!url.hostname.endsWith('.localhost')) requests.push(url.hostname)
  })
  try {
    await page.route('http://' + host + `:${E2E_PORTS.site}/font-specimen`, route =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html', ...publicSecurityHeaders({ adobeFonts: true }) },
        body: renderPage({ shell, manifest, isStaging: true, options: { servingHost: host } }).html,
      }),
    )
    const folder = resolve('../.r8-progress/round3/fonts', browser.browserType().name())
    await mkdir(folder, { recursive: true })
    await page.goto('http://' + host + `:${E2E_PORTS.site}/font-specimen`)
    await page.evaluate(() => document.fonts.ready)
    const loaded = await page.evaluate(async () => {
      try {
        const result = await Promise.all([
          document.fonts.load('16px "trajan-pro-3"'),
          document.fonts.load('16px "proxima-nova"'),
        ])
        return result.every(faces => faces.length > 0 && faces.every(face => face.status === 'loaded'))
      } catch {
        return false
      }
    })
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByRole('heading', { name: 'What We Do' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, 'public-' + width + '.png'), fullPage: true })
    }
    expect(requests.every(host => ['use.typekit.net', 'p.typekit.net'].includes(host))).toBe(true)
    await writeFile(
      resolve(folder, 'address-check.json'),
      JSON.stringify(
        {
          host,
          fontsLoaded: loaded,
          source: 'Normal browser font loading; no font files vendored',
          needsOwner: loaded ? [] : [host],
        },
        null,
        2,
      ),
    )
    const other = 'unlisted-fonts.staging.localhost',
      before = requests.length
    await page.route('http://' + other + `:${E2E_PORTS.site}/font-specimen`, route =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html', ...publicSecurityHeaders() },
        body: renderPage({ shell, manifest, isStaging: true, options: { servingHost: other } }).html,
      }),
    )
    await page.goto('http://' + other + `:${E2E_PORTS.site}/font-specimen`)
    await expect(page.locator('link[data-cms-adobe-kit]')).toHaveCount(0)
    expect(requests.length).toBe(before)
    await page.screenshot({ path: resolve(folder, 'address-not-allowed-390.png'), fullPage: true })
  } finally {
    await context.close()
  }
})

test('Administrator connects the fixed kit, saves a private font draft and reviews publishing; unavailable addresses keep stand-ins', async ({
  page,
  browser,
}) => {
  const { sawsoFixture } = await import('./fixtures/sawso.ts'),
    { signIn } = await import('./helpers.ts'),
    f = await sawsoFixture(true)
  try {
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const admin = (
      await f.client.query("SELECT app.provision_user('round3-font-admin@example.test','[Site admin]') AS id")
    ).rows[0]!.id
    await f.client.query("SELECT app.set_site_membership($1,$2,'site_admin')", [admin, f.siteId])
    const editor = (await f.client.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    await f.client.query("SELECT app.set_site_membership($1,$2,'editor')", [editor, f.siteId])
    await f.client.query('COMMIT')
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await signIn(page, 'round3-font-admin@example.test')
    await page.goto('/sites/' + f.siteId + '/design/fonts')
    const folder = resolve('../.r8-progress/round3/fonts', browser.browserType().name())
    await mkdir(folder, { recursive: true })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'unconnected-' + width + '.png'), fullPage: true })
    }
    await page.getByLabel('Kit link', { exact: true }).fill('https://example.test/fonts.css')
    await page.getByRole('button', { name: 'Check kit', exact: true }).click()
    await expect(page.locator('#font-kit-error')).toContainText('Use the approved kit link')
    await page.getByLabel('Kit link', { exact: true }).fill('https://use.typekit.net/euh2hvn.css')
    await page.getByRole('button', { name: 'Check kit', exact: true }).click()
    await expect(page.getByRole('note'))
      .toContainText('Kit connected. 4 font families found.', { timeout: 25000 })
      .catch(async error => {
        const frames = []
        for (const frame of page.frames()) {
          try {
            frames.push(
              await frame.evaluate(() => ({
                host: location.hostname,
                query: location.search,
                ready: document.readyState,
                clock: typeof (window as unknown as { __cmsCanvasClock?: unknown }).__cmsCanvasClock,
                kit: !!document.querySelector('link[data-cms-adobe-kit]'),
                fonts: Array.from(document.fonts).map(font => ({ family: font.family, status: font.status })),
                status: document.fonts.status,
              })),
            )
          } catch {}
        }
        await writeFile(resolve(folder, 'font-check-diagnostic.json'), JSON.stringify({ frames, errors }, null, 2))
        throw error
      })
    await expect(page.getByLabel('Headings', { exact: true })).toHaveValue(
      "'trajan-pro-3', 'Source Serif 4', Georgia, serif",
    )
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, 'connected-' + width + '.png'), fullPage: true })
    }
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Design draft saved')
    const saved = (
      await f.pool.query(
        'SELECT h.draft_version_id,h.published_version_id,v.tokens FROM themes h JOIN theme_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
        [f.siteId],
      )
    ).rows[0]!
    expect(saved.draft_version_id).not.toBe(saved.published_version_id)
    expect(saved.tokens.fonts.adobeKit.id).toBe('euh2hvn')
    await page.getByRole('button', { name: 'Publish…', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Review the saved changes')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const blocked = await browser.newContext()
    try {
      await blocked.route('https://use.typekit.net/**', route =>
        route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
      )
      const view = await blocked.newPage()
      await signIn(view, 'root@example.test')
      await view.goto('/sites/' + f.siteId + '/design/fonts')
      await expect(view.getByRole('note')).toContainText('Adobe could not be reached', { timeout: 25000 })
      for (const width of [1440, 1024]) {
        await view.setViewportSize({ width, height: 900 })
        await view.screenshot({ path: resolve(folder, 'unavailable-' + width + '.png'), fullPage: true })
      }
    } finally {
      await blocked.close()
    }
    const restricted = await browser.newContext()
    try {
      const view = await restricted.newPage()
      await signIn(view, 'editor@example.test')
      await view.goto('/sites/' + f.siteId + '/design/fonts')
      await expect(view.getByRole('heading', { name: 'Site look', exact: true })).toHaveCount(0)
    } finally {
      await restricted.close()
    }
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
