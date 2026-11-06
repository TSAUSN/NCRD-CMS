import { it, expect } from 'vitest'
import { renderSection, CSS_POLICY_VERSION, type ManifestSection } from '@cms/renderer'
import { CORE_LIBRARY, compileCoreSection } from './core-library.ts'
import { echelonBoardContactsContent } from './echelon-board-contacts.ts'
const defs = CORE_LIBRARY.map((entry, index) => ({
  id: String(index),
  version: 1,
  slug: entry.definition.slug,
  name: entry.definition.name,
  slots: compileCoreSection(entry).slots,
}))
it('keeps reviewed contact placeholders tracked and all board cards in native disclosure with empty/public and editor states', () => {
  const content = echelonBoardContactsContent(defs),
    contact = content[0]!,
    board = content[1]!
  expect(contact.values.name).toBe('[Membership chair name]')
  expect(contact.values.email).toBe('<p>[Chapter email address]</p>')
  expect(contact.values.__cms_sample_fields).toEqual(['name', 'email'])
  const entry = CORE_LIBRARY.find(item => item.definition.slug === 'core-echelon-board')!,
    compiled = compileCoreSection(entry),
    placed: ManifestSection = {
      instance: board,
      def: {
        section_def_id: board.section_def_id,
        version: 1,
        slug: entry.definition.slug,
        compiled_ast: compiled.compiledAst,
        slots: compiled.slots,
        css: compiled.compiledCss,
        css_policy_version: CSS_POLICY_VERSION,
      },
    }
  board.values.cards = { items: Array.from({ length: 16 }, (_, n) => 'i' + (n + 1)) }
  for (let n = 1; n <= 16; n++) {
    board.values['cards__i' + n + '__name'] = '[Name ' + n + ']'
    board.values['cards__i' + n + '__role'] = '[Role]'
    board.values['cards__i' + n + '__photo'] = ''
  }
  const html = renderSection(placed, 0)
  expect(html.match(/class="ech-board-person"/g)).toHaveLength(16)
  expect(html).toContain('Show all 16 board members')
  expect(html).not.toContain('raw_html')
  board.values.cards = { items: [] }
  expect(renderSection(placed, 0)).toBe('')
  expect(renderSection(placed, 0, { preview: true })).toContain('This list is empty. Add a board member')
})
