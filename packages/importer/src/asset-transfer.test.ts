import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MediaStore } from '../../platform/src/ports.ts'
import { canonical, digest } from './backup.ts'
import type { MigrationBundle } from './migration.ts'
import { remapSiteAssetReferences, remapSiteAssetValues, transferSiteAssets } from './asset-transfer.ts'
const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})
it('moves only frozen PDF bytes and rejects changed files or unstaged manifests before new writes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'asset-transfer-'))
  temporary.push(root)
  mkdirSync(join(root, 'tsa-humanneedsindex/public/files'), { recursive: true })
  const bytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n')
  const filename = join(root, 'tsa-humanneedsindex/public/files/report.pdf')
  writeFileSync(filename, bytes)
  const files = [
    { path: 'asset/tsa-humanneedsindex/public/files/report.pdf', bytes: bytes.length, sha256: digest(bytes) },
  ]
  const bundle = { files, manifestSha256: digest(canonical(files)) } as MigrationBundle
  let writes = 0
  const objects = new Map<string, Uint8Array>()
  const store: MediaStore = {
    get: async key => objects.get(key) ?? null,
    put: async (key, body, contentType) => {
      writes++
      objects.set(key, body)
      return { objectKey: key, bytes: body.length, contentType }
    },
    remove: async () => {},
    createSignedUpload: async () => {
      throw new Error('unused')
    },
  }
  const client = {
    query: async (sql: string) => ({
      rows: sql.includes('v1_import_runs') ? [{ bundle }] : sql.includes('is_super_admin') ? [{ allowed: true }] : [],
    }),
  }
  const invoke = (input = bundle) =>
    transferSiteAssets(
      client,
      input,
      '11111111-1111-4111-a111-111111111111',
      '22222222-2222-4222-a222-222222222222',
      'humanneedsindex',
      root,
      store,
    )
  const result = await invoke()
  expect(result.documents).toBe(1)
  expect(result.fonts).toBe(0)
  expect(result.unresolved).toHaveLength(7)
  expect(result.assets.get('/files/report.pdf')?.url).toMatch(/^\/assets\/[0-9a-f-]{36}$/)
  expect(writes).toBe(1)
  await expect(invoke({ ...bundle, manifestSha256: 'a'.repeat(64) })).rejects.toThrow('exact frozen staged')
  writeFileSync(filename, Buffer.from('%PDF-1.4 changed\n%%EOF'))
  await expect(invoke()).rejects.toThrow('changed after inventory')
  expect(writes).toBe(1)
})
it('remaps destinations and rich-text links while preserving unrelated edits and shapes', () => {
  const assetId = '11111111-1111-4111-a111-111111111111',
    url = `/assets/${assetId}`
  const assets = new Map([['/files/report.pdf', { assetId, url }]])
  const html = '<a class="report" href="/files/report.pdf#page=2"><svg><path d="M0 0"/></svg>Read report</a>'
  const mapped = remapSiteAssetReferences(html, ".image{background:url('/image.png')}", assets)
  expect(mapped.html).toBe(html.replace('/files/report.pdf', url))
  expect(mapped.css).toBe(".image{background:url('/image.png')}")
  const value = {
    title: 'An existing edit',
    image: { media_id: 'existing', alt: 'Existing alt' },
    link: { url: '/files/report.pdf', label: 'Edited label' },
    body: '<p><a href="/files/report.pdf">Edited caption</a></p>',
    plain: 'The document /files/report.pdf is mentioned here',
  }
  const result = remapSiteAssetValues(value, assets)
  expect(result.value).toEqual({
    ...value,
    link: { ...value.link, url },
    body: `<p><a href="${url}">Edited caption</a></p>`,
  })
  expect(result.assetIds).toEqual([assetId])
})
