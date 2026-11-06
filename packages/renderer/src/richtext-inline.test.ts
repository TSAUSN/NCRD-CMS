import { describe, expect, it } from 'vitest'
import { compileSection } from './compile.ts'
import { renderSection } from './render.ts'
import { stripPreviewInstrumentation } from './preview-runtime.ts'
import {
  applyRichTextInlineAttributes,
  presentRichText,
  richTextInlineAttributes,
  sanitizeRichText,
} from './richtext.ts'

// One field for words with styled emphasis inside a paragraph or heading
// (EDIT-02): HNI's hero subtitle is “Discover more …<br><em class="red">love
// beyond hardship</em>”, which V1 edits as one region.
describe('an inline rich-text field', () => {
  it('keeps words, line breaks and marks, and turns block boundaries into line breaks', () => {
    const inline = (html: string) => sanitizeRichText(html, { inline: true })
    expect(inline('Discover more<br><em>love beyond hardship</em>')).toBe(
      'Discover more<br><em>love beyond hardship</em>',
    )
    expect(inline('<p>One <strong>bold</strong></p><p>Two</p>')).toBe('One <strong>bold</strong><br>Two')
    expect(inline('<h2>Title</h2>\n<ul><li>a</li><li>b</li></ul>')).toBe('Title<br>a<br>b')
    expect(inline('<p><a href="/x">x</a></p><blockquote><p>q</p></blockquote>')).toBe(
      '<a href="/x" rel="noopener nofollow">x</a><br>q',
    )
    expect(inline('<script>alert(1)</script>words')).toBe('alert(1)words')
    // Canonical inline output is a fixed point, and block fields are unaffected.
    for (const value of ['a<br><em>b</em> &amp; c', '<strong><em>both</em></strong>', ''])
      expect(inline(inline(value))).toBe(inline(value))
    expect(sanitizeRichText('<p>One</p><p>Two</p>')).toBe('<p>One</p><p>Two</p>')
  })

  it('draws a definition’s mark presentation on every matching mark, under the block policy', () => {
    const marks = richTextInlineAttributes({ em: { class: 'red' }, strong: { style: 'font-weight: 800' } })
    expect(
      applyRichTextInlineAttributes(sanitizeRichText('<p>a <em>b</em> <strong>c <em>d</em></strong></p>'), marks),
    ).toBe('<p>a <em class="red">b</em> <strong style="font-weight: 800">c <em class="red">d</em></strong></p>')
    expect(
      richTextInlineAttributes({
        em: { style: 'background:url(//evil.test/x)' },
        a: { class: 'x' },
        span: { class: 'x' },
      }),
    ).toEqual({})
    expect(applyRichTextInlineAttributes('<em>x</em>', {})).toBe('<em>x</em>')
  })

  it('presents a field from its constraints, inline or block', () => {
    expect(
      presentRichText('<p>Discover more</p><p><em>love</em></p>', {
        inline: true,
        inlineAttributes: { em: { class: 'red' } },
        blockAttributes: { p: { class: 'x' } },
      }),
    ).toBe('Discover more<br><em class="red">love</em>')
    expect(
      presentRichText('<p>a <em>b</em></p>', {
        blockAttributes: { p: { class: 'lead' } },
        inlineAttributes: { em: { class: 'red' } },
      }),
    ).toBe('<p class="lead">a <em class="red">b</em></p>')
    expect(presentRichText('<p>x</p>', null)).toBe('<p>x</p>')
  })

  it('renders inside its paragraph exactly as the source did, and the canvas wrapper adds nothing to the public page', () => {
    const slots = [
      {
        id: 'subtitle',
        kind: 'richtext' as const,
        label: 'Hero subtitle',
        constraints: { inline: true, inlineAttributes: { em: { class: 'text-sa-red' } } },
      },
    ]
    const compiled = compileSection({
      sourceHtml: '<p class="lede">{{subtitle}}</p>',
      sourceCss: '',
      slots,
      scopeSelector: '.cms-section--hero',
    })
    expect(compiled.blocking).toEqual([])
    const section = {
      instance: {
        section_def_id: 'd',
        section_def_version: 1,
        values: { subtitle: 'Discover more<br><em>love beyond hardship</em>' },
        hidden: false,
        hidden_at: [],
        label: '',
      },
      def: { section_def_id: 'd', version: 1, slug: 'hero', compiled_ast: compiled.ast, slots },
    } as Parameters<typeof renderSection>[0]
    const html = renderSection(section, 0)
    expect(html).toContain('<p class="lede">Discover more<br><em class="text-sa-red">love beyond hardship</em></p>')
    // A stored paragraph cannot break out of the definition's paragraph.
    const pasted = {
      ...section,
      instance: { ...section.instance, values: { subtitle: '<p>One</p><p>Two</p>' } },
    } as typeof section
    expect(renderSection(pasted, 0)).toContain('<p class="lede">One<br>Two</p>')
    const preview = renderSection(section, 0, { preview: true })
    expect(preview).toContain('<cms-slot data-cms-slot="subtitle" data-cms-kind="richtext">')
    expect(stripPreviewInstrumentation(preview)).toBe(html)
  })
})
