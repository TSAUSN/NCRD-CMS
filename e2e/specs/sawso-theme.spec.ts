import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { SAWSO_THEME } from '@cms/seeds/core-themes'
import { compileSection, sectionScopeSelector, renderPage, CSS_POLICY_VERSION } from '@cms/renderer'

test('SAWSO national preset renders self-hosted small caps and rounded panels on phones', async ({ browser }) => {
  const compiled = compileSection({
    sourceHtml: '<section><h1>{{heading}}</h1><h2>{{subheading}}</h2></section>',
    sourceCss: 'section{padding:2rem;background:var(--color-surface)}',
    slots: [
      { id: 'heading', kind: 'text', label: 'Heading', constraints: {} },
      { id: 'subheading', kind: 'text', label: 'Subheading', constraints: {} },
    ],
    scopeSelector: sectionScopeSelector('sample-theme')!,
  })
  expect(compiled.problems).toEqual([])
  const html = renderPage({
    manifest: {
      page: { id: 'p1', version_id: 'v1', title: 'Health', path: '/' },
      meta: {},
      sections: [
        {
          def: {
            section_def_id: 'd1',
            version: 1,
            slug: 'sample-theme',
            compiled_ast: compiled.ast,
            css: compiled.css,
            css_policy_version: CSS_POLICY_VERSION,
          },
          instance: {
            section_def_id: 'd1',
            section_def_version: 1,
            values: { heading: 'Health', subheading: 'Community health programs' },
          },
        },
      ],
    },
    shell: {
      site: { id: 's1', name: 'The Salvation Army World Service Office', slug: 'sawso' },
      theme: SAWSO_THEME,
      navigation: [],
      canonical_host: null,
      staging_host: null,
    },
    isStaging: true,
  }).html
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 768 } })
  try {
    const page = await context.newPage()
    await page.goto(`http://demo.staging.localhost:${E2E_PORTS.site}/`)
    await page.setContent(html)
    await expect(page.getByRole('heading', { name: 'Health', exact: true })).toBeVisible()
    expect(await page.locator('h2').evaluate(el => getComputedStyle(el).fontVariant)).toBe('small-caps')
    expect(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(217, 217, 217)')
    expect(await page.locator('h2').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Source Serif 4')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const folder = resolve('../.r8-progress/sawso/preset')
    await mkdir(folder, { recursive: true })
    await page.screenshot({ path: resolve(folder, 'public-390.png'), fullPage: true })
  } finally {
    await context.close()
  }
})
