import { it, expect } from 'vitest'
import { echelonSiteSetup } from './echelon-site.ts'
import { coreTemplateContent } from './core-templates.ts'
import { CORE_LIBRARY, compileCoreSection } from './core-library.ts'
import { ECHELON_PUBLIC_COPY } from './echelon-content.ts'
it('composes the separate national home and finder from shared sections, without national events', () => {
  const setup = echelonSiteSetup()
  expect(setup.name).toBe('Echelon chapters')
  expect(setup.header.brand.siteName).toBe('Echelon')
  expect(setup.pages.map(page => [page.slug, page.template])).toEqual([
    ['', 'echelon-home'],
    ['chapters', 'chapter-finder'],
  ])
  const defs = CORE_LIBRARY.map((entry, index) => ({
    id: String(index),
    version: 1,
    name: entry.definition.name,
    slug: entry.definition.slug,
    slots: compileCoreSection(entry).slots,
  }))
  const home = coreTemplateContent('echelon-home', defs, setup.name),
    names = home.map(section => defs.find(def => def.id === section.section_def_id)!.slug)
  expect(names).toEqual([
    'core-split-hero',
    'core-chapter-search',
    'core-text-block',
    'core-icon-cards',
    'core-team-grid',
    'core-image-link-cards',
    'core-faq',
    'core-contact-form',
  ])
  expect(names).not.toContain('core-schedule')
  expect(home[0]!.values.intro).toBe(ECHELON_PUBLIC_COPY.mission)
  expect(home[0]!.appearance?.surface).toBe('primary')
  expect(home[7]!.values.__cms_anchor).toBe('contact')
  expect(JSON.stringify(home)).not.toMatch(/Jordan Lee|Maya Patel|Share the story behind/)
})
