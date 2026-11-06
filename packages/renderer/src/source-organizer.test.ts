import { describe, expect, it } from 'vitest'
import { organizeSource } from './source-organizer.ts'
import { CSS_POLICY_VERSION, compileSection, renderSection, sectionScopeSelector } from './index.ts'

describe('source organization proposal', () => {
  it('keeps authored structure, CSS, comments, image attributes and encoded text while deriving typed fields', () => {
    const source = `<style>.hero { padding: 2rem }</style>\n<section class='hero'><!-- retain this note --><h1>Research &amp; action</h1><img class="portrait" src="/media/photo/large" alt="A &amp; B" width="200"><a class="action" href="/about?x=1&amp;y=2">Read more</a></section>`
    const proposal = organizeSource(source, '.action { color: red }')
    expect(proposal.blocking).toEqual([])
    expect(proposal.originalHtml).toBe(source)
    expect(proposal.sourceCss).toBe('.hero { padding: 2rem }\n\n.action { color: red }')
    expect(proposal.sourceHtml).toContain(`<section class='hero'><!-- retain this note --><h1>{{heading}}</h1>`)
    expect(proposal.sourceHtml).toContain(
      '<img class="portrait" src="{{image}}" alt="{{image}}" width="200" role="{{image}}">',
    )
    expect(proposal.sourceHtml).toContain('<a class="action" href="{{link}}">{{link-text}}</a>')
    expect(proposal.samples.heading).toBe('Research & action')
    expect(proposal.samples.image).toEqual({ src: '/media/photo/large', alt: 'A & B', decorative: false })
    expect(proposal.samples.link).toEqual({ url: '/about?x=1&y=2', label: 'Read more' })
    const compiled = compileSection({
      sourceHtml: proposal.sourceHtml,
      sourceCss: proposal.sourceCss,
      slots: proposal.fields,
      scopeSelector: sectionScopeSelector('organized')!,
    })
    expect(compiled.blocking).toEqual([])
    const output = renderSection(
      {
        def: {
          section_def_id: 'test',
          version: 1,
          slug: 'organized',
          compiled_ast: compiled.ast,
          css: compiled.css,
          css_policy_version: CSS_POLICY_VERSION,
          slots: proposal.fields,
        },
        instance: { section_def_id: 'test', section_def_version: 1, values: proposal.samples },
      },
      0,
    )
    expect(output).toContain('Research &amp; action')
    expect(output).toContain('class="portrait"')
  })
  it('groups supported formatted copy and never retags deliberate fields', () => {
    const proposal = organizeSource(
      '<section><h2>{{chosen_heading}}</h2><div class="copy"><p>First <strong>important</strong> paragraph.</p><ul><li>One</li></ul></div><p>Another field</p></section>',
      '',
      [{ id: 'chosen_heading', kind: 'text', label: 'Existing heading', constraints: { maxLength: 50 } }],
    )
    expect(proposal.blocking).toEqual([])
    expect(proposal.sourceHtml).toContain('<h2>{{chosen_heading}}</h2>')
    expect(proposal.sourceHtml).toContain('<div class="copy">{{body}}</div>')
    expect(proposal.fields[0]?.constraints).toEqual({ maxLength: 50 })
    expect(proposal.samples.body).toContain('<strong>important</strong>')
    expect(proposal.samples.chosen_heading).toBeUndefined()
    const again = organizeSource(proposal.sourceHtml, proposal.sourceCss, proposal.fields)
    expect(again.sourceHtml).toBe(proposal.sourceHtml)
    expect(again.fields).toEqual(proposal.fields)
  })
  it('repairs duplicate identifiers and only their local unambiguous references', () => {
    const source =
      '<div id="panel"><a href="#panel">First</a></div><div id="panel"><a href="#panel" aria-controls="panel other">Second</a></div><a href="#panel">Outside</a>'
    const proposal = organizeSource(source, '')
    expect(proposal.blocking).toEqual([])
    expect(proposal.sourceHtml).toContain('<div id="panel-2"><a href="#panel-2" aria-controls="panel-2 other">')
    expect(proposal.sourceHtml).toContain('<a href="#panel">{{link-text-3}}</a>')
    expect(proposal.notes.join(' ')).toContain('Outside references still select #panel')
    const css = organizeSource(source, '#panel { color:red }')
    expect(css.blocking.join(' ')).toContain('shared class')
    expect(css.sourceHtml).toBe(source)
  })
  it.each([
    '<script>alert(1)</script>',
    '<form><input name="x"></form>',
    '<p onclick="run()">No</p>',
    '<iframe src="https://example.com"></iframe>',
    '<a href="&#106;avascript:alert(1)">Unsafe encoded link</a>',
    '<p class=unquoted>Fix me</p>',
    '<html><body>Full site</body></html>',
  ])('returns unchanged source with actionable diagnostics for %s', source => {
    const proposal = organizeSource(source, 'p{color:red}')
    expect(proposal.blocking.length).toBeGreaterThan(0)
    expect(proposal.sourceHtml).toBe(source)
    expect(proposal.sourceCss).toBe('p{color:red}')
  })
  it('leaves responsive image markup intact and explains its manual requirement', () => {
    const source = '<img src="/small" srcset="/large 2x" alt="Image">'
    const proposal = organizeSource(source, '')
    expect(proposal.sourceHtml).toBe(source)
    expect(proposal.notes.join(' ')).toContain('responsive image kept unchanged')
  })
  it('refuses excessive work before recursively analyzing the section', () => {
    const source = '<div>'.repeat(50) + 'text' + '</div>'.repeat(50)
    expect(organizeSource(source, '').blocking.join(' ')).toContain('40 nesting')
    expect(organizeSource('a'.repeat(300001), '').blocking.join(' ')).toContain('300 KB')
  })
})
