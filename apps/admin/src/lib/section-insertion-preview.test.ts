import { expect, it, vi } from 'vitest'
import type { Queryable } from '@cms/platform'
import { compileSection, type RenderManifest } from '@cms/renderer'
import { sectionInsertionPreview } from './section-insertion-preview.ts'
const id = '10000000-0000-4000-8000-000000000001',
  manifest = {
    page: { id: 'page', title: 'Page', path: '/', version_id: 'v' },
    meta: {},
    sections: [],
  } as RenderManifest
it('composes an exact-version sample without a write and refuses invalid places and denied access', async () => {
  const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({
        rows: [
          {
            section_def_id: id,
            version: 2,
            name: 'Text',
            slots: [{ id: 'heading', label: 'Heading', kind: 'text', required: true }],
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ content: [] }] }),
    client = { query } as unknown as Queryable
  const result = await sectionInsertionPreview(client, manifest, 'site', id, 2, 0)
  expect(result?.sections).toHaveLength(1)
  expect(manifest.sections).toEqual([])
  expect(result?.sections[0]?.instance.section_def_version).toBe(2)
  expect(query.mock.calls.every(call => String(call[0]).startsWith('SELECT'))).toBe(true)
  expect(await sectionInsertionPreview(client, manifest, 'site', id, 2, 1)).toBeNull()
  query.mockResolvedValueOnce({ rows: [{ allowed: false }] })
  expect(await sectionInsertionPreview(client, manifest, 'site', id, 2, 0)).toBeNull()
  expect(query).toHaveBeenCalledTimes(4)
})

it('keeps a list binding attached to its section after a temporary section shifts its position', async () => {
  const { withDraftListPreview } = await import('./draft-list-preview.ts'),
    fields = [{ key: 'name', label: 'Name', type: 'text', required: true }],
    query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'people-list',
            reader_key: 'people',
            schema_id: 'schema',
            revision: '1',
            entry_revision: '1',
            fields,
            settings: {},
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'person',
            stableKey: 'person',
            schemaVersionId: 'schema',
            values: { name: '[Name]' },
            fields,
            revision: '1',
            createdAt: '2026-11-01T00:00:00Z',
          },
        ],
      })
  const shifted: RenderManifest = {
    ...manifest,
    sections: [
      {
        def: {
          section_def_id: id,
          version: 1,
          compiled_ast: compileSection({ sourceHtml: '<p>Preview</p>', sourceCss: '', slots: [] }).ast,
          definition_kind: 'legacy',
          slots: [],
        },
        instance: { section_def_id: id, section_def_version: 1, values: { heading: '[New section]' } },
      },
      {
        def: {
          section_def_id: 'list',
          version: 1,
          compiled_ast: compileSection({ sourceHtml: '<p>Preview</p>', sourceCss: '', slots: [] }).ast,
          definition_kind: 'structured',
          slots: [{ id: 'people', kind: 'repeat', label: 'People', constraints: {} }],
        },
        instance: { section_def_id: 'list', section_def_version: 1, values: { people: {} } },
      },
    ],
  }
  const result = await withDraftListPreview({ query } as unknown as Queryable, shifted, 'v', 'site', [
    { values: { heading: '[New section]' } },
    { values: { people: { readerKey: 'people', selection: { mode: 'automatic', limit: 6 } } } },
  ])
  expect(result.sections[0]?.instance.values?.heading).toBe('[New section]')
  expect(result.sections[1]?.instance.values?.people).toMatchObject({
    kind: 'collection',
    readerKey: 'people',
    entries: [{ values: { name: '[Name]' } }],
  })
  expect(query.mock.calls[0]?.[1]).toEqual(['site', 'people'])
  expect(query).toHaveBeenCalledTimes(2)
})
