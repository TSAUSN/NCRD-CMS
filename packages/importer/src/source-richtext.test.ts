// Real public-source contracts. No V1 markup, content export or credentials are
// copied into this repository. V1_ROOT follows the catalogue's explicit
// absent/incorrect/available routing; these tests never contact its backend.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderSection } from '@cms/renderer'
import { editableReference } from './editable-reference.ts'
import { attribute, parseHtml, type HtmlElement, type HtmlNode } from './html.ts'
import { serializeLegacy } from './legacy-values.ts'
import { decideV1Source, probeV1Root } from './parity.ts'

const source = decideV1Source(process.env.V1_ROOT, probeV1Root)
const withSource = source.kind === 'run' ? describe : describe.skip
const suiteName =
  source.kind === 'run'
    ? 'rich-text mapping against HNI and Echelon public source'
    : `rich-text mapping against HNI and Echelon public source [skipped: ${source.why}]`

if (source.kind === 'fail') {
  it('requires the V1 checkout explicitly named by V1_ROOT', () => {
    throw new Error(source.why)
  })
}

function region(repository: 'tsa-humanneedsindex' | 'tsa-echelonsymposium', page: string, id: string) {
  if (source.kind !== 'run') throw new Error('source-backed tests require an available V1_ROOT')
  const file = path.join(source.v1Root, repository, `${page}.html`)
  const original = readFileSync(file, 'utf8')
  const main = /<main\b[^>]*>([\s\S]*)<\/main\s*>/i.exec(original)
  if (!main) throw new Error(`${repository}/${page} has no main content`)
  const parsed = parseHtml(main[1]!)
  if (!parsed.ok) throw new Error(`${repository}/${page}: ${parsed.refusal}`)
  const find = (nodes: HtmlNode[]): HtmlElement | undefined => {
    for (const node of nodes) {
      if (node.kind === 'text') continue
      if (attribute(node, 'data-block-id') === id) return node
      const match = find(node.children)
      if (match) return match
    }
    return undefined
  }
  const authored = find(parsed.nodes)
  if (!authored) throw new Error(`${repository}/${page} has no region ${id}`)
  const html = serializeLegacy([authored])
  const mapped = editableReference({ slug: 'source-richtext', html, css: '' })
  const render = (values = mapped.values) =>
    renderSection(
      {
        def: { section_def_id: 'source-richtext', version: 1, compiled_ast: mapped.compiled.ast, slots: mapped.slots },
        instance: { section_def_id: 'source-richtext', section_def_version: 1, values },
      },
      0,
    )
      .replace(/^<div[^>]*>/, '')
      .replace(/<\/div>$/, '')
  return { ...mapped, html, authored, render }
}

withSource(suiteName, () => {
  it.each(['overview', 'construction', 'validation', 'final'])(
    'keeps HNI Methodology %s paragraphs together under their original prose styling',
    name => {
      const result = region('tsa-humanneedsindex', 'methodology', `methodology-${name}`)
      expect(result.slots).toHaveLength(1)
      expect(result.slots[0]).toMatchObject({ kind: 'richtext', label: `Methodology ${name}` })
      expect(result.render()).toBe(result.html)
      expect(
        result.render({ [result.slots[0]!.id]: '<p>Updated <strong>methodology</strong>.</p><p>More detail.</p>' }),
      ).toBe(
        `<div class="prose-block" data-block-id="methodology-${name}" data-editable="richtext"><p>Updated <strong>methodology</strong>.</p><p>More detail.</p></div>`,
      )
      expect(result.issues).toEqual([])
    },
  )

  it('groups the four HNI analysis prose blocks without flattening their styled cards or headings', () => {
    const result = region('tsa-humanneedsindex', 'explore-data', 'insights-body')
    expect(result.slots.filter(slot => slot.kind === 'richtext')).toHaveLength(4)
    expect(result.slots.filter(slot => slot.kind === 'text')).toHaveLength(8)
    expect(result.render()).toBe(result.html)
  })

  it('joins the HNI home overview’s three styled paragraphs into one field that keeps their styling (V1 reference 06)', () => {
    const result = region('tsa-humanneedsindex', 'index', 'overview-body')
    expect(result.slots).toHaveLength(1)
    const field = result.slots[0]!
    expect(field).toMatchObject({ kind: 'richtext', label: 'Overview body' })
    const paragraphs = result.authored.children.filter(
      (node): node is HtmlElement => node.kind === 'element' && node.tag === 'p',
    )
    expect(paragraphs).toHaveLength(3)
    const presentation = { class: attribute(paragraphs[0]!, 'class'), style: attribute(paragraphs[0]!, 'style') }
    expect(field.constraints).toEqual({ blockAttributes: { p: presentation } })
    // The stored value is ordinary rich text; the definition carries the look.
    expect(String(result.values[field.id])).not.toMatch(/class=|style=/)
    expect(result.render()).toBe(result.html)
    const opening = `<p class="${presentation.class}" style="${presentation.style}">`
    expect(
      result.render({ [field.id]: '<p>Revised overview &amp; <em>context</em>.</p><p>A new second paragraph.</p>' }),
    ).toBe(
      `<div class="space-y-4" data-block-id="overview-body" data-editable="richtext">${opening}Revised overview &amp; <em>context</em>.</p>${opening}A new second paragraph.</p></div>`,
    )
    expect(result.issues).toEqual([])
  })

  it('makes the HNI hero subtitle one inline field that keeps its red emphasis, as V1 edits it', () => {
    const result = region('tsa-humanneedsindex', 'index', 'hero-subtitle')
    expect(result.slots).toHaveLength(1)
    const field = result.slots[0]!
    const emphasis = result.authored.children.find(
      (node): node is HtmlElement => node.kind === 'element' && node.tag === 'em',
    )!
    expect(field).toMatchObject({
      kind: 'richtext',
      label: 'Hero subtitle',
      constraints: { inline: true, inlineAttributes: { em: { class: attribute(emphasis, 'class') } } },
    })
    expect(String(result.values[field.id])).toMatch(/shows those in need<br>\s*<em>love beyond hardship<\/em>/)
    expect(String(result.values[field.id])).not.toMatch(/class=|<p/)
    expect(result.render()).toBe(result.html)
    // A new emphasis takes the same red; a pasted paragraph stays inside the line.
    const updated = result.render({ [field.id]: '<p>Find out how we help</p><p><em>every day</em></p>' })
    expect(updated).toContain(`>Find out how we help<br><em class="${attribute(emphasis, 'class')}">every day</em></p>`)
    expect(result.issues).toEqual([])
  })

  it('keeps the HNI “near real time” emphasis inside its styled paragraph as one field', () => {
    const result = region('tsa-humanneedsindex', 'index', 'measuring-bottom')
    const rich = result.slots.filter(slot => slot.kind === 'richtext')
    expect(rich).toHaveLength(1)
    expect(rich[0]!.constraints).toMatchObject({
      blockAttributes: { p: expect.any(Object) },
      inlineAttributes: { em: { class: 'text-sa-red not-italic font-semibold' } },
    })
    expect(String(result.values[rich[0]!.id])).toContain('<em>near real time</em>')
    expect(result.render()).toBe(result.html)
  })

  it.each(['about-sa', 'about-lilly'])('retains HNI organization link behavior and logos in %s', id => {
    const result = region('tsa-humanneedsindex', 'resources', id)
    expect(result.render()).toBe(result.html)
    expect(result.slots.some(slot => slot.kind === 'richtext')).toBe(false)
    const link = result.slots.find(slot => slot.kind === 'link')!
    expect(link).toBeDefined()
    const updated = result.render({
      ...result.values,
      [link.id]: { url: 'https://example.test/organization?source=hni&audience=public#about' },
    })
    expect(updated).toContain(
      'href="https://example.test/organization?source=hni&amp;audience=public#about" target="_blank" rel="noopener noreferrer"',
    )
    expect(updated.match(/<img\b[^>]*>/g)).toEqual(result.html.match(/<img\b[^>]*>/g))
    expect(updated.match(/<svg\b[\s\S]*?<\/svg>/g)).toEqual(result.html.match(/<svg\b[\s\S]*?<\/svg>/g))
  })

  it.each(['focus-1', 'focus-2', 'focus-3'])(
    'groups Echelon %s copy while retaining illustration and independently editable destination',
    id => {
      const result = region('tsa-echelonsymposium', 'index', id)
      expect(result.slots.map(slot => slot.kind)).toEqual(['richtext', 'link'])
      expect(result.render()).toBe(result.html)
      const richtext = result.slots[0]!
      const edited = result.render({
        ...result.values,
        [richtext.id]: '<h3>New focus</h3><p>Practical <em>guidance</em>.</p>',
      })
      expect(edited).toContain('<h3>New focus</h3><p>Practical <em>guidance</em>.</p>')
      expect(edited.match(/<img\b[^>]*>/g)).toEqual(result.html.match(/<img\b[^>]*>/g))
      expect(edited.match(/<svg\b[\s\S]*?<\/svg>/g)).toEqual(result.html.match(/<svg\b[\s\S]*?<\/svg>/g))
      expect(edited.match(/<a\b[^>]*>/g)).toEqual(result.html.match(/<a\b[^>]*>/g))
    },
  )

  it.each([
    'hero-tagline',
    'about-body',
    'speakers-subtitle',
    'data-subtitle',
    'agenda-subtitle',
    'process-subtitle',
    'process-1-body',
    'process-2-body',
    'process-3-body',
    'resources-subtitle',
    'faq-1-a',
    'faq-2-a',
    'faq-3-a',
    'register-body',
  ])('preserves the source element of Echelon %s instead of nesting a block editor in a paragraph/span', id => {
    const result = region('tsa-echelonsymposium', 'index', id)
    expect(['p', 'span']).toContain(result.authored.tag)
    expect(result.slots.map(slot => slot.kind)).toEqual(['text'])
    expect(result.issues).toEqual(['inline-richtext-field-mapping-required'])
    expect(result.render()).toBe(result.html)
    const edited = result.render({ [result.slots[0]!.id]: 'Revised & safe <text>' })
    expect(edited).toContain('>Revised &amp; safe &lt;text&gt;</')
    expect(edited.match(/<(?:p|span)\b/g)).toHaveLength(1)
  })

  it('retains HNI citation emphasis and styled destination as separately editable fields', () => {
    const result = region('tsa-humanneedsindex', 'methodology', 'indicators-for-citation')
    expect(result.render()).toBe(result.html)
    expect(result.slots.map(slot => slot.kind)).toEqual(['text', 'text', 'link', 'text', 'text'])
    expect(result.issues).toEqual(['inline-richtext-field-mapping-required'])
  })

  it.each(['cta-1', 'cta-2', 'cta-3', 'cta-4'])('retains HNI %s author labels and link scope', id => {
    const result = region('tsa-humanneedsindex', 'index', id)
    const label = attribute(result.authored, 'data-cms-label')!
    expect(result.slots.some(slot => slot.label === `${label} · destination` && slot.kind === 'link')).toBe(true)
    expect(result.slots.some(slot => slot.kind === 'richtext')).toBe(false)
    expect(result.slots.some(slot => slot.label.endsWith('card button text'))).toBe(true)
    const destination = result.slots.find(slot => slot.kind === 'link')!
    expect(result.values[destination.id]).toEqual({ url: attribute(result.authored, 'href') })
  })
})
