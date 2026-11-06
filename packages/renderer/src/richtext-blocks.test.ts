import { describe, expect, it } from 'vitest'
import { compileSection } from './compile.ts'
import { renderSection } from './render.ts'
import { stripPreviewInstrumentation } from './preview-runtime.ts'
import { applyRichTextBlockAttributes, richTextBlockAttributes, sanitizeRichText } from './richtext.ts'

// A definition-owned presentation for one rich-text field's blocks (EDIT-02):
// the classes and style an imported source put on every paragraph, applied on
// the way out so the paragraphs can be one field without losing their look.
const HNI = { class: 'text-sa-dark leading-relaxed text-[1.0625rem]', style: 'font-family: var(--font-secondary);' }

describe('rich-text block presentation', () => {
  it('puts the presentation on top-level blocks and top-level list items only, leaving the value canonical', () => {
    const blocks = richTextBlockAttributes({ p: HNI, li: { class: 'tick' }, blockquote: { class: 'pull' } })
    const html = sanitizeRichText(
      '<p>One <strong>bold</strong></p><ul><li>Item <em>a</em></li></ul><blockquote><p>Quoted</p></blockquote><p>Two<br>lines</p>',
    )
    expect(applyRichTextBlockAttributes(html, blocks)).toBe(
      '<p class="text-sa-dark leading-relaxed text-[1.0625rem]" style="font-family: var(--font-secondary);">One <strong>bold</strong></p>' +
        '<ul><li class="tick">Item <em>a</em></li></ul><blockquote class="pull"><p>Quoted</p></blockquote>' +
        '<p class="text-sa-dark leading-relaxed text-[1.0625rem]" style="font-family: var(--font-secondary);">Two<br>lines</p>',
    )
    // Links keep their own destination and relationship.
    expect(applyRichTextBlockAttributes(sanitizeRichText('<p><a href="/x">x</a></p>'), blocks)).toBe(
      '<p class="text-sa-dark leading-relaxed text-[1.0625rem]" style="font-family: var(--font-secondary);"><a href="/x" rel="noopener nofollow">x</a></p>',
    )
    expect(applyRichTextBlockAttributes(html, {})).toBe(html)
  })

  it('refuses whole values that could reach another sink, and keeps passing ones verbatim', () => {
    for (const style of [
      'background:url(//evil.test/x)',
      'color:red;position:fixed',
      'font-family:x\\3c/style',
      'color:expression(alert(1))',
      'color:red /* hidden */',
      'color:red}body{display:none',
      'width:100px',
      'color:"unbalanced',
      'list-style-image:none',
      'color:red !x',
    ]) {
      expect({ style, blocks: richTextBlockAttributes({ p: { style } }) }).toEqual({ style, blocks: {} })
    }
    for (const className of ['a"b', '<x>', 'a\u0000b', 'x'.repeat(501)]) {
      expect(richTextBlockAttributes({ p: { class: className } })).toEqual({})
    }
    expect(
      richTextBlockAttributes({
        p: { class: 'md:text-lg w-1/2 bg-[#fff]', style: 'margin-top: .5rem; color: #1b2530 !important' },
      }),
    ).toEqual({ p: { class: 'md:text-lg w-1/2 bg-[#fff]', style: 'margin-top: .5rem; color: #1b2530 !important' } })
    // Unknown tags, arrays and junk contribute nothing.
    expect(richTextBlockAttributes({ div: HNI, script: HNI, p: 'x' })).toEqual({})
    expect(richTextBlockAttributes([HNI])).toEqual({})
    expect(richTextBlockAttributes(null)).toEqual({})
  })

  it('renders an imported section whose styled paragraphs share one field, exactly as the source looked', () => {
    const slots = [
      { id: 'body', kind: 'richtext' as const, label: 'Overview body', constraints: { blockAttributes: { p: HNI } } },
    ]
    const compiled = compileSection({
      sourceHtml: '<div class="space-y-4">{{body}}</div>',
      sourceCss: '',
      slots,
      scopeSelector: '.cms-section--overview',
    })
    expect(compiled.blocking).toEqual([])
    const section = {
      instance: {
        section_def_id: 'd',
        section_def_version: 1,
        values: { body: '<p>First paragraph.</p><p>Second <em>one</em>.</p>' },
        hidden: false,
        hidden_at: [],
        label: '',
      },
      def: { section_def_id: 'd', version: 1, slug: 'overview', compiled_ast: compiled.ast, slots },
    }
    const html = renderSection(section as Parameters<typeof renderSection>[0], 0)
    expect(html).toContain(
      '<div class="space-y-4"><p class="text-sa-dark leading-relaxed text-[1.0625rem]" style="font-family: var(--font-secondary);">First paragraph.</p>' +
        '<p class="text-sa-dark leading-relaxed text-[1.0625rem]" style="font-family: var(--font-secondary);">Second <em>one</em>.</p></div>',
    )
    // A tampered stored presentation is dropped rather than emitted.
    const tampered = {
      ...section,
      def: {
        ...section.def,
        slots: [{ ...slots[0]!, constraints: { blockAttributes: { p: { style: 'background:url(//evil.test)' } } } }],
      },
    }
    expect(renderSection(tampered as Parameters<typeof renderSection>[0], 0)).toContain(
      '<div class="space-y-4"><p>First paragraph.</p>',
    )
  })
})

describe('a rich-text field that fills its element, in the editor canvas', () => {
  const section = (sourceHtml: string) => {
    const slots = [{ id: 'body', label: 'Body', kind: 'richtext' as const, constraints: {} }]
    const compiled = compileSection({ sourceHtml, sourceCss: '', slots, scopeSelector: '.cms-section--hosted' })
    expect(compiled.blocking).toEqual([])
    return {
      instance: {
        section_def_id: 'd',
        section_def_version: 1,
        values: { body: '<p>One.</p><p>Two.</p>' },
        hidden: false,
        hidden_at: [],
        label: '',
      },
      def: { section_def_id: 'd', version: 1, slug: 'hosted', compiled_ast: compiled.ast, slots },
    } as Parameters<typeof renderSection>[0]
  }

  it('is marked on that element, so the section’s child rules still reach its paragraphs', () => {
    const preview = renderSection(section('<div class="space-y-4">{{body}}</div>'), 0, { preview: true })
    expect(preview).toContain(
      '<div class="space-y-4" data-cms-slot="body" data-cms-kind="richtext"><p>One.</p><p>Two.</p></div>',
    )
    expect(preview).not.toContain('<cms-slot')
    expect(stripPreviewInstrumentation(preview)).toBe(
      renderSection(section('<div class="space-y-4">{{body}}</div>'), 0),
    )
  })

  it('keeps the wrapper where the field shares its element or sits where a block editor cannot', () => {
    expect(renderSection(section('<div><h2>Title</h2>{{body}}</div>'), 0, { preview: true })).toContain(
      '<cms-slot data-cms-slot="body" data-cms-kind="richtext">',
    )
    expect(renderSection(section('<p>{{body}}</p>'), 0, { preview: true })).toContain(
      '<cms-slot data-cms-slot="body" data-cms-kind="richtext">',
    )
  })
})
