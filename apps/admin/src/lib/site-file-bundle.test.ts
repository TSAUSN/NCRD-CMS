import { describe, it, expect } from 'vitest'
import { EMPTY_SITE_FILE_BUNDLE, type SiteFileView } from '@cms/schema'
import {
  addReviewedFile,
  removeReviewedFile,
  removeOriginalLayouts,
  describeFileLoading,
  fileMoveTarget,
} from './site-file-bundle.ts'
const first = '11111111-1111-4111-a111-111111111111',
  second = '22222222-2222-4222-a222-222222222222',
  page = '33333333-3333-4333-a333-333333333333'
const file = (id: string, kind: SiteFileView['kind'] = 'script'): SiteFileView => ({
  id,
  kind,
  name: kind === 'stylesheet' ? 'style.css' : 'site.js',
  sha256: 'a'.repeat(64),
  bytes: 100,
  source: 'local:site.js',
})
describe('reviewed site file choices', () => {
  it('replaces exact file identity while preserving original order, position and chosen pages without mutating history', () => {
    const original = {
      ...EMPTY_SITE_FILE_BUNDLE,
      files: [first],
      scripts: [{ fileId: first, position: 'head' as const, loading: 'defer' as const, pages: [page] }],
    }
    const next = addReviewedFile(original, file(second), first)
    expect(next.files).toEqual([second])
    expect(next.scripts).toEqual([{ ...original.scripts[0], fileId: second }])
    expect(original.files).toEqual([first])
    expect(original.scripts[0]!.fileId).toBe(first)
  })
  it('moves original resource addresses to the replacement while keeping immutable checksum aliases on their original bytes', () => {
    const canonical = `/site-files/${first}/${'a'.repeat(64)}/site.js`,
      original = {
        ...EMPTY_SITE_FILE_BUNDLE,
        files: [first],
        scripts: [{ fileId: first, position: 'head' as const, loading: 'normal' as const, pages: [] }],
        paths: [
          { path: '/js/original.js', fileId: first },
          { path: canonical, fileId: first },
        ],
      }
    expect(addReviewedFile(original, file(first), first)).toEqual(original)
    const changed = { ...file(second), sha256: 'b'.repeat(64) },
      next = addReviewedFile(original, changed, first)
    expect(next.files).toEqual([second, first])
    expect(next.scripts[0]!.fileId).toBe(second)
    expect(next.paths).toEqual([
      { path: '/js/original.js', fileId: second },
      { path: canonical, fileId: first },
    ])
    expect(original.paths[0]!.fileId).toBe(first)
    const removed = removeReviewedFile(next, first)
    expect(removed.files).toEqual([second])
    expect(removed.paths).toEqual([{ path: '/js/original.js', fileId: second }])
    expect(next.paths).toHaveLength(2)
  })
  it('adds sensible loaded defaults, refuses impossible replacements and removes all uses only from the new choices', () => {
    const bundle = addReviewedFile(EMPTY_SITE_FILE_BUNDLE, file(first))
    expect(bundle.scripts).toEqual([{ fileId: first, position: 'body-end', loading: 'normal', pages: [] }])
    const styled = addReviewedFile(bundle, file(second, 'stylesheet'))
    expect(styled.styles).toEqual([{ fileId: second, pages: [] }])
    expect(() => addReviewedFile(bundle, file(second, 'stylesheet'), first)).toThrow('Replace a script with a script')
    expect(() => addReviewedFile(bundle, file(second), page)).toThrow('no longer')
    expect(removeReviewedFile(styled, first)).toEqual({ ...styled, files: [second], scripts: [] })
    expect(bundle.files).toEqual([first])
  })
  it('reviews chosen-page scope, order and position in plain words for both scripts and styles', () => {
    const bundle = addReviewedFile(EMPTY_SITE_FILE_BUNDLE, file(first))
    bundle.scripts[0]!.pages = [page]
    expect(describeFileLoading(bundle, first, [{ id: page, title: 'Speakers' }])).toBe(
      'After page content · in order · Speakers',
    )
    const styled = addReviewedFile(bundle, file(second, 'stylesheet'))
    styled.styles[0]!.pages = [page]
    expect(describeFileLoading(styled, second, [{ id: page, title: 'Speakers' }])).toBe(
      'Stylesheet in page head · Speakers',
    )
  })
})

it('offers only order moves that change execution within the same position', () => {
  const bundle = addReviewedFile(addReviewedFile(EMPTY_SITE_FILE_BUNDLE, file(first)), file(second))
  bundle.scripts[0]!.position = 'head'
  expect(fileMoveTarget(bundle, 'scripts', 0, 1)).toBe(-1)
  expect(fileMoveTarget(bundle, 'scripts', 1, -1)).toBe(-1)
  bundle.scripts[0]!.position = 'body-end'
  expect(fileMoveTarget(bundle, 'scripts', 0, 1)).toBe(1)
  expect(fileMoveTarget(bundle, 'scripts', 1, -1)).toBe(0)
})

it('describes future-page scope explicitly and removes it with original layouts without changing history', () => {
  const original = {
    ...EMPTY_SITE_FILE_BUNDLE,
    files: [first, second],
    scripts: [
      { fileId: first, position: 'body-end' as const, loading: 'normal' as const, pages: [page], newPages: true },
    ],
    styles: [{ fileId: second, pages: [page], newPages: true }],
    original: {
      version: 1 as const,
      definitions: [],
      pages: [],
      newPages: { html: { lang: 'en' }, body: {}, header: true, footer: true },
    },
  }
  expect(describeFileLoading(original, first, [{ id: page, title: 'Home' }])).toContain(
    'Home · also new pages using the reviewed original layout',
  )
  expect(describeFileLoading(original, second, [{ id: page, title: 'Home' }])).toContain(
    'Stylesheet in page head · Home · also new pages',
  )
  const removed = removeOriginalLayouts(original)
  expect(removed.original).toBeUndefined()
  expect(removed.scripts).toEqual([{ fileId: first, position: 'body-end', loading: 'normal', pages: [page] }])
  expect(removed.styles).toEqual([{ fileId: second, pages: [page] }])
  expect(original.scripts[0]!.newPages).toBe(true)
  expect(original.original.newPages.header).toBe(true)
})
