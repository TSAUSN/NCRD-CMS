import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { compileSection } from './compile.ts'
import { FAQ_FILTER_RUNTIME, faqFilterScriptHash, hasFaqFilter } from './faq-filter.ts'
import { renderPage } from './render.ts'

const faq =
  '<section><input type="search" class="faq-search" aria-label="Search" disabled data-cms-faq-filter>' +
  '<details class="faq-item"><summary>Q</summary><p>A</p></details>' +
  '<p class="faq-no-results" hidden data-cms-faq-empty>No match <button type="button" disabled data-cms-faq-clear>clear</button></p></section>'
const page = (options = {}) =>
  renderPage({
    manifest: {
      page: { id: 'page', version_id: 'v1', title: 'FAQ', path: '/' },
      meta: {},
      sections: [
        {
          instance: { section_def_id: 'def', section_def_version: 1, values: {} },
          def: {
            section_def_id: 'def',
            version: 1,
            slug: 'faq',
            compiled_ast: compileSection({ sourceHtml: faq, slots: [] }).ast,
          },
        },
      ],
    },
    shell: {
      site: { id: 'site', name: 'HNI', slug: 'hni' },
      theme: {},
      navigation: [],
      canonical_host: null,
      staging_host: null,
    },
    isStaging: true,
    options,
  } as Parameters<typeof renderPage>[0]).html

describe('governed FAQ filter (D3)', () => {
  it('adds the one fixed filter, under its exact hash, only to a public page with a marked search box', () => {
    const html = page()
    expect(hasFaqFilter(html)).toBe(true)
    expect(html).toContain(`<script>${FAQ_FILTER_RUNTIME}</script>`)
    expect(faqFilterScriptHash()).toBe('sha256-' + createHash('sha256').update(FAQ_FILTER_RUNTIME).digest('base64'))
    // The box is disabled in the markup; only the runtime enables it.
    expect(html).toMatch(/<input[^>]*disabled[^>]*data-cms-faq-filter/)
  })
  it('keeps editor previews and scriptless evidence free of it', () => {
    expect(page({ preview: true })).not.toContain(FAQ_FILTER_RUNTIME)
    expect(page({ providerEmbeds: false })).not.toContain('<script>')
  })
  it('can enhance an isolated visitor or editor with the exact external runtime and no inline filter', () => {
    for (const options of [
      { visitorPreview: true, externalRuntimes: true },
      { preview: true, previewRuntime: false, externalRuntimes: true },
    ]) {
      const html = page(options)
      expect(html).toMatch(/<script src="\/__cms\/runtime\/faq\.[A-Za-z0-9_-]{43}\.js" integrity="sha256-/)
      expect(html).not.toContain(FAQ_FILTER_RUNTIME)
      expect(html).not.toContain('<script>')
    }
  })
  it('reads no authored code: the runtime is constant and names only its markers', () => {
    expect(FAQ_FILTER_RUNTIME).not.toMatch(/eval|Function\(|innerHTML|fetch|location|src=|href/)
    expect(FAQ_FILTER_RUNTIME).toContain('input[data-cms-faq-filter]')
  })
})
