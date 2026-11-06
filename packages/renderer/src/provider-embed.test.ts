import { describe, expect, it } from 'vitest'
import { HNI_TABLEAU_EMBEDS, StructuredDocument } from '@cms/schema'
import {
  renderProviderEmbed,
  tableauEmbedUrl,
  PROVIDER_EMBED_RUNTIME,
  PROVIDER_FRAME_CSS,
  providerEmbedScriptHash,
} from './provider-embed.ts'
import { renderPage } from './render.ts'
import { compileSection } from './compile.ts'
import { createHash } from 'node:crypto'
import { renderStructuredBody } from './structured.ts'

describe('closed Tableau provider component', () => {
  it('constructs only the two approved source URLs and refuses arbitrary provider settings', () => {
    for (const node of Object.values(HNI_TABLEAU_EMBEDS))
      expect(tableauEmbedUrl(node)).toContain(`https://public.tableau.com/views/HNIDisplay2_0_756/${node.view}?`)
    for (const bad of [
      { ...HNI_TABLEAU_EMBEDS.map, view: '../evil' },
      { ...HNI_TABLEAU_EMBEDS.map, workbook: 'AnotherWorkbook' },
      { ...HNI_TABLEAU_EMBEDS.map, src: 'https://evil.test' },
      { ...HNI_TABLEAU_EMBEDS.map, provider: null },
    ]) {
      expect(tableauEmbedUrl(bad)).toBeNull()
      expect(renderProviderEmbed(bad)).toBeNull()
    }
  })
  it('requires visitor navigation before the iframe contacts the provider, keeping public output script-free', () => {
    const html = renderProviderEmbed(HNI_TABLEAU_EMBEDS.map)!
    expect(html).toContain('srcdoc=')
    expect(html).not.toMatch(/<iframe[^>]*\ssrc=/)
    expect(html).toContain('Load interactive chart')
    expect(html).toContain('IP address')
    expect(html).toContain('allowfullscreen')
    expect(html).toContain('Open larger on Tableau')
    expect(html).not.toContain('allow-top-navigation')
    expect(html).not.toMatch(/<script|onload=|onclick=/)
  })
  it('keeps editor/review placeholders inert and never takes chart configuration from editor values', () => {
    const doc = { schemaVersion: 3, fields: [], nodes: [HNI_TABLEAU_EMBEDS.timeline] }
    expect(StructuredDocument.safeParse(doc).success).toBe(true)
    const def = { definition_kind: 'structured', structured_schema_version: 3, structured_doc: doc }
    for (const options of [{ preview: true }, { providerEmbeds: false }]) {
      const html = renderStructuredBody(def, { src: 'https://evil.test', view: 'evil' }, options)!
      expect(html).toContain('Interactive Tableau chart')
      expect(html).not.toContain('<iframe')
      expect(html).not.toContain('evil.test')
    }
  })
  it('adds only the fixed hash-authorized handler to a public chart page and none to read-only evidence', () => {
    const doc = { schemaVersion: 3, fields: [], nodes: [HNI_TABLEAU_EMBEDS.map] }
    const input = {
      manifest: {
        page: { id: 'page', version_id: 'v1', title: 'Charts', path: '/' },
        meta: {},
        sections: [
          {
            instance: { section_def_id: 'def', section_def_version: 1, values: {} },
            def: {
              section_def_id: 'def',
              version: 1,
              slug: 'chart',
              definition_kind: 'structured',
              structured_schema_version: 3,
              structured_doc: doc,
              compiled_ast: compileSection({ sourceHtml: '', slots: [] }).ast,
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
    }
    const html = renderPage(input).html
    expect(html).toContain(`<script>${PROVIDER_EMBED_RUNTIME}</script>`)
    expect(providerEmbedScriptHash()).toBe(
      'sha256-' + createHash('sha256').update(PROVIDER_EMBED_RUNTIME).digest('base64'),
    )
    const evidence = renderPage({ ...input, options: { providerEmbeds: false } }).html
    expect(evidence).not.toContain('<script>')
    expect(evidence).not.toContain('<iframe')
  })
  it('sizes the frame from the page shell with no specificity, so the source section frame rule decides', () => {
    const html = renderProviderEmbed(HNI_TABLEAU_EMBEDS.timeline)!
    expect(html).not.toMatch(/<iframe[^>]*\sstyle=/)
    expect(PROVIDER_FRAME_CSS.startsWith(':where(.cms-provider-embed iframe){')).toBe(true)
    expect(PROVIDER_FRAME_CSS).toContain('height:clamp(440px,80vh,900px)')
    const doc = {
      schemaVersion: 3,
      fields: [],
      nodes: [
        {
          type: 'element',
          tag: 'div',
          attributes: { class: 'tableau-wrapper' },
          children: [HNI_TABLEAU_EMBEDS.timeline],
        },
      ],
    }
    const page = renderPage({
      manifest: {
        page: { id: 'page', version_id: 'v1', title: 'Charts', path: '/' },
        meta: {},
        sections: [
          {
            instance: { section_def_id: 'def', section_def_version: 1, values: {} },
            def: {
              section_def_id: 'def',
              version: 1,
              slug: 'chart',
              definition_kind: 'structured',
              structured_schema_version: 3,
              structured_doc: doc,
              compiled_ast: compileSection({ sourceHtml: '', slots: [] }).ast,
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
    } as Parameters<typeof renderPage>[0]).html
    // The default comes before any section stylesheet in the one page style element.
    expect(page.indexOf(PROVIDER_FRAME_CSS)).toBeGreaterThan(-1)
    expect(page).toMatch(/<iframe title="HNI Interactive Timeline[^>]*loading="lazy"><\/iframe>/)
  })
  it('escapes a stored title at both iframe attribute and srcdoc markup boundaries', () => {
    const html = renderProviderEmbed({ ...HNI_TABLEAU_EMBEDS.map, title: '\"><img src=x onerror=alert(1)>' })!
    expect(html).not.toContain('<img')
    expect(html).not.toContain('title=""><')
    expect(html).toContain('&amp;lt;img')
  })
})
