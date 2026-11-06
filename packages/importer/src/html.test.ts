import { describe, expect, it } from 'vitest'
import { attribute, elements, parseHtml } from './html.ts'

/** The tree, or the refusal, without the caller having to narrow the union. */
function tree(html: string) {
  const parsed = parseHtml(html)
  if (!parsed.ok) throw new Error(`expected a parse, got: ${parsed.refusal}`)
  return parsed.nodes
}

function refusal(html: string): string {
  const parsed = parseHtml(html)
  if (parsed.ok) throw new Error('expected a refusal, got a parse')
  return parsed.refusal
}

describe('the HTML reader', () => {
  it('nests elements the way the source nests them', () => {
    const nodes = tree('<section><p class="a">text</p></section>')
    expect(nodes).toHaveLength(1)
    expect(elements(nodes).map(element => element.tag)).toEqual(['section', 'p'])
    expect(attribute(elements(nodes)[1]!, 'class')).toBe('a')
  })

  it('keeps attribute values exactly as written, including the empty one', () => {
    const [element] = elements(tree('<img src="/a.webp" alt="" width="10">'))
    expect(element!.attributes).toEqual([
      { name: 'src', value: '/a.webp' },
      { name: 'alt', value: '' },
      { name: 'width', value: '10' },
    ])
  })

  it('reports the line an element was written on, counting from one', () => {
    const nodes = tree('<div>\n  <p>a</p>\n\n  <span>b</span>\n</div>')
    expect(elements(nodes).map(element => [element.tag, element.line])).toEqual([
      ['div', 1],
      ['p', 2],
      ['span', 4],
    ])
  })

  it('closes void elements without an end tag and without swallowing what follows', () => {
    const nodes = tree('<div><br><img src="/a.webp"><p>after</p></div>')
    const [div] = elements(nodes)
    expect(div!.children.map(child => (child.kind === 'element' ? child.tag : 'text'))).toEqual(['br', 'img', 'p'])
  })

  it('honours the self-closing slash inside SVG, where it is the syntax', () => {
    const nodes = tree('<span><svg viewBox="0 0 24 24"><path d="M0 0" /></svg><em>after</em></span>')
    const [span] = elements(nodes)
    expect(span!.children.map(child => (child.kind === 'element' ? child.tag : 'text'))).toEqual(['svg', 'em'])
  })

  it('refuses the self-closing slash outside foreign content, where a browser ignores it', () => {
    expect(refusal('<div/><p>after</p>')).toContain('is written as self-closing')
  })

  it('refuses an end tag that closes something else, rather than guessing', () => {
    expect(refusal('<div><span></div></span>')).toBe('</div> closes an element opened as <span>')
  })

  it('refuses an element that is never closed', () => {
    expect(refusal('<section><div>')).toBe('<div> is never closed')
  })

  it('refuses an unquoted attribute value, because whitespace would decide where it ends', () => {
    expect(refusal('<div class=hero>')).toBe('<div> has an unquoted value for class')
  })

  it('refuses an element carrying the same attribute twice', () => {
    expect(refusal('<div class="a" class="b"></div>')).toBe('<div> carries class twice')
  })

  it('refuses script and style outright rather than reading their bodies', () => {
    expect(refusal('<div><script>alert(1)</script></div>')).toContain('<script>')
    expect(refusal('<div><style>body{}</style></div>')).toContain('<style>')
  })

  it('keeps a textarea as an empty element rather than parsing text that may contain "<"', () => {
    const nodes = tree('<p><textarea rows="2">a < b</textarea>tail</p>')
    const [textarea] = elements(nodes).filter(element => element.tag === 'textarea')
    expect(textarea!.children).toEqual([])
    expect(attribute(textarea!, 'rows')).toBe('2')
  })

  it('drops comments, which render nothing, and keeps what surrounds them', () => {
    const nodes = tree('<p>a<!-- note -->b</p>')
    const [p] = elements(nodes)
    expect(p!.children.filter(child => child.kind === 'text').map(child => child.text)).toEqual(['a', 'b'])
  })

  it('refuses a comment that is never closed instead of swallowing the definition', () => {
    expect(refusal('<p>a<!-- note</p>')).toBe('an HTML comment is never closed')
  })

  it('refuses a doctype and a processing instruction', () => {
    expect(refusal('<!doctype html><p>a</p>')).toContain('doctype')
    expect(refusal('<?xml version="1.0"?><p>a</p>')).toContain('processing instruction')
  })

  it('lists elements in document order', () => {
    const nodes = tree('<div><p><span>a</span></p><em>b</em></div>')
    expect(elements(nodes).map(element => element.tag)).toEqual(['div', 'p', 'span', 'em'])
  })

  it('parses a deeply nested fragment without overflowing its own stack', () => {
    const depth = 5_000
    const html = `${'<div>'.repeat(depth)}x${'</div>'.repeat(depth)}`
    expect(elements(tree(html))).toHaveLength(depth)
  })
})
