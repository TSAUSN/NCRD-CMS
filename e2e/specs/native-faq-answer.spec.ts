import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  compileSection,
  renderPage,
  CSS_POLICY_VERSION,
  SANITIZER_POLICY_VERSION,
  type ManifestSection,
} from '@cms/renderer'
import { SAWSO_THEME } from '@cms/seeds/core-themes'

test('imported FAQ answers visibly open and close in public and editor documents without JavaScript', async ({
  browser,
}, info) => {
  const compiled = compileSection({
    sourceHtml:
      '<details class="faq-item"><summary class="faq-btn">What does registration include?</summary><div class="faq-answer"><p>Confirmed registration details will be posted here.</p></div></details>',
    sourceCss:
      '.faq-item{border:1px solid #ddd}.faq-btn{padding:20px}.faq-answer{display:grid;grid-template-rows:0fr}.faq-answer p{min-height:0;overflow:hidden;opacity:0;padding:0;margin:0}.faq-item.is-open>.faq-answer{grid-template-rows:1fr}.faq-item.is-open>.faq-answer p{opacity:1;padding:20px}',
    slots: [],
    scopeSelector: '.cms-section--native-faq',
  })
  expect(compiled.blocking).toEqual([])
  const section: ManifestSection = {
    def: {
      section_def_id: 'faq',
      version: 1,
      slug: 'native-faq',
      compiled_ast: compiled.ast,
      css: compiled.css,
      slots: [],
      sanitizer_policy_version: SANITIZER_POLICY_VERSION,
      css_policy_version: CSS_POLICY_VERSION,
    },
    instance: { section_def_id: 'faq', section_def_version: 1, values: {}, hidden: false },
  }
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage(),
    folder = resolve('../.r8-progress/owner-faq', info.project.name)
  await mkdir(folder, { recursive: true })
  await page.route('**', route => route.abort())
  try {
    for (const width of [1440, 390])
      for (const preview of [false, true]) {
        await page.setViewportSize({ width, height: 844 })
        await page.setContent(
          renderPage({
            manifest: { page: { id: 'p', version_id: 'v', title: 'FAQ', path: '/' }, meta: {}, sections: [section] },
            shell: {
              site: { id: 's', name: 'FAQ review', slug: 'review' },
              theme: SAWSO_THEME,
              navigation: [],
              canonical_host: null,
              staging_host: null,
            },
            isStaging: true,
            options: { preview },
          }).html,
        )
        const answer = page.getByText('Confirmed registration details will be posted here.', { exact: true }),
          summary = page.locator('summary')
        await expect(answer).not.toBeVisible()
        await summary.click()
        await expect(page.locator('details')).toHaveAttribute('open', '')
        await expect(answer).toBeVisible()
        expect(await answer.evaluate(n => getComputedStyle(n).opacity)).toBe('1')
        expect((await answer.boundingBox())!.height).toBeGreaterThan(40)
        await page.screenshot({ path: resolve(folder, (preview ? 'editor' : 'public') + '-open-' + width + '.png') })
        await summary.press('Enter')
        await expect(page.locator('details')).not.toHaveAttribute('open', '')
        await expect(answer).not.toBeVisible()
      }
  } finally {
    await context.close()
  }
})
