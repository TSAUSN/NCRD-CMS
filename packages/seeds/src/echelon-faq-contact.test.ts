import { it, expect } from 'vitest'
import { renderSection, CSS_POLICY_VERSION, type ManifestSection } from '@cms/renderer'
import { CORE_LIBRARY, compileCoreSection } from './core-library.ts'
import { echelonFaqContactContent } from './echelon-faq-contact.ts'
const defs = CORE_LIBRARY.map((entry, index) => ({
  id: String(index),
  version: 1,
  slug: entry.definition.slug,
  name: entry.definition.name,
  slots: compileCoreSection(entry).slots,
}))
it('keeps reviewed FAQ differences and contact copy as ordinary editable values, with native grouped details and the existing form contract', () => {
  const chapter = echelonFaqContactContent('chapter', defs),
    national = echelonFaqContactContent('national', defs)
  expect(chapter).toHaveLength(2)
  expect(chapter[0]!.values.questions__i1__answer).toBe(national[0]!.values.questions__i1__answer)
  expect(chapter[0]!.values.questions__i2__answer).toBe(national[0]!.values.questions__i2__answer)
  expect(national[0]!.values.questions__i3__question).toBe('Is there an Echelon chapter near me?')
  expect(chapter[1]!.values.level).toBe('Our chapter')
  expect(national[1]!.values.level).toBe('National')
  expect(national[1]!.values.benefits__i3__text).toBe('Find your local chapter')
  const html = chapter
    .map((instance, index) => {
      const entry = CORE_LIBRARY.find(
          item => item.definition.slug === defs.find(def => def.id === instance.section_def_id)!.slug,
        )!,
        compiled = compileCoreSection(entry),
        section: ManifestSection = {
          instance,
          def: {
            section_def_id: instance.section_def_id,
            version: 1,
            slug: entry.definition.slug,
            compiled_ast: compiled.compiledAst,
            slots: compiled.slots,
            css: compiled.compiledCss,
            css_policy_version: CSS_POLICY_VERSION,
          },
        }
      return renderSection(section, index, { siteThemeHooks: true })
    })
    .join('')
  expect(html.match(/name="echelon-faq"/g)).toHaveLength(4)
  expect(html).toContain('<label>Message<textarea name="comments"')
  expect(html).toContain('action="/__cms/contact" method="post"')
  expect(html.match(/ required/g)).toHaveLength(5)
  expect(html).not.toMatch(/raw_html|custom_css|<script|onclick=/)
})
