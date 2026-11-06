import { describe, expect, it } from 'vitest'
import { collectionReviewRichText } from './collection-review-richtext.ts'

describe('collection review rich-text evidence', () => {
  it('keeps formatting and exposes destinations without creating navigation', () => {
    const html = collectionReviewRichText(
      '<p>Read <a href="/about"><strong>about us</strong></a> or <a href="https://example.org/?a=1&amp;b=2">the source</a>.</p>',
    )
    expect(html).toContain('<span><strong>about us</strong></span>')
    expect(html).toContain('<code>/about</code>')
    expect(html).toContain('<code>https://example.org/?a=1&amp;b=2</code>')
    expect(html).not.toMatch(/<a\b|\bhref=/)
  })
  it('never decodes escaped markup or permits active source through destination annotations', () => {
    const html = collectionReviewRichText(
      '<a href="/about?title=&quot;&gt;&lt;img%20src=x&gt;" onclick="bad()"><em>Label</em></a><script>bad()</script>',
    )
    expect(html).toContain('<em>Label</em>')
    expect(html).not.toMatch(/<a\b|<img\b|<script\b|onclick=/)
    expect(collectionReviewRichText('<p><a>Unlinked text</a></p>')).toBe('<p><span>Unlinked text</span></p>')
  })
})
