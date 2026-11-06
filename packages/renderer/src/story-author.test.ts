import { it, expect } from 'vitest'
import { renderStoryAuthor, renderStoryDetail } from './story-archive.ts'
const id = '00000000-0000-4000-8000-000000000001',
  list = (author: unknown) => ({
    kind: 'collection',
    collectionId: id,
    readerKey: 'stories',
    publishedSchemaVersionId: id,
    publishedSchemaRevision: '1',
    publishedEntryRevision: '1',
    schemas: [{ id, revision: '1', fields: [{ key: 'author', label: 'Author', type: 'text', required: false }] }],
    entries: [{ id, stableKey: 'story', schemaVersionId: id, values: { author } }],
  })
it('adds an optional escaped byline after the title and preserves absent-author articles byte for byte', () => {
  const html = '<article><h1>[Title]</h1><p>[Words]</p></article>'
  expect(renderStoryAuthor(html, list('[Name] <script>'))).toBe(
    '<article><h1>[Title]</h1><p class="core-story-author">By [Name] &lt;script&gt;</p><p>[Words]</p></article>',
  )
  expect(renderStoryAuthor(html, list(''))).toBe(html)
  expect(renderStoryAuthor(html, list('x'.repeat(121)))).toBe(html)
})

it('omits empty header tag marks while preserving populated tags and the article verbatim', () => {
  const article = '<div class="core-story-text"><p>Approved words.</p></div>',
    html =
      '<h1>Title</h1><div class="core-story-meta"><span>October 30</span><div class="core-story-sectors"><cms-slot> &nbsp; </cms-slot></div><span class="core-story-region-pill"> </span><span class="core-story-region-pill">Africa</span></div>' +
      article
  expect(renderStoryDetail(html)).toBe(
    '<h1>Title</h1><div class="core-story-meta"><span>October 30</span><span class="core-story-region-pill">Africa</span></div>' +
      article,
  )
})
it('shows a repeated summary once, comparing decoded words without changing body markup', () => {
  const article =
      '<div class="core-story-text"><p><strong>Hope &amp; help</strong> for families.</p><p>Other approved words.</p></div>',
    opening = '<p class="core-story-opening">Hope &amp; help for families.</p>'
  expect(renderStoryDetail(opening + article)).toBe(article)
  expect(renderStoryDetail(article)).toBe(article)
})
it('preserves a different introduction and does not remove a summary that only repeats a later paragraph', () => {
  const opening = '<p class="core-story-opening">Summary.</p>',
    article = '<div class="core-story-text"><p>First paragraph.</p><p>Summary.</p></div>'
  expect(renderStoryDetail(opening + article)).toBe(opening + article)
})

it('omits a summary repeated at the beginning of a longer opening paragraph, without matching a partial word', () => {
  const article = '<div class="core-story-text"><p>Opening sentence. More approved words.</p></div>'
  expect(renderStoryDetail('<p class="core-story-opening">Opening sentence.</p>' + article)).toBe(article)
  const partial = '<p class="core-story-opening">Open</p>' + article
  expect(renderStoryDetail(partial)).toBe(partial)
})
