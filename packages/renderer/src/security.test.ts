// The malicious fixture corpus (SPEC §9). Stored content is treated as
// hostile no matter which boundary it passed on the way in, so every one of
// these is asserted at the point where HTML is actually produced.
import { describe, expect, it } from 'vitest'
import { escapeAttribute, escapeText, safeUrl } from './escape.ts'
import { richTextForVisualEditor, richTextFromVisualEditor, sanitizeRichText } from './richtext.ts'
import { scopeCss } from './css.ts'
import { compileSection } from './compile.ts'
import { renderSection, type ManifestSection } from './render.ts'
import { stripPreviewInstrumentation } from './preview-runtime.ts'

describe('safeUrl', () => {
  it.each([
    ['javascript:alert(1)', '#'],
    ['JaVaScRiPt:alert(1)', '#'],
    ['java\nscript:alert(1)', '#'],
    ['javascript:alert(1)', '#'],
    ['data:text/html;base64,PHNjcmlwdD4=', '#'],
    ['vbscript:msgbox(1)', '#'],
    ['//evil.example.com/x', '#'],
    ['https://trusted.test@evil.test/', '#'],
    ['https://user:password@example.test/', '#'],
    ['https:trusted.test@evil.test/', '#'],
    ['https:\\\\trusted.test@evil.test/', '#'],
    ['https://%75ser@example.test/', '#'],
    ['', '#'],
  ])('neutralises %p', (input, expected) => {
    expect(safeUrl(input)).toBe(expected)
  })

  it.each([
    '/about',
    '/a/b?x=1',
    '#anchor',
    'https://example.com/x',
    'https://example.test/a?contact=person@example.test',
    'mailto:a@b.test',
    'tel:+15551234',
  ])('keeps %p', input => {
    expect(safeUrl(input)).not.toBe('#')
  })
})

describe('escaping is sink-specific', () => {
  it('escapes markup in text', () => {
    expect(escapeText('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes quotes in attributes so a value cannot break out', () => {
    expect(escapeAttribute('" onerror="alert(1)')).toBe('&quot; onerror=&quot;alert(1)')
  })
})

describe('rich text allowlist', () => {
  it('keeps allowed formatting', () => {
    expect(sanitizeRichText('<p>Hello <strong>world</strong></p>')).toBe('<p>Hello <strong>world</strong></p>')
  })

  it('decodes character references only as text, then escapes them exactly once', () => {
    const tiptap = '<p><strong>Family &amp; Services &lt; &gt;&nbsp; &amp;amp;</strong></p>'
    const canonical = '<p><strong>Family &amp; Services &lt; &gt;\u00a0 &amp;amp;</strong></p>'
    expect(richTextFromVisualEditor(tiptap)).toBe(canonical)
    expect(richTextForVisualEditor(canonical)).toBe(canonical)
    expect(sanitizeRichText(canonical)).toBe(canonical)
  })

  it('never reparses a decoded character reference as markup', () => {
    expect(sanitizeRichText('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    )
  })

  it('drops a script tag but keeps surrounding text', () => {
    expect(sanitizeRichText('<p>a<script>alert(1)</script>b</p>')).toBe('<p>aalert(1)b</p>')
  })

  it('drops event-handler attributes', () => {
    expect(sanitizeRichText('<p onclick="alert(1)">x</p>')).toBe('<p>x</p>')
  })

  it('neutralises a javascript: href and marks the link untrusted', () => {
    const html = sanitizeRichText('<a href="javascript:alert(1)">go</a>')
    expect(html).toContain('href="#"')
    expect(html).toContain('rel="noopener nofollow"')
  })

  it('applies the URL policy after decoding attribute character references', () => {
    expect(sanitizeRichText('<a href="java&#x73;cript:alert(1)">go</a>')).toContain('href="#"')
    expect(sanitizeRichText('<a href="/search?a=1&amp;b=2">go</a>')).toContain('href="/search?a=1&amp;b=2"')
  })

  it('closes tags the author left open rather than leaking them into the page', () => {
    expect(sanitizeRichText('<p>unclosed')).toBe('<p>unclosed</p>')
  })

  it('ignores a stray close tag for something never opened', () => {
    expect(sanitizeRichText('a</p>b')).toBe('ab')
  })

  it('does not let an unknown tag smuggle attributes through', () => {
    expect(sanitizeRichText('<svg onload="alert(1)">x</svg>')).toBe('x')
  })
})

describe('CSS policy', () => {
  it('scopes every selector to the block that declared it', () => {
    const { css } = scopeCss('.title{color:red}.sub{color:blue}', '#s0')
    expect(css).toBe('#s0 .title{color:red}#s0 .sub{color:blue}')
  })

  it('supports & for the block itself', () => {
    expect(scopeCss('&{padding:1rem}', '#s0').css).toBe('#s0{padding:1rem}')
  })

  it('refuses @import and reports it', () => {
    const result = scopeCss('@import url("https://evil.example.com/x.css");.a{color:red}', '#s0')
    expect(result.css).toBe('#s0 .a{color:red}')
    expect(result.violations).toContain('at-rules that load external resources are not allowed')
  })

  it('refuses an off-site url() rather than fetching it', () => {
    const result = scopeCss('.a{background:url("https://evil.example.com/p.gif")}', '#s0')
    // Policy 3 drops the declaration outright rather than rewriting it to
    // `none`. Both refuse the request; dropping says less about what the author
    // meant, and leaves the rest of the rule intact.
    expect(result.css).not.toContain('evil.example.com')
    expect(result.css).not.toContain('background')
    expect(result.violations).toContain('url() may only reference this site')
  })

  it('keeps a same-origin url()', () => {
    expect(scopeCss('.a{background:url("/media/x.png")}', '#s0').css).toContain('url("/media/x.png")')
  })

  it('drops a block containing an active value', () => {
    const result = scopeCss('.a{width:expression(alert(1))}.b{color:red}', '#s0')
    expect(result.css).toBe('#s0 .b{color:red}')
    expect(result.violations).toContain('active CSS values are not allowed')
  })
})

describe('compiled sections', () => {
  const slots = [
    { id: 'heading', kind: 'text' as const, label: 'Heading', constraints: {} },
    { id: 'body', kind: 'richtext' as const, label: 'Body', constraints: {} },
  ]

  it('turns the template into alternating html and slot nodes', () => {
    const result = compileSection({ sourceHtml: '<h1>{{heading}}</h1><div>{{body}}</div>', slots })
    expect(result.problems).toEqual([])
    expect(result.ast.nodes.map(n => n.kind)).toEqual(['html', 'slot', 'html', 'slot', 'html'])
  })

  it('reports a token with no declared slot instead of passing it through', () => {
    const result = compileSection({ sourceHtml: '<h1>{{heading}}</h1>{{mystery}}<div>{{body}}</div>', slots })
    expect(result.problems).toContain('the template uses {{mystery}} but no slot with that id is declared')
    expect(result.ast.nodes.some(n => n.kind === 'slot' && n.slotId === 'mystery')).toBe(false)
  })

  it('reports a declared slot the template never uses', () => {
    const result = compileSection({ sourceHtml: '<h1>{{heading}}</h1>', slots })
    expect(result.problems).toContain('slot body is declared but never used in the template')
  })

  it('marks active markup as trusted code needing approval', () => {
    const result = compileSection({ sourceHtml: '<h1>{{heading}}</h1><script>x()</script><div>{{body}}</div>', slots })
    expect(result.carriesTrustedCode).toBe(true)
    expect(result.problems).toContain(
      'the template contains active markup, so publishing it needs super-admin approval',
    )
  })

  it('marks an inline event handler as trusted code', () => {
    const result = compileSection({ sourceHtml: '<h1 onclick="x()">{{heading}}</h1><div>{{body}}</div>', slots })
    expect(result.carriesTrustedCode).toBe(true)
  })

  it('produces a stable render hash that changes when the output would', () => {
    const a = compileSection({ sourceHtml: '<h1>{{heading}}</h1><div>{{body}}</div>', slots })
    const b = compileSection({ sourceHtml: '<h1>{{heading}}</h1><div>{{body}}</div>', slots })
    const c = compileSection({ sourceHtml: '<h2>{{heading}}</h2><div>{{body}}</div>', slots })
    expect(a.renderHash).toBe(b.renderHash)
    expect(a.renderHash).not.toBe(c.renderHash)
  })
})

describe('rendering treats stored values as hostile', () => {
  const compiled = compileSection({
    sourceHtml: '<section><h1>{{heading}}</h1><div>{{body}}</div><p>{{cta}}</p><p>{{picture}}</p></section>',
    slots: [
      { id: 'heading', kind: 'text', label: 'Heading', constraints: {} },
      { id: 'body', kind: 'richtext', label: 'Body', constraints: {} },
      { id: 'cta', kind: 'link', label: 'CTA', constraints: {} },
      { id: 'picture', kind: 'image', label: 'Picture', constraints: {} },
    ],
  })

  const section = (values: Record<string, unknown>): ManifestSection => ({
    instance: { section_def_id: 'd1', section_def_version: 1, values },
    def: { section_def_id: 'd1', version: 1, slug: 'hero', compiled_ast: compiled.ast, css: compiled.css },
  })

  it('escapes a text slot', () => {
    const html = renderSection(section({ heading: '<img src=x onerror=alert(1)>' }), 0)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('sanitizes a rich text slot', () => {
    const html = renderSection(section({ body: '<p>ok</p><script>bad()</script>' }), 0)
    expect(html).toContain('<p>ok</p>')
    expect(html).not.toContain('<script>')
  })

  it('neutralises a hostile link slot', () => {
    const html = renderSection(section({ cta: { url: 'javascript:alert(1)', label: 'Click' } }), 0)
    expect(html).toContain('href="#"')
    expect(html).toContain('>Click<')
  })

  it('always emits an alt attribute, decorative or described', () => {
    expect(renderSection(section({ picture: { src: '/a.png', alt: 'A cat' } }), 0)).toContain('alt="A cat"')
    expect(renderSection(section({ picture: { src: '/a.png', alt: '' } }), 0)).toContain('alt="" role="presentation"')
  })

  it('renders nothing for a hidden section', () => {
    expect(
      renderSection(
        { ...section({ heading: 'x' }), instance: { section_def_id: 'd1', section_def_version: 1, hidden: true } },
        0,
      ),
    ).toBe('')
  })

  it('emits no editor instrumentation in public output', () => {
    const html = renderSection(section({ heading: 'Hello' }), 0)
    expect(html).not.toContain('data-cms-')
  })

  it('emits instrumentation in preview, which is the only difference', () => {
    const publicHtml = renderSection(section({ heading: 'Hello' }), 0)
    const previewHtml = renderSection(section({ heading: 'Hello' }), 0, { preview: true })
    expect(previewHtml).toContain('data-cms-section="0"')
    expect(previewHtml).toContain('data-cms-slot="heading"')
    expect(stripPreviewInstrumentation(previewHtml)).toBe(publicHtml)
  })
})
