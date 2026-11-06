import { describe, expect, it } from 'vitest'
import {
  addSections,
  captureSectionInsertionPoint,
  createEditorState,
  moveSection,
  redo,
  removeSection,
  resolveSectionInsertionPoint,
  setValue,
  undo,
  type EditorDocument,
} from './editing.ts'

const document = (): EditorDocument => ({
  sections: [
    { section_def_id: 'one', section_def_version: 1, values: { heading: 'Original' } },
    { section_def_id: 'two', section_def_version: 1, values: {} },
  ],
  meta: { title: 'A page' },
})
describe('recipe insertion into a working draft', () => {
  it('preserves unsaved work and inserts independent instances in one undo step', () => {
    const dirty = setValue(createEditorState(document()), 0, 'heading', 'Unsaved typing')
    const recipe = [
      { section_def_id: 'recipe', section_def_version: 3, values: { image: { alt: 'Chosen sample' } } },
      { section_def_id: 'recipe', section_def_version: 3, values: { image: { alt: 'Second sample' } } },
    ]
    const inserted = addSections(dirty, recipe, 1)
    expect(inserted.document.sections).toHaveLength(4)
    expect(inserted.document.sections[0]!.values.heading).toBe('Unsaved typing')
    expect(new Set(inserted.sectionOrigins).size).toBe(4)
    expect(undo(inserted).document).toEqual(dirty.document)
    expect(redo(undo(inserted)).document).toEqual(inserted.document)
    recipe[0]!.values.image.alt = 'External mutation'
    expect(inserted.document.sections[1]!.values.image).toEqual({ alt: 'Chosen sample' })
  })
  it('tracks the chosen adjacent origins and refuses a moved, deleted or changed gap', () => {
    const initial = createEditorState(document())
    const gap = captureSectionInsertionPoint(initial, 1)
    expect(resolveSectionInsertionPoint(setValue(initial, 0, 'heading', 'Still safe'), gap)).toBe(1)
    expect(resolveSectionInsertionPoint(moveSection(initial, 0, 1), gap)).toBeNull()
    expect(resolveSectionInsertionPoint(removeSection(initial, 0), gap)).toBeNull()
    expect(resolveSectionInsertionPoint(addSections(initial, document().sections, 1), gap)).toBeNull()
  })
})
