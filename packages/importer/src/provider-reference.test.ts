import { describe, expect, it } from 'vitest'
import { HNI_TABLEAU_EMBEDS } from '@cms/schema'
import { renderStructuredBody, tableauEmbedUrl } from '@cms/renderer'
import { providerReference } from './provider-reference.ts'

const source = `<section id="timeline" class="source-panel"><h2 data-block-id="chart-title" style="font-weight:700">Saved timeline title</h2><p>Saved explanation &amp; context.</p><div class="tableau-wrapper"><button type="button" class="viz-fullscreen-btn">Fullscreen</button><iframe title="Original HNI timeline" src="${tableauEmbedUrl(HNI_TABLEAU_EMBEDS.timeline)}"></iframe></div><aside><p>Food, housing and clothing.</p><a class="methodology" href="/methodology.html">How it's measured<svg aria-hidden="true"><path d="M0 0"></path></svg></a></aside></section>`
describe('source-owned Tableau reference mapping', () => {
  it('keeps one section identity, hierarchy, saved prose and link while replacing only the provider controls', () => {
    const result = providerReference({
      slug: 'source-timeline',
      html: source,
      css: '.source-panel{padding:2rem}.methodology{color:#123456}',
    })!
    expect(result).not.toBeNull()
    expect(result.status).not.toBe('refused')
    expect(result.slug).toBe('source-timeline')
    expect(result.providerViews).toEqual(['Top10States'])
    expect(result.structuredDoc.fields.length).toBe(4)
    const rendered = renderStructuredBody(
      { definition_kind: 'structured', structured_doc: result.structuredDoc, structured_schema_version: 3 },
      result.values,
    )!
    expect(rendered).toContain('<section id="timeline" class="source-panel">')
    expect(rendered).toContain('Saved timeline title')
    expect(rendered).toContain('Saved explanation &amp; context.')
    expect(rendered).toContain('href="/methodology.html"')
    expect(rendered).toContain('Food, housing and clothing.')
    expect(rendered).toContain('srcdoc=')
    expect(rendered).not.toContain('viz-fullscreen-btn')
    expect(result.sourceCss).toContain('font-weight:700')
    expect(result.issues).toContain('provider-consent-panel-and-responsive-frame-layout-review')
  })
  it('falls back instead of integrating an unapproved or altered source iframe', () => {
    expect(providerReference({ slug: 'ref', html: source.replace('Top10States?', 'OtherView?'), css: '' })).toBeNull()
    expect(
      providerReference({
        slug: 'ref',
        html: source.replace('<iframe title=', '<iframe srcdoc="bad" title='),
        css: '',
      }),
    ).toBeNull()
    expect(providerReference({ slug: 'ref', html: '<section><p>No provider here</p></section>', css: '' })).toBeNull()
  })
})
