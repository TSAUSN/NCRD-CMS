import { afterEach, describe, expect, it, vi } from 'vitest'
import { canvasRichTextNode, patchCanvasRichText } from './canvas-rich-text.tsx'

/** `inline`: the node sits inside a paragraph; `linked`: inside a link. */
function fixture({ active = false, inline = false, linked = false, origin = 'https://cms.test' } = {}) {
  const node = {
    innerHTML: '<p>Original</p>',
    hasAttribute: () => active,
    closest: (selector: string) => (linked || (inline && selector.split(',').includes('p')) ? {} : null),
  }
  const querySelectorAll = vi.fn(() => [node])
  const frame = {
    contentWindow: { location: { origin } },
    contentDocument: { querySelectorAll },
  } as unknown as HTMLIFrameElement
  vi.stubGlobal('window', { location: { origin: 'https://cms.test' } })
  return { node, frame, querySelectorAll }
}
afterEach(() => vi.unstubAllGlobals())

describe('governed rich-text canvas patches', () => {
  it('uses the public sanitizer before inserting passive content and has no second HTML policy', () => {
    const { node, frame } = fixture()
    expect(
      patchCanvasRichText(
        frame,
        0,
        'body',
        '<p onclick="bad()">Safe <em>text</em><img src=x onerror=bad()><a href="javascript:bad()">link</a></p>',
      ),
    ).toBe(true)
    expect(node.innerHTML).toBe('<p>Safe <em>text</em><a href="#" rel="noopener nofollow">link</a></p>')
  })
  it('lets the active structured editor reconcile its model without replacing its DOM/caret', () => {
    const { node, frame } = fixture({ active: true })
    expect(patchCanvasRichText(frame, 1, 'body', '<p>After undo</p>')).toBe(true)
    expect(node.innerHTML).toBe('<p>Original</p>')
  })
  it('refuses foreign frames, inline boundaries and selector injection', () => {
    expect(canvasRichTextNode(fixture({ origin: 'https://foreign.test' }).frame, 0, 'body')).toBe(null)
    expect(canvasRichTextNode(fixture({ inline: true }).frame, 0, 'body')).toBe(null)
    const { frame, querySelectorAll } = fixture()
    for (const [section, slot] of [
      [-1, 'body'],
      [0.5, 'body'],
      [0, 'body"] [onclick="x'],
    ] as const)
      expect(canvasRichTextNode(frame, section, slot)).toBe(null)
    expect(querySelectorAll).not.toHaveBeenCalled()
  })
  it('patches every occurrence but mounts the exact clicked occurrence', () => {
    const { frame, querySelectorAll, node } = fixture()
    const second = { ...node }
    querySelectorAll.mockReturnValue([node, second])
    expect(canvasRichTextNode(frame, 0, 'body', 1)).toBe(second)
    expect(patchCanvasRichText(frame, 0, 'body', '<p>Shared value</p>')).toBe(true)
    expect(node.innerHTML).toBe('<p>Shared value</p>')
    expect(second.innerHTML).toBe('<p>Shared value</p>')
  })
  it('draws the field’s definition-owned block presentation exactly as the page renders it, and drops a tampered one', () => {
    const { node, frame } = fixture()
    const blocks = { p: { class: 'text-sa-dark leading-relaxed', style: 'font-family: var(--font-secondary);' } }
    expect(
      patchCanvasRichText(frame, 0, 'body', '<p>One</p><p>Two <em>more</em></p>', { blockAttributes: blocks }),
    ).toBe(true)
    expect(node.innerHTML).toBe(
      '<p class="text-sa-dark leading-relaxed" style="font-family: var(--font-secondary);">One</p>' +
        '<p class="text-sa-dark leading-relaxed" style="font-family: var(--font-secondary);">Two <em>more</em></p>',
    )
    expect(
      patchCanvasRichText(frame, 0, 'body', '<p>One</p>', {
        blockAttributes: { p: { style: 'background:url(//evil.test/x)' } },
      }),
    ).toBe(true)
    expect(node.innerHTML).toBe('<p>One</p>')
  })
  it('lets an inline field live inside a paragraph, drawing words and its marks only, but never inside a link', () => {
    const constraints = { inline: true, inlineAttributes: { em: { class: 'red' } } }
    const { node, frame } = fixture({ inline: true })
    expect(canvasRichTextNode(frame, 0, 'subtitle', 0, constraints)).toBe(node)
    expect(patchCanvasRichText(frame, 0, 'subtitle', '<p>Discover</p><p><em>more</em></p>', constraints)).toBe(true)
    expect(node.innerHTML).toBe('Discover<br><em class="red">more</em>')
    expect(canvasRichTextNode(fixture({ linked: true }).frame, 0, 'subtitle', 0, constraints)).toBe(null)
  })
  it('asks for canonical rendering when a declared slot has no live node', () => {
    const { frame, querySelectorAll } = fixture()
    querySelectorAll.mockReturnValue([])
    expect(patchCanvasRichText(frame, 0, 'body', '<p>Changed</p>')).toBe(false)
  })
})
