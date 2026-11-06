import { it, expect } from 'vitest'
import { siteImagePreviews, picturePreviewUrl } from './site-image-previews.ts'
const file = {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'image',
    name: 'logo.png',
    source: 'local:logo.png',
    bytes: 20,
    sha256: 'a'.repeat(64),
  },
  versionId = '22222222-2222-4222-8222-222222222222'
const projection = () => ({
  versionId,
  files: [file],
  bundle: {
    version: 1,
    files: [file.id],
    scripts: [],
    styles: [],
    paths: [{ path: '/images/logo.png', fileId: file.id }],
  },
})
it('maps only reviewed images to immutable authenticated addresses and refuses inconsistent projections', () => {
  const result = siteImagePreviews(projection())
  expect(result).toEqual({ '/images/logo.png': '/site-files/' + file.id + '/' + file.sha256 + '/logo.png' })
  expect(siteImagePreviews({ ...projection(), files: [] })).toEqual({})
  expect(siteImagePreviews({ ...projection(), files: [{ ...file, kind: 'script' }] })).toEqual({})
  expect(siteImagePreviews({ ...projection(), files: [file, file] })).toEqual({})
  expect(picturePreviewUrl('/images/logo.png', result, true)).toBe(result['/images/logo.png'])
  expect(picturePreviewUrl('/images/missing.png', result, true)).toBeNull()
  expect(picturePreviewUrl('/media/' + file.id + '/original', result, true)).toBe('/media/' + file.id + '/original')
  expect(picturePreviewUrl('/other.png', {}, false)).toBe('/other.png')
  expect(picturePreviewUrl('javascript:run()', {}, false)).toBe('#')
})
it('remaps only approved native media aliases and sizes', () => {
  const value = projection(),
    mediaId = '33333333-3333-4333-8333-333333333333'
  const bundle = { ...value.bundle, native: [{ kind: 'media', sourceId: file.id, mediaId, variants: ['original'] }] }
  const result = siteImagePreviews({ ...value, bundle })
  expect(result['/media/' + file.id + '/original']).toBe('/media/' + mediaId + '/original')
  expect(result['/media/' + file.id + '/wide']).toBeUndefined()
})
