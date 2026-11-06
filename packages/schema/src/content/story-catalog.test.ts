import { it, expect } from 'vitest'
import { emptyStoriesSettings, StoryCatalog, storyCatalog } from './stories.ts'
const settings = {
  ...emptyStoriesSettings(),
  mainLabel: 'Programs',
  secondaryLabel: 'Areas',
  mainTags: [{ id: 'food', label: 'Food', keywords: ['private suggestion'] }],
  secondaryTags: [{ id: 'east', label: 'East', keywords: ['private place'], areas: ['asia' as const] }],
}
it('projects only ordered display fields and never shares keyword, source or policy data', () => {
  const catalog = storyCatalog(settings)
  expect(catalog).toEqual({
    mainLabel: 'Programs',
    secondaryLabel: 'Areas',
    mainTags: [{ id: 'food', label: 'Food' }],
    secondaryTags: [{ id: 'east', label: 'East', areas: ['asia'] }],
  })
  expect(StoryCatalog.parse(catalog)).toEqual(catalog)
  expect(storyCatalog({ ...settings, source: 'sawso' }).sectorPageLimit).toBe(6)
  expect(StoryCatalog.safeParse({ ...catalog, sectorPageLimit: 7 }).success).toBe(false)
  catalog.secondaryTags[0]!.areas.push('africa')
  expect(settings.secondaryTags[0]!.areas).toEqual(['asia'])
})
it('refuses extra/private properties, duplicates, excessive lists and unknown map areas', () => {
  const catalog = storyCatalog(settings)
  for (const value of [
    { ...catalog, source: 'sawso' },
    { ...catalog, publishUnreviewed: true },
    { ...catalog, mainTags: [settings.mainTags[0]] },
    { ...catalog, mainTags: [catalog.mainTags[0], catalog.mainTags[0]] },
    { ...catalog, secondaryTags: [{ ...catalog.secondaryTags[0], areas: ['country'] }] },
    { ...catalog, secondaryTags: [{ ...catalog.secondaryTags[0], areas: ['asia', 'asia'] }] },
    { ...catalog, mainTags: Array.from({ length: 101 }, (_, i) => ({ id: 'tag-' + i, label: 'Tag' })) },
  ])
    expect(StoryCatalog.safeParse(value).success).toBe(false)
})
