import { describe, expect, it } from 'vitest'
import { starterDefinitions, starterSiteSetup } from '@cms/seeds/archetypes'
import { seedSectionDefView } from '@cms/seeds'
import { renderSection } from '@cms/renderer'
import { StructuredDocument } from '@cms/schema'
import { definitionPreviewValues } from './definition-preview.ts'
import { compileDefinitionDraft } from './definition-compiler.ts'

describe('collection starter preview values', () => {
  it.each(['resource', 'event'] as const)('renders every %s starter with valid preview-only collection URLs', kind => {
    for (const source of starterDefinitions(starterSiteSetup(kind))) {
      const definition = seedSectionDefView(source)
      if (source.kind === 'structured') {
        // The creator and archive restore recompile through this additional
        // application boundary, not merely the renderer's seed compiler.
        expect(
          compileDefinitionDraft({
            slug: source.slug,
            name: source.name,
            category: source.category,
            sourceHtml: '',
            sourceCss: source.sourceCss,
            slots: [],
            changelog: '',
            scope: 'site',
            siteId: 'preview',
            definitionKind: 'structured',
            placement: 'page',
            structuredDoc: definition.structured_doc,
          }).blocking,
          source.slug,
        ).toEqual([])
      }
      const values = definitionPreviewValues(
        [...definition.slots!],
        definition.structured_doc ? StructuredDocument.parse(definition.structured_doc) : null,
      )
      const html = renderSection(
        { def: definition, instance: { section_def_id: definition.section_def_id, section_def_version: 1, values } },
        0,
      )
      expect(html, source.slug).not.toBe('')
      if (source.slug === 'resources-listing' || source.slug === 'program-listing') {
        expect(html).toContain('href="https://example.test/resource"')
        expect(html).toContain('listing-card')
      }
    }
  })
})
