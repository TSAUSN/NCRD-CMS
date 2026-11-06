import { describe, expect, it } from 'vitest'
import { referenceFieldSummary } from './migration.ts'
import { staticCompatibility } from './static-compatibility.ts'
import type { ReferencePage } from './reference-pages.ts'
import { cohesiveCopy } from './fixtures/cohesive-copy.ts'

function section(html: string): ReferencePage['sections'][number] {
  return {
    ...staticCompatibility({ slug: 'synthetic-source', html, css: '' }),
    key: 'synthetic-source',
    appliedFields: 0,
  }
}

describe('migration editable-field inventory', () => {
  it('reports field cohesion and additive link-policy notes without leaking source copy', () => {
    const result = referenceFieldSummary({ sections: [section(cohesiveCopy.html)] })
    expect(result).toEqual({
      editableFields: 2,
      richTextFields: 1,
      fieldMappingIssues: ['richtext-link-policy-applied'],
    })
    expect(JSON.stringify(result)).not.toContain('Community support')
    expect(JSON.stringify(result)).not.toContain('hello@example.test')
  })

  it('deduplicates source mapping limitations and skips refused references', () => {
    const image = '<picture><img data-editable="image" src="/photo.png" alt="Photo"></picture>'
    const result = referenceFieldSummary({ sections: [section(image), section(image), section('<form></form>')] })
    expect(result).toEqual({
      editableFields: 0,
      richTextFields: 0,
      fieldMappingIssues: ['responsive-image-field-mapping-required'],
    })
  })

  it('counts inline source copy as one inline rich-text field', () => {
    const inline = '<p data-editable="richtext">Read <strong>the guidance</strong>.</p>'
    const result = referenceFieldSummary({ sections: [section(inline), section(inline)] })
    expect(result).toEqual({ editableFields: 2, richTextFields: 2, fieldMappingIssues: [] })
    expect(JSON.stringify(result)).not.toContain('the guidance')
  })

  it('reports rich-text copy inside a link once', () => {
    const linked = '<a href="/x" data-editable="richtext">Read <strong>the guidance</strong>.</a>'
    const result = referenceFieldSummary({ sections: [section(linked), section(linked)] })
    expect(result.fieldMappingIssues).toEqual(['inline-richtext-field-mapping-required'])
  })

  it('counts governed structured fields without passing them through the legacy mapper', () => {
    const structured = {
      ...section('<form></form>'),
      structuredDoc: {
        schemaVersion: 2 as const,
        fields: [
          { name: 'body', type: 'richtext' as const, label: 'Body' },
          { name: 'title', type: 'text' as const, label: 'Title' },
        ],
        nodes: [],
      },
    }
    expect(referenceFieldSummary({ sections: [structured] })).toEqual({
      editableFields: 2,
      richTextFields: 1,
      fieldMappingIssues: [],
    })
  })
})
