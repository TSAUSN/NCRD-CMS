import { expect, it } from 'vitest'
import { landmarkName, sourceSectionLabel } from './section-labels.ts'
import type { MigrationBundle } from './migration.ts'

const bundle = {
  records: [
    {
      key: 'backup/publishedPages/hni_home',
      payload: {
        sections: [
          { templateId: 'hero', label: 'Our community' },
          { templateId: 'hero' },
          { templateId: 'native:explore-data' },
          { templateId: 'missing' },
        ],
      },
    },
    { kind: 'section-definition', payload: { source: { id: 'hero', name: 'Hero — Freeform' } } },
  ],
} as unknown as MigrationBundle

it('preserves authored names before catalogue names, with readable native and missing-template fallbacks', () => {
  expect([0, 1, 2, 3].map(index => sourceSectionLabel(bundle, 'backup/publishedPages/hni_home', index))).toEqual([
    'Our community',
    'Hero — Freeform',
    'Explore data',
    'Section 4',
  ])
  expect(sourceSectionLabel(bundle, 'missing-record', 0)).toBe('Section 1')
})

it('names a source page’s own section after its landmark, as V1’s editor did, before falling back to a number', () => {
  const hero =
    '<div class="v1-reference-root"><section id="hero" class="hero" data-section="hero"><h1>{{title}}</h1></section></div>'
  expect(sourceSectionLabel(bundle, 'backup/publishedPages/hni_home', 3, hero)).toBe('Hero')
  expect(
    sourceSectionLabel(bundle, 'missing-record', 4, '<section id="agenda" data-section="timeline"></section>'),
  ).toBe('Agenda')
  expect(landmarkName('<section data-section-id="key-dates" id="dates"></section>')).toBe('Key dates')
  expect(landmarkName('<section class="plain"><h2>x</h2></section>')).toBe('')
  // An authored or catalogue name still wins.
  expect(sourceSectionLabel(bundle, 'backup/publishedPages/hni_home', 0, hero)).toBe('Our community')
  expect(sourceSectionLabel(bundle, 'missing-record', 1, '<p>no landmark</p>')).toBe('Section 2')
})
