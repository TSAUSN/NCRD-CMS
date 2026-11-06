import { describe, expect, it } from 'vitest'
import { STRUCTURED_SCHEMA_VERSION, type StructuredDocument } from '@cms/schema'
import { stripPreviewInstrumentation } from './preview-runtime.ts'
import { renderStructuredBody, type StructuredDefView } from './structured.ts'

const document: StructuredDocument = {
  schemaVersion: STRUCTURED_SCHEMA_VERSION,
  fields: [{ name: 'speakers', type: 'repeat', label: 'Speakers' }],
  nodes: [
    {
      type: 'repeat',
      field: 'speakers',
      empty: { behavior: 'message', text: 'No speakers yet.' },
      item: [
        {
          type: 'element',
          tag: 'article',
          attributes: { class: 'speaker' },
          children: [
            { type: 'element', tag: 'h3', children: [{ type: 'text', field: 'name' }] },
            { type: 'element', tag: 'div', children: [{ type: 'richtext', field: 'bio' }] },
          ],
        },
      ],
    },
  ],
}
const def: StructuredDefView = {
  definition_kind: 'structured',
  structured_schema_version: STRUCTURED_SCHEMA_VERSION,
  structured_doc: document,
}
const schemaId = '22222222-2222-4222-8222-222222222222'
const payload = (entries: { id: string; stableKey: string; values: Record<string, unknown> }[]) => ({
  kind: 'collection',
  collectionId: '11111111-1111-4111-8111-111111111111',
  readerKey: 'speakers',
  publishedSchemaVersionId: schemaId,
  publishedSchemaRevision: '1',
  publishedEntryRevision: '4',
  schemas: [
    {
      id: schemaId,
      revision: '1',
      fields: [
        { key: 'name', label: 'Name', required: true, type: 'text' },
        { key: 'bio', label: 'Bio', required: false, type: 'richtext' },
      ],
    },
  ],
  entries: entries.map(entry => ({ ...entry, schemaVersionId: schemaId })),
})

describe('structured repeat rendering', () => {
  it('shows a repair prompt for an incomplete private selection, even when empty collections normally hide', () => {
    const placeholder = {
      kind: 'collection',
      collectionId: '00000000-0000-4000-8000-000000000000',
      readerKey: 'cms_unconfigured',
      publishedSchemaVersionId: '00000000-0000-4000-8000-000000000000',
      publishedSchemaRevision: '0',
      publishedEntryRevision: '0',
      schemas: [],
      entries: [],
    }
    const hidden = {
      ...def,
      structured_doc: { ...document, nodes: [{ ...document.nodes[0]!, empty: { behavior: 'hide' } }] },
    }
    for (const definition of [def, hidden]) {
      const body = renderStructuredBody(definition, { speakers: placeholder })!
      expect(body).toContain('Choose a list in Content to finish this section.')
      expect(body).toContain('role="status"')
      expect(body).not.toContain('No speakers yet.')
    }
    expect(renderStructuredBody(def, { speakers: { ...placeholder, unexpected: 'refused' } })).toBeNull()
  })
  const linkDefinition = {
    ...def,
    structured_doc: {
      ...document,
      nodes: [
        {
          type: 'repeat',
          field: 'speakers',
          empty: { behavior: 'hide' },
          item: [
            {
              type: 'link',
              field: 'resource_url',
              staticAttributes: { target: '_blank', class: ['resource-link'] },
            },
          ],
        },
      ],
    },
  }
  function linkPayload(url: string, label = 'Open resource') {
    return {
      ...payload([]),
      schemas: [
        {
          id: schemaId,
          revision: '1',
          fields: [
            {
              key: 'resource_url',
              label,
              type: 'url',
              required: false,
            },
          ],
        },
      ],
      entries: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          stableKey: 'report',
          schemaVersionId: schemaId,
          values: { resource_url: url },
        },
      ],
    }
  }
  it('adapts collection URL strings to safely labeled links without mutating persisted values', () => {
    const collection = linkPayload('https://example.test/report.pdf?year=2026&format=pdf#page=2', 'Open <report>')
    const before = structuredClone(collection)
    const values = { speakers: collection }
    expect(renderStructuredBody(linkDefinition, values)).toBe(
      '<a href="https://example.test/report.pdf?year=2026&amp;format=pdf#page=2" class="resource-link" rel="noopener" target="_blank">Open &lt;report&gt;</a>',
    )
    expect(collection).toEqual(before)
    expect(stripPreviewInstrumentation(renderStructuredBody(linkDefinition, values, { preview: true })!)).toBe(
      renderStructuredBody(linkDefinition, values),
    )
  })
  it('keeps optional empty links absent and rejects dangerous URL values before rendering', () => {
    expect(renderStructuredBody(linkDefinition, { speakers: linkPayload('') })).toBe('')
    expect(
      renderStructuredBody(linkDefinition, { speakers: linkPayload('/assets/11111111-1111-4111-8111-111111111111') }),
    ).toContain('href="/assets/')
    for (const url of ['javascript:alert(1)', '//evil.test/a', 'https://owner:password@example.test/a', '/bad\\path']) {
      expect(renderStructuredBody(linkDefinition, { speakers: linkPayload(url) })).toBeNull()
    }
  })
  it('renders ordered entries with the existing text and rich-text policies', () => {
    const body = renderStructuredBody(def, {
      speakers: payload([
        {
          id: '33333333-3333-4333-8333-333333333333',
          stableKey: 'ada',
          values: { name: '<Ada>', bio: '<p>First <strong>bio</strong><script>x</script></p>' },
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          stableKey: 'grace',
          values: { name: 'Grace', bio: '<p>Second</p>' },
        },
      ]),
    })
    expect(body).toContain('&lt;Ada&gt;')
    expect(body).not.toContain('<script>')
    expect(body!.indexOf('&lt;Ada&gt;')).toBeLessThan(body!.indexOf('Grace'))
  })

  it('has explicit and safe empty output', () => {
    expect(renderStructuredBody(def, { speakers: payload([]) })).toBe(
      '<p class="cms-repeat-empty">No speakers yet.</p>',
    )
    const hidden = structuredClone(document)
    const repeat = hidden.nodes[0]!
    if (repeat.type === 'repeat') repeat.empty = { behavior: 'hide' }
    expect(renderStructuredBody({ ...def, structured_doc: hidden }, { speakers: payload([]) })).toBe('')
  })

  it('keeps preview layout content-identical after centralized instrumentation is stripped', () => {
    const values = {
      speakers: payload([
        { id: '33333333-3333-4333-8333-333333333333', stableKey: 'ada', values: { name: 'Ada', bio: '<p>Bio</p>' } },
      ]),
    }
    const publicBody = renderStructuredBody(def, values)!
    const previewBody = renderStructuredBody(def, values, { preview: true })!
    expect(previewBody).toContain('class="cms-repeat-preview"')
    expect(stripPreviewInstrumentation(previewBody)).toBe(publicBody)
  })

  it('fails closed on incompatible fields, extra manifest keys, and over-wide entries', () => {
    const badType = payload([
      { id: '33333333-3333-4333-8333-333333333333', stableKey: 'ada', values: { name: 'Ada', bio: 'x' } },
    ])
    badType.schemas[0]!.fields[0] = { key: 'name', label: 'Name', required: true, type: 'image' }
    expect(renderStructuredBody(def, { speakers: badType })).toBeNull()
    expect(renderStructuredBody(def, { speakers: { ...payload([]), surprise: true } })).toBeNull()
    const many = Array.from({ length: 201 }, (_, index) => ({
      id: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
      stableKey: `item-${index}`,
      values: { name: String(index), bio: '' },
    }))
    expect(renderStructuredBody(def, { speakers: payload(many) })).toBeNull()
  })
})
