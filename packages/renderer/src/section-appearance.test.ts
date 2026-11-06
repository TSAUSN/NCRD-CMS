import { expect, it } from 'vitest'
import { SectionAppearance } from '@cms/schema'
import { SEED_SECTION_DEFS, seedSectionDefView } from '../../seeds/src/index.ts'
import { collectCss, renderSection } from './render.ts'
import { sectionAppearanceCss, sectionAppearanceSupport } from './section-appearance.ts'

const hero = seedSectionDefView(SEED_SECTION_DEFS.find(def => def.slug === 'hero')!)
const instance = {
  section_def_id: hero.section_def_id,
  section_def_version: hero.version,
  values: { heading: 'Heading', intro: 'Introduction' },
}

it('retains exact rendering and CSS when appearance is absent or reset', () => {
  const original = { def: hero, instance }
  const reset = { def: hero, instance: { ...instance, appearance: {} } }
  expect(renderSection(reset, 0)).toBe(renderSection(original, 0))
  expect(collectCss([reset])).toBe(collectCss([original]))
  expect(sectionAppearanceCss(hero, undefined, 0)).toBe('')
})

it('supports ordinary starter containers and refuses imported/code or conflicting-colour templates', () => {
  for (const slug of ['hero', 'prose', 'feature'])
    expect(
      sectionAppearanceSupport(seedSectionDefView(SEED_SECTION_DEFS.find(def => def.slug === slug)!)),
    ).toMatchObject({ layout: true, surface: true })
  expect(sectionAppearanceSupport({ definition_kind: 'legacy' }).layout).toBe(false)
  expect(
    sectionAppearanceSupport({ ...hero, css: `${hero.css}.cms-section--hero .panel{background:#fff}` }),
  ).toMatchObject({ layout: true, surface: false })
  expect(sectionAppearanceSupport({ ...hero, css: `${hero.css}.cms-section--hero .label{color:red}` }).surface).toBe(
    false,
  )
})

it('emits bounded instance-specific responsive overrides without changing an adjacent section', () => {
  const appearance = { width: 'reading', spacing: 'compact', align: 'start', surface: 'primary' } as const
  const css = sectionAppearanceCss(hero, appearance, 3)
  expect(css).toContain('#s3>:only-child')
  expect(css).toContain('max-width:42rem!important')
  expect(css).toContain('padding-block:clamp(1rem,2vw,1.5rem)!important')
  expect(css).toContain('var(--color-primaryContrast,#ffffff)')
  expect(css).not.toContain('#s2')
  expect(css).not.toContain('@media')
})

it('refuses arbitrary style values and preserves the governed escape-hatch boundary', () => {
  for (const value of [{ width: '999rem' }, { surface: '#ff0000' }, { position: 'absolute' }, { spacing: null }]) {
    expect(SectionAppearance.safeParse(value).success).toBe(false)
    expect(sectionAppearanceCss(hero, value, 0)).toBe('')
  }
  const withCode = {
    def: hero,
    instance: { ...instance, raw_html: '<p>Approved code</p>', appearance: { width: 'reading' as const } },
  }
  expect(collectCss([withCode])).not.toContain('max-width:42rem!important')
})

it('uses themed dark backgrounds and limits desktop picture position to capable core sections', () => {
  const core = {
    slug: 'core-text-image',
    slots: [
      {
        kind: 'text',
        constraints: {
          coreLibrary: 'r8',
          coreCapabilities: { width: true, background: true, imagePosition: true, phoneOrder: true },
        },
      },
    ],
  }
  expect(sectionAppearanceSupport(core)).toMatchObject({ imagePosition: true, imageFirst: true })
  const css = sectionAppearanceCss(core, { imagePosition: 'right', surface: 'dark' }, 2)
  expect(css).toContain('@media(min-width:48em){#s2 .row{flex-direction:row-reverse!important}}')
  expect(css).toContain('--cms-appearance-bg:var(--color-ink)')
  expect(css).toContain('--cms-appearance-ink:var(--color-surface)')
  expect(sectionAppearanceCss(hero, { imagePosition: 'right' }, 0)).not.toContain('row-reverse')
  expect(SectionAppearance.safeParse({ imagePosition: 'floating' }).success).toBe(false)
})
