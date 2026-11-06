import { expect, it } from 'vitest'
import { matchesSectionSearch, symphonySectionNames } from './section-library-search.ts'
it('finds the existing hero by its approved Symphony name without matching unrelated sections', () => {
  const hero = { slug: 'core-feature-slider', name: 'Hero slider', category: 'Hero' }
  expect(matchesSectionSearch(hero, ' Theater Space ')).toBe(true)
  expect(matchesSectionSearch({ slug: 'core-text-block', name: 'Text', category: 'Content' }, 'Theater Space')).toBe(
    false,
  )
  expect(symphonySectionNames(hero.slug)).toEqual(['Theater Space'])
})
