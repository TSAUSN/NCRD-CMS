// The editor behaviours that carry v1's lessons. Every one of these was a
// defect in v1 that shipped, so each is asserted directly rather than assumed
// from the UI looking right.
import { describe, expect, it } from 'vitest'
import {
  addSection,
  canRedo,
  canUndo,
  carriesTrustedCode,
  changedSlots,
  commitBaseline,
  commitSaved,
  createEditorState,
  deepEqual,
  duplicateSection,
  hasChanges,
  isDirty,
  isSectionChanged,
  isSectionNew,
  isSlotChanged,
  moveSection,
  redo,
  removeSection,
  replaceSection,
  revertSection,
  revertSlot,
  setCustomCss,
  setMeta,
  setRawHtml,
  setSectionLabel,
  setSelection,
  setValue,
  SECTION_LABEL_MAX,
  TYPING_PAUSE_MS,
  toggleHidden,
  toggleHiddenAt,
  type EditorDocument,
  undo,
} from './editing.ts'

const doc = (): EditorDocument => ({
  sections: [
    { section_def_id: 'hero', section_def_version: 1, values: { heading: 'Hello', intro: 'World' }, label: 'Hero' },
    { section_def_id: 'cta', section_def_version: 1, values: { heading: 'Act' }, label: 'CTA' },
  ],
  meta: { title: 'Home', description: 'A page.' },
})

describe('dirty tracking is a value diff, never a presence check (v1 D2, D15, D16)', () => {
  it('a freshly loaded document is clean', () => {
    expect(isDirty(createEditorState(doc()))).toBe(false)
  })

  it('stays clean after a change is undone back to the original', () => {
    let state = createEditorState(doc())
    state = setValue(state, 0, 'heading', 'Changed')
    expect(isDirty(state)).toBe(true)
    state = undo(state)
    expect(isDirty(state)).toBe(false)
  })

  it('stays clean when a value is set to what it already was', () => {
    const state = setValue(createEditorState(doc()), 0, 'heading', 'Hello')
    expect(isDirty(state)).toBe(false)
    expect(canUndo(state)).toBe(false) // and it is not an undo step either
  })

  it('treats an absent value and an empty string as the same — an untouched field is not edited', () => {
    const base: EditorDocument = {
      sections: [{ section_def_id: 'hero', section_def_version: 1, values: { heading: 'Hi' } }],
      meta: {},
    }
    let state = createEditorState(base)
    state = setValue(state, 0, 'subtitle', '')
    expect(isSlotChanged(state, 0, 'subtitle')).toBe(false)
    expect(isDirty(state)).toBe(false)
  })

  it('an acknowledged save clears "unsaved", and nothing else', () => {
    let state = setValue(createEditorState(doc()), 0, 'heading', 'Saved')
    expect(isDirty(state)).toBe(true)
    state = commitSaved(state, state.document)
    expect(isDirty(state)).toBe(false)
  })

  it('an autosave does not erase the record of what changed this session', () => {
    // The bug this prevents: autosave fires, the blue dots vanish, and the
    // editor can no longer see or revert what they changed (v1 D15's lesson).
    let state = setValue(createEditorState(doc()), 0, 'heading', 'Saved')
    state = commitSaved(state, state.document)
    expect(isSlotChanged(state, 0, 'heading')).toBe(true)
    expect(hasChanges(state)).toBe(true)
    expect(changedSlots(state, 0)).toEqual(['heading'])
  })

  it('revert still works after an autosave', () => {
    let state = setValue(createEditorState(doc()), 0, 'heading', 'Saved')
    state = commitSaved(state, state.document)
    state = revertSlot(state, 0, 'heading')
    expect(state.document.sections[0]!.values['heading']).toBe('Hello')
    // Reverting past the last save is unsaved work again, correctly.
    expect(isDirty(state)).toBe(true)
    expect(isSlotChanged(state, 0, 'heading')).toBe(false)
  })

  it('reopening the page makes the current content the new origin', () => {
    let state = setValue(createEditorState(doc()), 0, 'heading', 'Saved')
    state = commitBaseline(state, state.document)
    expect(isDirty(state)).toBe(false)
    expect(hasChanges(state)).toBe(false)
    expect(isSlotChanged(state, 0, 'heading')).toBe(false)
  })
})

describe('changed dots mark exactly what changed', () => {
  it('marks the edited slot and no other', () => {
    const state = setValue(createEditorState(doc()), 0, 'heading', 'New')
    expect(isSlotChanged(state, 0, 'heading')).toBe(true)
    expect(isSlotChanged(state, 0, 'intro')).toBe(false)
    expect(isSectionChanged(state, 0)).toBe(true)
    expect(isSectionChanged(state, 1)).toBe(false)
  })

  it('lists the changed slots for the "Changed only" filter', () => {
    let state = setValue(createEditorState(doc()), 0, 'heading', 'New')
    state = setValue(state, 0, 'intro', 'Also new')
    expect(changedSlots(state, 0).sort()).toEqual(['heading', 'intro'])
    expect(changedSlots(state, 1)).toEqual([])
  })

  it('a newly added section is new, not a diff against something that never existed', () => {
    const state = addSection(createEditorState(doc()), { section_def_id: 'prose', section_def_version: 1, values: {} })
    expect(isSectionChanged(state, 2)).toBe(true)
  })
})

describe('per-field revert', () => {
  it('puts one slot back and leaves the others alone', () => {
    let state = setValue(createEditorState(doc()), 0, 'heading', 'New')
    state = setValue(state, 0, 'intro', 'Also new')
    state = revertSlot(state, 0, 'heading')

    expect(state.document.sections[0]!.values['heading']).toBe('Hello')
    expect(state.document.sections[0]!.values['intro']).toBe('Also new')
    expect(isSlotChanged(state, 0, 'heading')).toBe(false)
  })

  it('removes a slot that did not exist in the loaded version', () => {
    let state = setValue(createEditorState(doc()), 0, 'subtitle', 'Added')
    state = revertSlot(state, 0, 'subtitle')
    expect(state.document.sections[0]!.values).not.toHaveProperty('subtitle')
  })

  it('reverts a whole section', () => {
    let state = setValue(createEditorState(doc()), 0, 'heading', 'New')
    state = setValue(state, 0, 'intro', 'Also new')
    state = revertSection(state, 0)
    expect(isSectionChanged(state, 0)).toBe(false)
  })

  it('reverts the same section after it moves instead of the section now at that index', () => {
    let state = createEditorState(doc())
    state = moveSection(state, 0, 1)
    state = setValue(state, 1, 'heading', 'Moved and changed')
    state = revertSlot(state, 1, 'heading')
    expect(state.document.sections.map(section => section.section_def_id)).toEqual(['cta', 'hero'])
    expect(state.document.sections[1]!.values['heading']).toBe('Hello')
    expect(state.document.sections[0]!.values['heading']).toBe('Act')
  })

  it('keeps baseline identity when a new section is inserted before an existing one', () => {
    let state = createEditorState(doc())
    state = addSection(state, { section_def_id: 'new', section_def_version: 1, values: {} }, 0)
    state = setValue(state, 1, 'heading', 'Changed hero')
    state = revertSection(state, 1)
    expect(state.document.sections[1]!.section_def_id).toBe('hero')
    expect(state.document.sections[1]!.values['heading']).toBe('Hello')
    expect(isSectionNew(state, 0)).toBe(true)
  })
})

describe('undo and redo cover every edit operation, not just typing', () => {
  it('undoes a value change', () => {
    let state = setValue(createEditorState(doc()), 0, 'heading', 'New')
    state = undo(state)
    expect(state.document.sections[0]!.values['heading']).toBe('Hello')
  })

  it('undoes a section delete, restoring its content (SPEC §6.4)', () => {
    let state = removeSection(createEditorState(doc()), 0)
    expect(state.document.sections).toHaveLength(1)
    state = undo(state)
    expect(state.document.sections).toHaveLength(2)
    expect(state.document.sections[0]!.values['heading']).toBe('Hello')
  })

  it('undoes a reorder', () => {
    let state = moveSection(createEditorState(doc()), 0, 1)
    expect(state.document.sections.map(s => s.section_def_id)).toEqual(['cta', 'hero'])
    state = undo(state)
    expect(state.document.sections.map(s => s.section_def_id)).toEqual(['hero', 'cta'])
  })

  it('redoes what was undone', () => {
    let state = setValue(createEditorState(doc()), 0, 'heading', 'New')
    state = undo(state)
    expect(canRedo(state)).toBe(true)
    state = redo(state)
    expect(state.document.sections[0]!.values['heading']).toBe('New')
  })

  it('restores selection with a move through undo and redo', () => {
    let state = setSelection(createEditorState(doc()), { section: 0, slot: 'heading' })
    state = moveSection(state, 0, 1)
    expect(state.selection).toEqual({ section: 1, slot: 'heading' })
    state = undo(state)
    expect(state.selection).toEqual({ section: 0, slot: 'heading' })
    state = redo(state)
    expect(state.selection).toEqual({ section: 1, slot: 'heading' })
  })

  it('a new edit after an undo discards the redo branch', () => {
    let state = setValue(createEditorState(doc()), 0, 'heading', 'First')
    state = undo(state)
    state = setValue(state, 0, 'heading', 'Second')
    expect(canRedo(state)).toBe(false)
    expect(state.document.sections[0]!.values['heading']).toBe('Second')
  })

  it('does nothing when there is nothing to undo or redo', () => {
    const state = createEditorState(doc())
    expect(undo(state)).toBe(state)
    expect(redo(state)).toBe(state)
  })

  it('makes a burst of typing in one field a single undo step, as V1 did', () => {
    let state = createEditorState(doc())
    const original = state.document.sections[0]!.values['heading']
    for (const [index, text] of ['H', 'He', 'Hel', 'Hell', 'Hello'].entries())
      state = setValue(state, 0, 'heading', text, { at: 1_000 + index * 150 })
    expect(state.past).toHaveLength(1)
    state = undo(state)
    expect(state.document.sections[0]!.values['heading']).toBe(original)
    expect(canUndo(state)).toBe(false)
    expect(redo(state).document.sections[0]!.values['heading']).toBe('Hello')
  })

  it('starts a new step after a pause, in another field, or after an undo', () => {
    let state = setValue(createEditorState(doc()), 0, 'heading', 'One', { at: 1_000 })
    state = setValue(state, 0, 'heading', 'One two', { at: 1_000 + TYPING_PAUSE_MS + 1 })
    expect(state.past).toHaveLength(2)
    state = setValue(state, 0, 'intro', 'Elsewhere', { at: 2_100 })
    expect(state.past).toHaveLength(3)
    state = undo(state)
    state = setValue(state, 0, 'heading', 'One two three', { at: 2_200 })
    expect(state.past).toHaveLength(3)
    expect(undo(state).document.sections[0]!.values['heading']).toBe('One two')
    // A new burst (a click or a caret move on the canvas) is a new step.
    let bursts = setValue(createEditorState(doc()), 0, 'heading', 'A!', { at: 5_000, burst: 'canvas-1' })
    bursts = setValue(bursts, 0, 'heading', 'Start!', { at: 5_200, burst: 'canvas-2' })
    expect(undo(bursts).document.sections[0]!.values['heading']).toBe('A!')
    // Untimed changes stay one step each.
    const untimed = setValue(setValue(createEditorState(doc()), 0, 'heading', 'A'), 0, 'heading', 'AB')
    expect(untimed.past).toHaveLength(2)
  })

  it('caps history rather than growing without bound', () => {
    let state = createEditorState(doc())
    for (let i = 0; i < 250; i += 1) state = setValue(state, 0, 'heading', `v${i}`)
    expect(state.past.length).toBeLessThanOrEqual(100)
  })
})

describe('section operations', () => {
  it('inserts at a position, and appends when none is given', () => {
    const added = { section_def_id: 'prose', section_def_version: 1, values: {} }
    expect(addSection(createEditorState(doc()), added, 1).document.sections.map(s => s.section_def_id)).toEqual([
      'hero',
      'prose',
      'cta',
    ])
    expect(addSection(createEditorState(doc()), added).document.sections.map(s => s.section_def_id)).toEqual([
      'hero',
      'cta',
      'prose',
    ])
  })

  it('duplicates a section next to its original, with its content', () => {
    const state = duplicateSection(createEditorState(doc()), 0)
    expect(state.document.sections).toHaveLength(3)
    expect(state.document.sections[1]!.values['heading']).toBe('Hello')
    // A copy, not a shared reference.
    expect(state.document.sections[1]).not.toBe(state.document.sections[0])
  })

  it('clamps a move to the ends rather than losing the section', () => {
    const state = moveSection(createEditorState(doc()), 0, 99)
    expect(state.document.sections.map(s => s.section_def_id)).toEqual(['cta', 'hero'])
  })

  it('ignores a move of a section that is not there', () => {
    const state = createEditorState(doc())
    expect(moveSection(state, 9, 0)).toBe(state)
  })
})

describe('breakpoint visibility is a bounded control (SPEC §6.4, D5)', () => {
  it('hides and shows the whole section without deleting it', () => {
    let state = toggleHidden(createEditorState(doc()), 0)
    expect(state.document.sections[0]!.hidden).toBe(true)
    state = toggleHidden(state, 0)
    expect(state.document.sections[0]!.hidden).toBe(false)
    expect(state.document.sections).toHaveLength(2)
  })

  it('toggles a breakpoint on and back off', () => {
    let state = toggleHiddenAt(createEditorState(doc()), 0, 'sm')
    expect(state.document.sections[0]!.hidden_at).toEqual(['sm'])
    state = toggleHiddenAt(state, 0, 'sm')
    expect(state.document.sections[0]!.hidden_at).toEqual([])
  })

  it('is undoable like any other edit', () => {
    let state = toggleHiddenAt(createEditorState(doc()), 0, 'sm')
    state = undo(state)
    expect(state.document.sections[0]!.hidden_at ?? []).toEqual([])
  })
})

describe('metadata edits', () => {
  it('are tracked and undoable', () => {
    let state = setMeta(createEditorState(doc()), 'description', 'New description')
    expect(isDirty(state)).toBe(true)
    state = undo(state)
    expect(isDirty(state)).toBe(false)
  })
})

describe('deepEqual', () => {
  it.each([
    [{ a: 1 }, { a: 1 }, true],
    [{ a: 1 }, { a: 2 }, false],
    [{ a: [1, 2] }, { a: [1, 2] }, true],
    [{ a: [1, 2] }, { a: [2, 1] }, false],
    [{ a: '' }, {}, true],
    [{ a: null }, { a: '' }, true],
    [[1], { 0: 1 }, false],
  ])('compares %j and %j', (a, b, expected) => {
    expect(deepEqual(a, b)).toBe(expected)
  })
})

describe('the escape hatches', () => {
  const withSection = () =>
    createEditorState({
      sections: [{ section_def_id: 'd', section_def_version: 1, values: {} }],
      meta: {},
    })

  it('puts custom CSS on the undo stack like any other edit', () => {
    const typed = setCustomCss(withSection(), 0, '.x{color:red}')
    expect(typed.document.sections[0]!.custom_css).toBe('.x{color:red}')
    expect(canUndo(typed)).toBe(true)
    expect(undo(typed).document.sections[0]!.custom_css).toBeUndefined()
  })

  it('treats a cleared hatch as absent, so it stops marking the page', () => {
    const typed = setRawHtml(withSection(), 0, '<p>hello</p>')
    expect(carriesTrustedCode(typed.document)).toBe(true)
    const cleared = setRawHtml(typed, 0, '   ')
    expect(cleared.document.sections[0]).not.toHaveProperty('raw_html')
    expect(carriesTrustedCode(cleared.document)).toBe(false)
  })

  it('does not call a page trusted merely for having sections', () => {
    expect(carriesTrustedCode(withSection().document)).toBe(false)
  })

  it('leaves no changed-dot behind when a hatch is opened and cleared', () => {
    const state = withSection()
    const cleared = setCustomCss(setCustomCss(state, 0, '.x{color:red}'), 0, '')
    expect(isSectionChanged(cleared, 0)).toBe(false)
  })
})

describe('a section added this session', () => {
  it('has no original to revert a field to', () => {
    const state = addSection(createEditorState(doc()), {
      section_def_id: 'quote',
      section_def_version: 1,
      values: {},
    })
    expect(isSectionNew(state, 2)).toBe(true)
    expect(isSectionNew(state, 0)).toBe(false)
  })

  it('stops being new once the page is reopened on the published content', () => {
    const state = addSection(createEditorState(doc()), {
      section_def_id: 'quote',
      section_def_version: 1,
      values: {},
    })
    expect(isSectionNew(commitBaseline(state, state.document), 2)).toBe(false)
  })
})

describe('changing a section layout is one ordinary, undoable edit (SPEC §6.4)', () => {
  const feature = {
    section_def_id: 'feature',
    section_def_version: 3,
    values: { title: 'Hello' },
    label: 'Hero',
    hidden: true,
  }
  it('keeps the instance identity, other sections and the session baseline', () => {
    let state = setSelection(createEditorState(doc()), { section: 0, slot: 'intro' })
    const origins = state.sectionOrigins
    state = replaceSection(state, 0, feature)
    expect(state.document.sections[0]).toEqual(feature)
    expect(state.document.sections[1]).toEqual(doc().sections[1])
    expect(state.sectionOrigins).toEqual(origins)
    expect(state.selection).toEqual({ section: 0, slot: null })
    expect(isDirty(state)).toBe(true)
    expect(isSectionChanged(state, 0)).toBe(true)
    expect(isSectionChanged(state, 1)).toBe(false)
    expect(isSectionNew(state, 0)).toBe(false)
  })
  it('is reversed by Undo, Redo and the section revert without losing the old values', () => {
    let state = replaceSection(createEditorState(doc()), 0, feature)
    state = undo(state)
    expect(state.document).toEqual(doc())
    expect(isDirty(state)).toBe(false)
    state = redo(state)
    expect(state.document.sections[0]).toEqual(feature)
    state = revertSection(state, 0)
    expect(state.document.sections[0]).toEqual(doc().sections[0])
  })
  it('does nothing for a missing section or an identical replacement', () => {
    const state = createEditorState(doc())
    expect(replaceSection(state, 5, feature)).toBe(state)
    expect(replaceSection(state, 0, doc().sections[0]!)).toBe(state)
  })
})

describe('the private section label (SPEC §6.4, V1 reference 09)', () => {
  it('is an ordinary undoable edit of one section that keeps the selection on it', () => {
    let state = setSelection(createEditorState(doc()), { section: 1, slot: null })
    state = setSectionLabel(state, 1, 'Spring appeal call to action')
    expect(state.document.sections[1]!.label).toBe('Spring appeal call to action')
    expect(state.document.sections[0]!.label).toBe('Hero')
    expect(state.selection).toEqual({ section: 1, slot: null })
    expect(isDirty(state)).toBe(true)
    state = undo(state)
    expect(state.document.sections[1]!.label).toBe('CTA')
    expect(isDirty(state)).toBe(false)
    state = redo(state)
    expect(state.document.sections[1]!.label).toBe('Spring appeal call to action')
  })

  it('is bounded, and setting the same label is no step at all', () => {
    const long = setSectionLabel(createEditorState(doc()), 0, 'x'.repeat(SECTION_LABEL_MAX + 20))
    expect(long.document.sections[0]!.label).toHaveLength(SECTION_LABEL_MAX)
    const same = setSectionLabel(createEditorState(doc()), 0, 'Hero')
    expect(canUndo(same)).toBe(false)
    expect(setSectionLabel(createEditorState(doc()), 9, 'Nowhere').document).toEqual(doc())
  })
})

it('keeps copied anchors unique and bounded, with one undo step for duplicate', () => {
  const section = {
    section_def_id: 'hero',
    section_def_version: 1,
    values: { heading: 'A saved edit', __cms_anchor: 'a'.repeat(64) },
  }
  const initial = createEditorState({ sections: [section], meta: {} })
  const duplicated = duplicateSection(initial, 0)
  expect(duplicated.document.sections[1]!.values.__cms_anchor).toBe('a'.repeat(62) + '-2')
  expect(undo(duplicated).document).toEqual(initial.document)
  const inserted = addSection(duplicated, section)
  expect(inserted.document.sections[2]!.values.__cms_anchor).toBe('a'.repeat(62) + '-3')
})
