// The editor's state model (SPEC §6.4), kept framework-independent so the
// behaviours that carry v1's lessons — changed-dots, per-field revert, undo,
// dirty tracking — are unit-testable without a browser.
//
// Two rules run through all of it:
//
//   * Changed means a value-diff against the loaded baseline, never a presence
//     check and never a timer (v1 D15/D16 were both presence checks).
//   * Undo is a command stack over whole documents, so an operation that moves
//     or removes a section is as undoable as typing a character (SPEC §6.4).

import {
  validSectionAnchor,
  clearSampleField,
  sampleFieldNames,
  SAMPLE_FIELDS_KEY,
  type SectionAppearance,
} from '@cms/schema'

export type SectionValues = Record<string, unknown>

export type EditorSection = {
  section_def_id: string
  section_def_version: number
  values: SectionValues
  hidden?: boolean
  hidden_at?: string[]
  label?: string
  custom_css?: string
  raw_html?: string
  appearance?: SectionAppearance
}

export type EditorMetadata = {
  title?: string
  description?: string
  canonical?: string
  social_image?: string
  noindex?: boolean
}

export type PageIdentity = { title: string; address: string }

export type EditorDocument = {
  /** Administrative identity, kept outside published SEO metadata. */
  identity?: PageIdentity
  sections: EditorSection[]
  meta: EditorMetadata
}

export type Selection = { section: number | null; slot: string | null }

type EditorHistory = {
  document: EditorDocument
  sectionOrigins: string[]
  selection: Selection
}

export type EditorState = {
  document: EditorDocument
  /**
   * What was loaded when the page opened. Changed-dots and per-field revert
   * are answered against this, and an autosave does not move it — "what have I
   * changed?" is a different question from "is there unsaved work?", and v1
   * kept them apart on purpose (D15).
   */
  baseline: EditorDocument
  /** What the server has acknowledged. Only this drives the saved indicator. */
  saved: EditorDocument
  /** Session-only identity for each current section; never written to page JSON. */
  sectionOrigins: string[]
  /** Identity of each loaded baseline section, used by changed/revert after moves. */
  baselineOrigins: string[]
  selection: Selection
  past: EditorHistory[]
  future: EditorHistory[]
  /** The field the last timed edit changed, so a burst of typing in it is one
   * undo step (V1 reference 05: one Undo restored the original heading). */
  lastEdit?: { key: string; at: number; burst?: string | undefined } | null
}

const MAX_HISTORY = 100
/** A pause in typing longer than this starts a new undo step. */
export const TYPING_PAUSE_MS = 1000
let originSequence = 0

function newOrigin(): string {
  originSequence += 1
  return `section-${originSequence}`
}

export function createEditorState(document: EditorDocument): EditorState {
  const origins = document.sections.map(() => newOrigin())
  return {
    document: clone(document),
    baseline: clone(document),
    saved: clone(document),
    sectionOrigins: origins,
    baselineOrigins: [...origins],
    selection: { section: null, slot: null },
    past: [],
    future: [],
  } satisfies EditorState
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** Deep value equality, which is what "changed" has to mean (v1 D2/D15/D16). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    // Treat an absent value and an empty string as the same thing: a field a
    // person never touched must not read as edited.
    return normalizeEmpty(a) === normalizeEmpty(b)
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aKeys = Object.keys(a as object).filter(k => !isEmpty((a as never)[k]))
  const bKeys = Object.keys(b as object).filter(k => !isEmpty((b as never)[k]))
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(key => deepEqual((a as never)[key], (b as never)[key]))
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function normalizeEmpty(value: unknown): unknown {
  return isEmpty(value) ? '' : value
}

// ------------------------------------------------------------- transitions

/** Apply a change, pushing the previous document onto the undo stack. */
export function apply(state: EditorState, change: (draft: EditorDocument, origins: string[]) => void): EditorState {
  const next = clone(state.document)
  const origins = [...state.sectionOrigins]
  const selectedOrigin =
    state.selection.section === null ? null : (state.sectionOrigins[state.selection.section] ?? null)
  change(next, origins)
  if (deepEqual(next, state.document) && deepEqual(origins, state.sectionOrigins)) return state

  const selectedIndex = selectedOrigin === null ? null : origins.indexOf(selectedOrigin)
  const selection =
    selectedIndex === -1 ? { section: null, slot: null } : { ...state.selection, section: selectedIndex }
  return {
    ...state,
    document: next,
    sectionOrigins: origins,
    selection,
    past: [...state.past, historyOf(state)].slice(-MAX_HISTORY),
    future: [],
    lastEdit: null,
  }
}

function historyOf(state: EditorState): EditorHistory {
  return {
    document: state.document,
    sectionOrigins: state.sectionOrigins,
    selection: state.selection,
  }
}

export function undo(state: EditorState): EditorState {
  const previous = state.past.at(-1)
  if (!previous) return state
  return {
    ...state,
    document: previous.document,
    sectionOrigins: previous.sectionOrigins,
    selection: previous.selection,
    past: state.past.slice(0, -1),
    future: [historyOf(state), ...state.future].slice(0, MAX_HISTORY),
    lastEdit: null,
  }
}

export function redo(state: EditorState): EditorState {
  const next = state.future[0]
  if (!next) return state
  return {
    ...state,
    document: next.document,
    sectionOrigins: next.sectionOrigins,
    selection: next.selection,
    past: [...state.past, historyOf(state)].slice(-MAX_HISTORY),
    future: state.future.slice(1),
    lastEdit: null,
  }
}

export const canUndo = (state: EditorState): boolean => state.past.length > 0
export const canRedo = (state: EditorState): boolean => state.future.length > 0

/**
 * Change one field. Given the time of the edit (`at`), consecutive edits to the
 * same field without a pause longer than TYPING_PAUSE_MS — and, when a `burst`
 * is given, within the same burst of typing — are one undo step, so Undo after
 * typing a phrase restores the field as it was before the phrase, not one
 * character. Without a time every change is its own step.
 */
export function setValue(
  state: EditorState,
  section: number,
  slot: string,
  value: unknown,
  options: { at?: number; burst?: string } = {},
): EditorState {
  const next = apply(state, draft => {
    const target = draft.sections[section]
    if (target) {
      const previous = target.values[slot]
      // Moving a crop does not replace the sample picture or its words.
      const focusOnly =
        previous &&
        value &&
        typeof previous === 'object' &&
        typeof value === 'object' &&
        !Array.isArray(previous) &&
        !Array.isArray(value) &&
        typeof (previous as Record<string, unknown>)['src'] === 'string' &&
        Object.hasOwn(value, 'focal') &&
        deepEqual({ ...previous, focal: null }, { ...value, focal: null })
      const values = { ...target.values, [slot]: value }
      target.values = focusOnly ? values : clearSampleField(values, slot)
    }
  })
  if (next === state || options.at === undefined) return next
  const key = `${state.sectionOrigins[section] ?? section}\u0000${slot}`
  const last = state.lastEdit
  const continues =
    !!last &&
    last.key === key &&
    last.burst === options.burst &&
    options.at >= last.at &&
    options.at - last.at <= TYPING_PAUSE_MS
  return { ...next, past: continues ? state.past : next.past, lastEdit: { key, at: options.at, burst: options.burst } }
}

/** A nested field editor can cancel without discarding unrelated draft work. */
export type FieldEditSnapshot = { present: boolean; value: unknown; sample: boolean }
export function captureFieldEdit(values: SectionValues, slot: string): FieldEditSnapshot {
  return {
    present: Object.hasOwn(values, slot),
    value: clone(values[slot]),
    sample: sampleFieldNames(values).includes(slot),
  }
}
export function cancelFieldEdit(
  state: EditorState,
  section: number,
  slot: string,
  snapshot: FieldEditSnapshot,
): EditorState {
  return apply(state, draft => {
    const target = draft.sections[section]
    if (!target) return
    if (snapshot.present) target.values[slot] = clone(snapshot.value)
    else delete target.values[slot]
    target.values = clearSampleField(target.values, slot)
    if (snapshot.sample) target.values[SAMPLE_FIELDS_KEY] = [...sampleFieldNames(target.values), slot]
  })
}

/**
 * Replace one section's values in one undo step. Adding, removing or moving a
 * repeated item changes its order and its own fields together (LIB-02), and
 * Undo has to put all of them back at once.
 */
export function setSectionValues(state: EditorState, section: number, values: SectionValues): EditorState {
  return apply(state, draft => {
    const target = draft.sections[section]
    if (target) {
      const fields = [
        ...new Set([
          ...sampleFieldNames(target.values).filter(
            key => JSON.stringify(target.values[key]) === JSON.stringify(values[key]),
          ),
          ...sampleFieldNames(values).filter(key => !Object.hasOwn(target.values, key)),
        ]),
      ]
      target.values = clone(values)
      if (fields.length) target.values[SAMPLE_FIELDS_KEY] = fields
      else delete target.values[SAMPLE_FIELDS_KEY]
    }
  })
}

/** The section's private name (SPEC §6.4): shown in the page structure and on
 * the canvas selection only, never in published output. */
export const SECTION_LABEL_MAX = 80
export function setSectionLabel(state: EditorState, section: number, label: string): EditorState {
  return apply(state, draft => {
    const target = draft.sections[section]
    if (target) target.label = label.slice(0, SECTION_LABEL_MAX)
  })
}

export function setSectionAppearance(state: EditorState, section: number, appearance: SectionAppearance): EditorState {
  return apply(state, draft => {
    const target = draft.sections[section]
    if (!target) return
    if (Object.keys(appearance).length === 0) delete target.appearance
    else target.appearance = { ...appearance }
  })
}

export function setMeta<K extends keyof EditorMetadata>(
  state: EditorState,
  key: K,
  value: EditorMetadata[K],
): EditorState {
  return apply(state, draft => {
    draft.meta = { ...draft.meta, [key]: value }
  })
}

/** Copied sections keep useful anchors without introducing duplicate page ids. */
function copyForInsertion(section: EditorSection, existing: readonly EditorSection[]): EditorSection {
  const next = clone(section),
    anchor = next.values.__cms_anchor
  delete next.values.__cms_anchor_aliases
  if (!validSectionAnchor(anchor)) return next
  const used = new Set(
    existing.flatMap(section => [
      section.values.__cms_anchor,
      ...(Array.isArray(section.values.__cms_anchor_aliases) ? section.values.__cms_anchor_aliases : []),
    ]),
  )
  let candidate = anchor,
    suffix = 1
  while (used.has(candidate)) {
    suffix += 1
    const ending = '-' + suffix
    candidate = anchor.slice(0, 64 - ending.length) + ending
  }
  next.values.__cms_anchor = candidate
  return next
}

export function addSection(state: EditorState, section: EditorSection, at?: number): EditorState {
  return apply(state, (draft, origins) => {
    const index = at === undefined ? draft.sections.length : Math.max(0, Math.min(at, draft.sections.length))
    draft.sections.splice(index, 0, copyForInsertion(section, draft.sections))
    origins.splice(index, 0, newOrigin())
  })
}

/** A recipe is one authoring command, regardless of its section count. */
export function addSections(state: EditorState, sections: readonly EditorSection[], at?: number): EditorState {
  if (sections.length === 0) return state
  return apply(state, (draft, origins) => {
    const index = at === undefined ? draft.sections.length : Math.max(0, Math.min(at, draft.sections.length))
    const added: EditorSection[] = []
    for (const section of sections) added.push(copyForInsertion(section, [...draft.sections, ...added]))
    draft.sections.splice(index, 0, ...added)
    origins.splice(index, 0, ...sections.map(() => newOrigin()))
  })
}

export type SectionInsertionPoint = { before: string | null; after: string | null }
export function captureSectionInsertionPoint(state: EditorState, at: number): SectionInsertionPoint {
  const index = Math.max(0, Math.min(at, state.sectionOrigins.length))
  return { before: state.sectionOrigins[index - 1] ?? null, after: state.sectionOrigins[index] ?? null }
}
/** Refuse an asynchronously validated insertion if its neighboring gap changed. */
export function resolveSectionInsertionPoint(state: EditorState, point: SectionInsertionPoint): number | null {
  const index = point.before === null ? 0 : state.sectionOrigins.indexOf(point.before) + 1
  if (point.before !== null && index === 0) return null
  return (state.sectionOrigins[index] ?? null) === point.after ? index : null
}

export function removeSection(state: EditorState, index: number): EditorState {
  return apply(state, (draft, origins) => {
    if (index < 0 || index >= draft.sections.length) return
    draft.sections.splice(index, 1)
    origins.splice(index, 1)
  })
}

export function duplicateSection(state: EditorState, index: number): EditorState {
  return apply(state, (draft, origins) => {
    const source = draft.sections[index]
    if (source) {
      draft.sections.splice(index + 1, 0, copyForInsertion(source, draft.sections))
      origins.splice(index + 1, 0, newOrigin())
    }
  })
}

export function moveSection(state: EditorState, from: number, to: number): EditorState {
  return apply(state, (draft, origins) => {
    if (from < 0 || from >= draft.sections.length) return
    const bounded = Math.max(0, Math.min(to, draft.sections.length - 1))
    const [moved] = draft.sections.splice(from, 1)
    const [movedOrigin] = origins.splice(from, 1)
    if (moved && movedOrigin) {
      draft.sections.splice(bounded, 0, moved)
      origins.splice(bounded, 0, movedOrigin)
    }
  })
}

/**
 * Change one section to a different layout (SPEC §6.4 “Change layout”).
 *
 * The replacement is the whole reviewed instance: the server decides which
 * values, label, visibility and appearance carry over. Keeping the section's
 * origin keeps its identity, so selection, changed markers and “Undo my
 * changes” still describe the same place on the page, and Undo restores the
 * previous layout with its values. A field selected in the old layout may not
 * exist in the new one, so the selection falls back to the section itself.
 */
export function replaceSection(state: EditorState, index: number, replacement: EditorSection): EditorState {
  const next = apply(state, draft => {
    if (draft.sections[index]) draft.sections[index] = clone(replacement)
  })
  return next !== state && next.selection.section === index
    ? { ...next, selection: { section: index, slot: null } }
    : next
}

export function toggleHidden(state: EditorState, index: number): EditorState {
  return apply(state, draft => {
    const target = draft.sections[index]
    if (target) target.hidden = !target.hidden
  })
}

export function toggleHiddenAt(state: EditorState, index: number, breakpoint: string): EditorState {
  return apply(state, draft => {
    const target = draft.sections[index]
    if (!target) return
    const current = target.hidden_at ?? []
    target.hidden_at = current.includes(breakpoint) ? current.filter(b => b !== breakpoint) : [...current, breakpoint]
  })
}

/**
 * The two escape hatches (SPEC §6.4), as ordinary transitions.
 *
 * Ordinary is the point. They go through `apply` like typing does, so they are
 * on the undo stack, they mark the document dirty, they are diffed against the
 * baseline for the changed-dot, and `planCanvasUpdate` sees a section that no
 * longer renders the way the canvas rendered it and asks for a fresh render.
 * Every one of those would have had to be remembered separately if these had
 * been given their own path, and forgetting one is how the canvas and the
 * document come to disagree with nobody able to see that they have.
 *
 * An empty string is stored as absent rather than as "". `app.content_carries_
 * trusted_code` trims before it decides, so an empty hatch does not escalate a
 * page to needing a super admin's review — and `deepEqual` treats absent and
 * empty as the same value, so clearing a hatch takes the changed-dot away
 * instead of leaving one behind for a difference nobody made.
 */
export function setCustomCss(state: EditorState, index: number, css: string): EditorState {
  return apply(state, draft => {
    const target = draft.sections[index]
    if (!target) return
    if (css.trim() === '') delete target.custom_css
    else target.custom_css = css
  })
}

export function setRawHtml(state: EditorState, index: number, html: string): EditorState {
  return apply(state, draft => {
    const target = draft.sections[index]
    if (!target) return
    if (html.trim() === '') delete target.raw_html
    else target.raw_html = html
  })
}

/** Does anything on this page still need a super admin to look at it? */
export function carriesTrustedCode(document: EditorDocument): boolean {
  return document.sections.some(
    section => (section.custom_css ?? '').trim() !== '' || (section.raw_html ?? '').trim() !== '',
  )
}

export function setSelection(state: EditorState, selection: Selection): EditorState {
  return { ...state, selection }
}

// ------------------------------------------------------------ changed state

/** Per-field revert: put one slot back to what was loaded (SPEC §6.4). */
export function revertSlot(state: EditorState, section: number, slot: string): EditorState {
  return apply(state, draft => {
    const target = draft.sections[section]
    const original = baselineSection(state, section)
    if (!target) return
    if (!original || !(slot in original.values)) {
      const { [slot]: _removed, ...rest } = target.values
      target.values = clearSampleField(rest, slot)
      return
    }
    target.values = { ...target.values, [slot]: clone(original.values[slot]) }
    if (sampleFieldNames(original.values).includes(slot))
      target.values[SAMPLE_FIELDS_KEY] = [...new Set([...sampleFieldNames(target.values), slot])]
    else target.values = clearSampleField(target.values, slot)
  })
}

export function revertSection(state: EditorState, index: number): EditorState {
  return apply(state, draft => {
    const original = baselineSection(state, index)
    if (original) draft.sections[index] = clone(original)
  })
}

export function isSlotChanged(state: EditorState, section: number, slot: string): boolean {
  const current = state.document.sections[section]
  const original = baselineSection(state, section)
  if (!current) return false
  // A section that did not exist when the page loaded is new, not "changed".
  if (!original) return true
  return !deepEqual(current.values[slot], original.values[slot])
}

/**
 * Was this section added during this session?
 *
 * `isSlotChanged` answers true for every field of a section that did not exist
 * when the page loaded, which is correct — the value is not what it was — and
 * is the wrong thing to put a "Revert to original" link beside, because there
 * is no original. A section somebody added two seconds ago offering to restore
 * a previous value it never had is the interface telling a small lie about its
 * own history.
 */
export function isSectionNew(state: EditorState, index: number): boolean {
  return state.document.sections[index] !== undefined && baselineSection(state, index) === undefined
}

export function isSectionChanged(state: EditorState, index: number): boolean {
  const current = state.document.sections[index]
  const original = baselineSection(state, index)
  if (!current) return false
  if (!original) return true
  return !deepEqual(current, original)
}

function baselineSection(state: EditorState, index: number): EditorSection | undefined {
  const origin = state.sectionOrigins[index]
  if (!origin) return undefined
  const baselineIndex = state.baselineOrigins.indexOf(origin)
  return baselineIndex === -1 ? undefined : state.baseline.sections[baselineIndex]
}

/** Is there work the server has not acknowledged? Drives the saved indicator. */
export function isDirty(state: EditorState): boolean {
  return !deepEqual(state.document, state.saved)
}

/** Has anything changed since the page was opened? Drives the tree's dots. */
export function hasChanges(state: EditorState): boolean {
  return !deepEqual(state.document, state.baseline)
}

export function changedSlots(state: EditorState, section: number): string[] {
  const current = state.document.sections[section]
  if (!current) return []
  return Object.keys(current.values).filter(slot => isSlotChanged(state, section, slot))
}

/**
 * After an acknowledged save, record *what the server actually acknowledged*.
 *
 * The acknowledged snapshot is a required argument rather than "whatever the
 * document is now" on purpose. A save is asynchronous, and a person keeps
 * typing while it is in flight; marking the current document saved would
 * declare text saved that never left the browser, and the next autosave would
 * never fire because nothing looked dirty. That is silent data loss on a
 * refresh, so the signature makes the mistake impossible to write.
 *
 * It moves `saved` and deliberately leaves `baseline` alone, so autosaving does
 * not erase the record of what the person has changed this session (v1 D15).
 */
export function commitSaved(state: EditorState, acknowledged: EditorDocument): EditorState {
  return { ...state, saved: clone(acknowledged) }
}

/**
 * Reopening the page — or publishing — makes the given content the origin.
 * The published snapshot is passed in for the same reason as above.
 */
export function commitBaseline(
  state: EditorState,
  acknowledged: EditorDocument,
  acknowledgedOrigins?: readonly string[],
): EditorState {
  const origins = acknowledgedOrigins
    ? [...acknowledgedOrigins]
    : deepEqual(acknowledged, state.document)
      ? [...state.sectionOrigins]
      : acknowledged.sections.map(() => newOrigin())
  return {
    ...state,
    baseline: clone(acknowledged),
    baselineOrigins: origins,
    saved: clone(acknowledged),
  }
}
