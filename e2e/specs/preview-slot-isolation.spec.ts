import { expect, test } from '@playwright/test'
import { STRUCTURED_SCHEMA_VERSION } from '@cms/schema'
import {
  CSS_POLICY_VERSION,
  SANITIZER_POLICY_VERSION,
  compileSection,
  compileStructuredSection,
  renderPage,
  type ManifestSection,
} from '@cms/renderer'

// Reviewed Echelon hero rules: only the authored subtitle span should receive
// this gradient and block sizing. A preview-generated span used to catch the
// main title as well, changing its color and line breaks on desktop and phone.
const css = `.hero h1{max-width:9ch;font-family:Georgia,serif;letter-spacing:0;color:rgb(0,40,86);margin:0;font-size:clamp(2.5rem,6vw,5.6rem);font-weight:400;line-height:.95}
.hero h1 span{background:linear-gradient(118deg,#dd5251,#e47842,#f6ca4f);-webkit-text-fill-color:transparent;color:transparent;-webkit-background-clip:text;background-clip:text;width:max-content;margin-top:-.12em;padding-top:.18em;line-height:1;display:block}
@media(max-width:767px){.hero h1 span{max-width:100%;overflow-wrap:anywhere}}`
const fields = [
  { id: 'title', label: 'Title', kind: 'text' as const, constraints: {} },
  { id: 'subtitle', label: 'Subtitle', kind: 'text' as const, constraints: {} },
]
const values = { title: 'Echelon Symposium', subtitle: 'Event details coming soon' }

function renderedDocument(kind: 'legacy' | 'structured', preview: boolean, sourceHtml?: string) {
  const slug = `slot-isolation-${kind}`
  const structured = {
    schemaVersion: STRUCTURED_SCHEMA_VERSION,
    fields: fields.map(f => ({ name: f.id, label: f.label, type: f.kind })),
    nodes: [
      {
        type: 'element' as const,
        tag: 'section' as const,
        attributes: { class: 'hero' },
        children: [
          {
            type: 'element' as const,
            tag: 'h1' as const,
            children: [
              { type: 'text' as const, field: 'title' },
              {
                type: 'element' as const,
                tag: 'span' as const,
                children: [{ type: 'text' as const, field: 'subtitle' }],
              },
            ],
          },
        ],
      },
    ],
  }
  const compiled =
    kind === 'legacy'
      ? compileSection({
          sourceHtml: sourceHtml ?? '<section class="hero"><h1>{{title}}<span>{{subtitle}}</span></h1></section>',
          sourceCss: css,
          slots: fields,
          scopeSelector: `.cms-section--${slug}`,
        })
      : compileStructuredSection({ slug, document: structured, sourceCss: css })
  if (compiled.blocking.length) throw new Error(compiled.blocking.join('; '))
  const section = {
    instance: { values, hidden: false, hidden_at: [] },
    def: {
      slug,
      section_def_id: slug,
      version: 1,
      definition_kind: kind,
      compiled_ast: 'ast' in compiled ? compiled.ast : { nodes: [], policyVersion: 4, cssPolicyVersion: 1 },
      css: compiled.css,
      slots: fields,
      css_policy_version: CSS_POLICY_VERSION,
      sanitizer_policy_version: SANITIZER_POLICY_VERSION,
      ...(kind === 'structured'
        ? { structured_doc: structured, structured_schema_version: STRUCTURED_SCHEMA_VERSION }
        : {}),
    },
  } as unknown as ManifestSection
  return renderPage({
    manifest: {
      page: { id: 'page', version_id: 'version', title: 'Slot isolation', path: '/' },
      meta: {},
      sections: [section],
    },
    shell: {
      site: { id: 'site', name: 'Site', slug: 'site' },
      theme: {},
      navigation: [],
      canonical_host: null,
      staging_host: null,
    },
    isStaging: false,
    options: { preview },
  }).html
}

for (const kind of ['legacy', 'structured'] as const) {
  for (const width of [390, 1280])
    test(`${kind} editable title retains source color and wrapping at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      const measure = async (preview: boolean) => {
        await page.setContent(renderedDocument(kind, preview))
        return page.locator('.hero h1').evaluate(h1 => {
          const text = h1.firstChild!
          const range = document.createRange()
          range.selectNodeContents(text)
          const style = getComputedStyle(text instanceof Element ? text : h1)
          const rect = h1.getBoundingClientRect()
          return {
            color: style.color,
            fill: style.webkitTextFillColor,
            width: rect.width,
            height: rect.height,
            lines: Array.from(range.getClientRects()).map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
            authoredSpans: h1.querySelectorAll('span').length,
          }
        })
      }
      const publicLayout = await measure(false)
      const previewLayout = await measure(true)
      expect(publicLayout.color).toBe('rgb(0, 40, 86)')
      expect(publicLayout.lines.length).toBeGreaterThan(1)
      expect(previewLayout).toEqual(publicLayout)
      const html = renderedDocument(kind, true).replaceAll('&', '&amp;').replaceAll('\"', '&quot;')
      await page.route('http://preview.fixture.test/', route =>
        route.fulfill({
          contentType: 'text/html',
          body: `<iframe title="Canvas" style="width:100%;height:850px" srcdoc="${html}"></iframe>`,
        }),
      )
      await page.goto('http://preview.fixture.test/')
      const title = page.frameLocator('iframe').locator('[data-cms-slot="title"]')
      await title.dblclick()
      await expect(title).toHaveAttribute('contenteditable', 'plaintext-only')
      await title.fill('Edited title')
      await expect(title).toHaveText('Edited title')
    })
}

test('legacy table-cell and option text retain browser parsing and content', async ({ page }) => {
  const source =
    '<table><tbody><tr><td>{{title}}</td></tr></tbody></table><select><option>{{subtitle}}</option></select>'
  for (const preview of [false, true]) {
    await page.setContent(renderedDocument('legacy', preview, source))
    await expect(page.locator('table tbody tr td')).toHaveText(values.title)
    await expect(page.locator('select option')).toHaveText(values.subtitle)
    await expect(page.locator('table')).toHaveCount(1)
    await expect(page.locator('select option')).toHaveCount(1)
  }
})
