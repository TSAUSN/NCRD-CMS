import { expect, it } from 'vitest'
import { hasTrustedSectionTemplate, pinnedSectionCatalog, sectionVersionKey } from './section-version.ts'

it('keeps old and new versions of the same definition independently editable', () => {
  const old = { section_def_id: 'hero', version: 1, slots: ['old-heading'] }
  const latest = { section_def_id: 'hero', version: 2, slots: ['new-heading'] }
  const catalog = pinnedSectionCatalog([latest], [old])
  expect(catalog.get(sectionVersionKey('hero', 1))?.slots).toEqual(['old-heading'])
  expect(catalog.get(sectionVersionKey('hero', 2))?.slots).toEqual(['new-heading'])
})

it('retains known metadata for an undo that restores an older version', () => {
  const old = { section_def_id: 'hero', version: 1 }
  const known = pinnedSectionCatalog([old], [old])
  const next = pinnedSectionCatalog([{ ...old, version: 2 }], [], known)
  expect(next.has(sectionVersionKey('hero', 1))).toBe(true)
})
it('shows code approval for the pinned template, not an unrelated newer version', () => {
  const catalog = pinnedSectionCatalog(
    [
      { section_def_id: 'hero', version: 1, carries_trusted_code: true },
      { section_def_id: 'hero', version: 2, carries_trusted_code: false },
    ],
    [],
  )
  expect(hasTrustedSectionTemplate([{ section_def_id: 'hero', section_def_version: 1 }], catalog)).toBe(true)
  expect(hasTrustedSectionTemplate([{ section_def_id: 'hero', section_def_version: 2 }], catalog)).toBe(false)
  expect(hasTrustedSectionTemplate([], catalog)).toBe(false)
})
