import { describe, it, expect } from 'vitest'
import { EMPTY_SITE_FILE_BUNDLE, SiteFileBundle, SiteNativeAlias, nativeAliasPaths } from './site-files.ts'
const file = '11111111-1111-4111-a111-111111111111'
describe('reviewed file bundle contract', () => {
  it('preserves script order, position and exact page scope, including an empty removal version', () => {
    expect(SiteFileBundle.parse(EMPTY_SITE_FILE_BUNDLE)).toEqual(EMPTY_SITE_FILE_BUNDLE)
    const bundle = {
      version: 1,
      files: [file],
      scripts: [
        { fileId: file, position: 'head', loading: 'normal', pages: [] },
        { fileId: file, position: 'body-end', loading: 'defer', pages: [file] },
      ],
      styles: [],
    }
    expect(SiteFileBundle.parse(bundle)).toEqual(bundle)
  })
  it('refuses arbitrary fields, inline script, foreign file references and duplicate page choices', () => {
    for (const input of [
      { ...EMPTY_SITE_FILE_BUNDLE, inline: 'bad()' },
      { ...EMPTY_SITE_FILE_BUNDLE, files: [file, file] },
      { ...EMPTY_SITE_FILE_BUNDLE, scripts: [{ fileId: file, position: 'head', loading: 'normal', pages: [] }] },
      {
        ...EMPTY_SITE_FILE_BUNDLE,
        files: [file],
        scripts: [{ fileId: file, position: 'head', loading: 'normal', pages: [file, file] }],
      },
    ])
      expect(SiteFileBundle.safeParse(input).success).toBe(false)
  })
})

describe('reviewed native resource aliases', () => {
  const media = {
    kind: 'media' as const,
    sourceId: file,
    mediaId: '22222222-2222-4222-a222-222222222222',
    variants: ['original', 'wide'] as ('original' | 'wide')[],
  }
  const asset = { kind: 'asset' as const, sourceId: file, assetId: media.mediaId }
  it('preserves closed native identities and derives only canonical own-address shapes', () => {
    const bundle = { ...EMPTY_SITE_FILE_BUNDLE, native: [media, asset] }
    expect(SiteFileBundle.parse(bundle)).toEqual(bundle)
    expect(nativeAliasPaths(media)).toEqual([`/media/${file}/original`, `/media/${file}/wide`])
    expect(nativeAliasPaths(asset)).toEqual([`/assets/${file}`])
  })
  it('refuses arbitrary paths, origins, storage selectors, wrong targets and undeclared image sizes', () => {
    for (const alias of [
      { ...media, path: '/api/private' },
      { ...asset, origin: 'https://other.test' },
      { ...asset, objectKey: 'private/key' },
      { ...asset, mediaId: media.mediaId },
      { ...media, mediaId: 'not-a-resource' },
      { ...media, variants: ['original', 'huge'] },
      { ...media, variants: [] },
      { ...media, variants: ['wide', 'wide'] },
    ])
      expect(SiteNativeAlias.safeParse(alias).success).toBe(false)
  })
  it('refuses ambiguous duplicate original identities while allowing the two separate native namespaces', () => {
    expect(SiteFileBundle.safeParse({ ...EMPTY_SITE_FILE_BUNDLE, native: [media, media] }).success).toBe(false)
    expect(SiteFileBundle.safeParse({ ...EMPTY_SITE_FILE_BUNDLE, native: [media, asset] }).success).toBe(true)
    const mixed = { ...media, sourceId: 'abcdefab-cdef-4abc-aabc-abcdefabcdef' }
    expect(
      SiteFileBundle.safeParse({
        ...EMPTY_SITE_FILE_BUNDLE,
        native: [mixed, { ...mixed, sourceId: mixed.sourceId.toUpperCase() }],
      }).success,
    ).toBe(false)
  })
})
