import { describe, expect, it } from 'vitest'
import { CollectionModel, SiteSetup, parseCollectionEntryValues } from '@cms/schema'
import { renderSection, stripPreviewInstrumentation } from '@cms/renderer'
import { compileSeedSection, seedSectionDefView } from './index.ts'
import { starterBodyHtml, starterCollections, starterDefinitions, starterSiteSetup } from './archetypes.ts'

describe('site starters', () => {
  it('supplies typed program sessions and resource documents/images without designing fields', () => {
    const resource = starterCollections(starterSiteSetup('resource'))[0]!
    const program = starterCollections(starterSiteSetup('event')).find(
      collection => collection.readerKey === 'program',
    )!
    expect(resource.model.fields.map(field => [field.key, field.type])).toEqual([
      ['title', 'text'],
      ['category', 'text'],
      ['summary', 'richtext'],
      ['thumbnail', 'image'],
      ['resource_url', 'url'],
    ])
    expect(program.model.fields.find(field => field.key === 'date')).toMatchObject({ type: 'date', required: true })
    expect(program.model.fields.map(field => field.key)).toEqual([
      'title',
      'date',
      'time',
      'location',
      'speakers',
      'category',
      'summary',
      'session_url',
    ])
    expect(
      parseCollectionEntryValues(program.model.fields, { title: 'Opening', date: '2026-02-30', time: '10 AM ET' }).ok,
    ).toBe(false)
    expect(
      parseCollectionEntryValues(resource.model.fields, { title: 'Report', resource_url: 'javascript:alert(1)' }).ok,
    ).toBe(false)
  })
  it.each(['resources', 'program'] as const)(
    'renders the %s starter with complete collection content and preview/public agreement',
    kind => {
      const setup = starterSiteSetup(kind === 'resources' ? 'resource' : 'event')
      const collection = starterCollections(setup).find(item => item.readerKey === kind)!
      const definition = starterDefinitions(setup).find(item => item.slug === `${kind}-listing`)!
      const values =
        kind === 'resources'
          ? {
              title: 'Community report',
              category: 'Research',
              summary: '<p>A <strong>useful</strong> guide.</p>',
              thumbnail: {
                src: '/media/11111111-1111-4111-8111-111111111111/wide',
                alt: 'Community volunteers',
                decorative: false,
              },
              resource_url: 'https://example.test/report.pdf?year=2026&source=library#page=2',
            }
          : {
              title: 'Opening session',
              date: '2026-10-02',
              time: '10:30–11:15 AM ET',
              location: 'Main hall',
              speakers: 'Morgan Example',
              category: 'Community',
              summary: '<p>Welcome and discussion.</p>',
              session_url: 'https://example.test/session?track=1&day=2',
            }
      const parsed = parseCollectionEntryValues(collection.model.fields, values)
      expect(parsed.ok).toBe(true)
      const schemaId = '22222222-2222-4222-8222-222222222222'
      const section = {
        def: seedSectionDefView(definition),
        instance: {
          section_def_id: '33333333-3333-4333-8333-333333333333',
          section_def_version: 1,
          label: '',
          hidden: false,
          hidden_at: [],
          values: {
            heading: 'Example collection',
            [kind]: {
              kind: 'collection',
              collectionId: '44444444-4444-4444-8444-444444444444',
              readerKey: kind,
              publishedSchemaVersionId: schemaId,
              publishedSchemaRevision: '1',
              publishedEntryRevision: '1',
              schemas: [{ id: schemaId, revision: '1', fields: collection.model.fields }],
              entries: [
                {
                  id: '55555555-5555-4555-8555-555555555555',
                  stableKey: 'example',
                  schemaVersionId: schemaId,
                  values: parsed.ok ? parsed.values : {},
                },
              ],
            },
          },
        },
      }
      const html = renderSection(section, 0)
      expect(html).toContain(values.title)
      expect(html).toContain(kind === 'resources' ? 'Open resource</a>' : 'Session information</a>')
      expect(html).toContain(kind === 'resources' ? 'Community volunteers' : '10:30–11:15 AM ET')
      expect(stripPreviewInstrumentation(renderSection(section, 0, { preview: true }))).toBe(html)
    },
  )
  it.each(['resource', 'event'] as const)('%s setup round-trips without changing its page plan', kind => {
    const setup = SiteSetup.parse({ ...starterSiteSetup(kind), name: 'Example site', slug: 'example-site' })
    expect(SiteSetup.parse(JSON.parse(JSON.stringify(setup)))).toEqual(setup)
    expect(setup.pages.filter(page => page.slug === '')).toHaveLength(1)
    for (const collection of starterCollections(setup))
      expect(CollectionModel.safeParse(collection.model).success).toBe(true)
  })
  it.each(['resource', 'event'] as const)('%s definitions compile through the production policy', kind => {
    const setup = SiteSetup.parse({ ...starterSiteSetup(kind), name: 'Example', slug: 'example' })
    for (const definition of starterDefinitions(setup)) {
      const compiled = compileSeedSection(definition)
      expect(compiled.problems, definition.slug).toEqual([])
      expect(compiled.carriesTrustedCode).toBe(false)
      const local = compileSeedSection({ ...definition, slug: `starter-example-${definition.slug}` })
      expect(local.problems, definition.slug).toEqual([])
    }
  })
  it('refuses duplicate routes and a missing home page', () => {
    const setup = { ...starterSiteSetup('resource'), name: 'Example', slug: 'example' }
    expect(SiteSetup.safeParse({ ...setup, pages: [setup.pages[0], setup.pages[0]] }).success).toBe(false)
    expect(SiteSetup.safeParse({ ...setup, pages: setup.pages.slice(1) }).success).toBe(false)
  })
  it('does not bring another site’s page or media IDs into a setup import', () => {
    const setup = { ...starterSiteSetup('resource'), name: 'Example', slug: 'example' }
    setup.header.brand.logoMediaId = '00000000-0000-4000-8000-000000000001'
    expect(SiteSetup.safeParse(setup).success).toBe(false)
  })
  it('treats wizard text as text, including pasted markup', () => {
    expect(starterBodyHtml('<script>alert(1)</script>\n\nSecond paragraph')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><p>Second paragraph</p>',
    )
  })
})
