import { it, expect } from 'vitest'
import { compileSeedSection } from './index.ts'
import { NATIONAL_HEADER, NATIONAL_FOOTER, NATIONAL_LIBRARY } from './national-library.ts'
it('compiles the official shield frame with governed navigation and code-owned search', () => {
  for (const def of [NATIONAL_HEADER, NATIONAL_FOOTER]) {
    const compiled = compileSeedSection(def)
    expect(compiled.problems).toEqual([])
    expect(compiled.carriesTrustedCode).toBe(false)
    expect(def.slots.find(slot => slot.id === 'logo')?.constraints?.sourceSample).toEqual({
      src: '/cms-themes/sawso/salvation-army-shield.svg',
      alt: 'The Salvation Army',
      decorative: false,
    })
    expect(def.sourceHtml).toContain('{{logo}}')
    expect(def.sourceHtml).not.toMatch(/https?:.*\.(?:png|jpg)/)
  }
  expect(NATIONAL_HEADER.slots).toContainEqual(expect.objectContaining({ kind: 'navigation' }))
  expect(NATIONAL_HEADER.sourceHtml).toContain('<details')
  expect(NATIONAL_FOOTER.slots).toContainEqual(expect.objectContaining({ constraints: { siteWidget: 'site-search' } }))
})

it('compiles the repeating hero and approved hover/focus media rules', () => {
  for (const item of NATIONAL_LIBRARY)
    expect(compileSeedSection(item.definition).problems, item.definition.slug).toEqual([])
  const hero = NATIONAL_LIBRARY.find(item => item.definition.slug === 'core-feature-slider')!
  if (hero.definition.kind !== 'legacy') throw new Error('Expected the shared hero template')
  expect(hero.definition.sourceHtml).toContain('{{#slides}}')
  expect(hero.definition.slots).toContainEqual(
    expect.objectContaining({ id: 'slides', constraints: expect.objectContaining({ heroSlides: true }) }),
  )
})

it('keeps new hero timing settings out of sample prose and opts the new definition into reviewed presentation', async () => {
  const { sectionStartingValues } = await import('@cms/schema'),
    hero = NATIONAL_LIBRARY.find(item => item.definition.slug === 'core-feature-slider')!
  if (hero.definition.kind !== 'legacy') throw new Error('Expected the shared hero template')
  const values = sectionStartingValues(hero.definition.slots)
  expect(values.auto_change).toBeUndefined()
  expect(values.seconds).toBeUndefined()
  expect(hero.definition.slots.find(slot => slot.id === 'slides')?.constraints.heroEditingParity).toBe(true)
})
