import { it, expect, vi, afterEach } from 'vitest'
import { compileSection, type RenderManifest } from '@cms/renderer'
import { publicPageResponse } from './public-page.ts'
import type { ResolvedRoute } from './routing.ts'
vi.mock('./routing.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('./routing.ts')>()),
  siteRoutes: async () => [],
}))
afterEach(() => vi.useRealTimers())
it('changes the public entity tag when a frozen story feed ages out, with no release or JavaScript', async () => {
  const id = (n: number) => '00000000-0000-4000-a000-' + String(n).padStart(12, '0'),
    slot = {
      id: 'stories',
      kind: 'repeat' as const,
      label: 'Stories',
      constraints: {
        collection: true,
        storyFeed: true,
        item: { unit: 'Story', fields: [{ id: 'title', kind: 'text', label: 'Title' }] },
      },
    },
    compiled = compileSection({
      sourceHtml: '<div>{{#stories}}<article><h2>{{title}}</h2></article>{{/stories}}</div>',
      slots: [slot],
    })
  const manifest: RenderManifest = {
    page: { id: id(1), version_id: id(2), title: '[Feed]', path: '/' },
    meta: {},
    sections: [
      {
        def: { section_def_id: id(3), version: 1, slug: 'core-stories', compiled_ast: compiled.ast, slots: [slot] },
        instance: {
          section_def_id: id(3),
          section_def_version: 1,
          values: {
            stories: {
              kind: 'collection',
              collectionId: id(4),
              readerKey: 'stories',
              publishedSchemaVersionId: id(5),
              publishedSchemaRevision: '1',
              publishedEntryRevision: '1',
              schemas: [
                {
                  id: id(5),
                  revision: '1',
                  fields: [
                    { key: 'title', label: 'Title', type: 'text', required: true },
                    { key: 'published_date', label: 'Date', type: 'date', required: true },
                  ],
                },
              ],
              entries: [
                {
                  id: id(6),
                  stableKey: 'boundary',
                  schemaVersionId: id(5),
                  values: { title: '[Boundary story]', published_date: '2025-09-30' },
                },
              ],
            },
          },
        },
      },
    ],
  }
  const route: ResolvedRoute = {
      siteId: id(7),
      path: '/',
      pageId: id(1),
      pageVersionId: id(2),
      manifest,
      shell: {
        site: { id: id(7), name: '[Site]', slug: 'stories' },
        theme: {},
        navigation: [],
        canonical_host: 'stories.example.test',
        staging_host: null,
      },
      shellRevision: 1,
      isStaging: false,
      canonicalHost: 'stories.example.test',
      redirectTo: null,
      updatedAt: new Date('2026-10-01'),
    },
    before = structuredClone(route.manifest),
    request = (etag?: string) =>
      new Request('https://stories.example.test/', {
        headers: { host: 'stories.example.test', ...(etag ? { 'if-none-match': etag } : {}) },
      })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T23:59:59Z'))
  const first = await publicPageResponse(request(), route),
    etag = first.headers.get('etag')!
  expect(await first.text()).toContain('[Boundary story]')
  expect(first.headers.get('cache-control')).toContain('must-revalidate')
  vi.setSystemTime(new Date('2026-11-01T00:00:00Z'))
  const changed = await publicPageResponse(request(etag), route)
  expect(changed.status).toBe(200)
  expect(changed.headers.get('etag')).not.toBe(etag)
  expect(await changed.text()).not.toContain('[Boundary story]')
  expect((await publicPageResponse(request(changed.headers.get('etag')!), route)).status).toBe(304)
  expect(route.manifest).toEqual(before)
})
