import { it, expect } from 'vitest'
import { echelonChapterSetups, ECHELON_CHAPTER_SOURCES } from './echelon-chapters.ts'
it('keeps all 41 source identities and adds only the two requested neutral demo drafts', () => {
  const rows = echelonChapterSetups()
  expect(ECHELON_CHAPTER_SOURCES).toHaveLength(41)
  expect(rows.filter(row => !row.sample)).toHaveLength(41)
  expect(rows).toHaveLength(43)
  expect(new Set(rows.map(row => row.slug)).size).toBe(43)
  expect(rows.filter(row => row.sample).map(row => row.slug)).toEqual(['rebuilding-sample', 'maryland'])
  expect(JSON.stringify(rows)).not.toContain('link_status')
  for (const row of rows) {
    expect(row.config.pageId).toBeNull()
    expect(row.config.contact.name).toBe('[Name]')
    expect(row.config.contact.email).toMatch(/@example\.test$/)
  }
})
it('uses the requested chapter modes and optional parts without inventing a real external address', () => {
  const rows = echelonChapterSetups(),
    get = (slug: string) => rows.find(row => row.slug === slug)!.config
  expect(get('peoria').updateMode).toBe('chapter-editors')
  expect(get('indianapolis').updateMode).toBe('division')
  expect(get('north-texas')).toMatchObject({
    boardDisplay: 'first-eight',
    sections: { board: true, events: true, photos: true, memberLogin: true },
  })
  expect(get('boston')).toMatchObject({
    destination: 'page',
    externalUrl: null,
    sections: { socialFirst: true, board: false, events: false },
  })
  expect(get('detroit')).toMatchObject({
    destination: 'external',
    pageId: null,
    externalUrl: 'https://example.test/chapters/detroit',
  })
  expect(get('rebuilding-sample').destination).toBe('unlisted')
  expect(get('maryland').updateMode).toBe('chapter-editors')
})
