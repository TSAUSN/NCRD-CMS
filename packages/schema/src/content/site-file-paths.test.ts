import { describe, it, expect } from 'vitest'
import { SiteFileBundle, SiteFilePath } from './site-files.ts'
const id = '11111111-1111-4111-a111-111111111111',
  other = '22222222-2222-4222-a222-222222222222'
describe('reviewed own-site file addresses', () => {
  it.each([
    '/css/styles-new.css',
    '/js/jquery.min.js',
    '/fonts/Open%20Sans.woff2',
    `/site-files/${id}/${'a'.repeat(64)}/old.js`,
  ])('accepts an exact original resource address: %s', path => {
    expect(SiteFilePath.parse(path)).toBe(path)
  })
  it.each([
    '',
    '/',
    '/about',
    '/js/',
    '/secret.php',
    '/index.html',
    '/js/%FF.js',
    'relative.js',
    'https://foreign.test/site.js',
    '//foreign.test/file.js',
    '/js/../secret.js',
    '/js/./file.js',
    '/js//file.js',
    '/js/file.js?code=1',
    '/js/file.js#code',
    '/js/%2E%2E/file.js',
    '/js/%2fother.js',
    '/js/%5cother.js',
    '/js/%00file.js',
    '/js/%0Afile.js',
    '/js/file%xx.js',
    '/js/file name.js',
    '/api/file.js',
    '/__cms/file.js',
    '/_next/file.js',
    '/internal/tls',
    '/health',
    '/robots.txt',
    '/sitemap.xml',
  ])('refuses non-resource or ambiguous addresses: %s', path => {
    expect(SiteFilePath.safeParse(path).success).toBe(false)
  })
  it('retains old bundles verbatim and binds each unique address to a file in this reviewed version', () => {
    const original = { version: 1, files: [id], scripts: [], styles: [] }
    expect(SiteFileBundle.parse(original)).toEqual(original)
    const paths = [{ path: '/js/original.js', fileId: id }]
    expect(SiteFileBundle.parse({ ...original, paths })).toEqual({ ...original, paths })
    expect(SiteFileBundle.safeParse({ ...original, paths: [...paths, ...paths] }).success).toBe(false)
    expect(SiteFileBundle.safeParse({ ...original, paths: [{ path: '/js/foreign.js', fileId: other }] }).success).toBe(
      false,
    )
    expect(
      SiteFileBundle.safeParse({
        ...original,
        paths: [{ path: '/js/original.js', fileId: id, objectKey: 'private/path' }],
      }).success,
    ).toBe(false)
  })
})
