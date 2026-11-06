import { expect, it } from 'vitest'
import { markSampleValues, sampleFieldNames } from '@cms/schema'
import { createEditorState, setValue, undo, redo, setSectionValues, revertSlot } from './editing.ts'
import { runReadinessChecks } from './readiness.ts'
const initial = () =>
  createEditorState({
    sections: [
      { section_def_id: 'a', section_def_version: 1, values: markSampleValues({ heading: 'Example', body: 'Story' }) },
    ],
    meta: {},
  })

it('keeps a sample picture marked while changing only its crop, including Undo and reset', () => {
  const photo = { src: '/cms-samples/r8-landscape.png', alt: 'Abstract sample', decorative: false }
  const start = createEditorState({
    sections: [{ section_def_id: 'a', section_def_version: 1, values: markSampleValues({ photo }) }],
    meta: {},
  })
  const cropped = setValue(start, 0, 'photo', { ...photo, focal: { x: 0.7, y: 0.2 } })
  expect(sampleFieldNames(cropped.document.sections[0]!.values)).toEqual(['photo'])
  expect(sampleFieldNames(undo(cropped).document.sections[0]!.values)).toEqual(['photo'])
  expect(
    sampleFieldNames(setValue(cropped, 0, 'photo', { ...photo, focal: null }).document.sections[0]!.values),
  ).toEqual(['photo'])
  expect(
    sampleFieldNames(
      setValue(cropped, 0, 'photo', { ...photo, src: '/media/replacement/wide', focal: null }).document.sections[0]!
        .values,
    ),
  ).toEqual([])
})
it('clears only the edited sample and restores its chip with Undo', () => {
  const edited = setValue(initial(), 0, 'heading', 'My heading')
  expect(sampleFieldNames(edited.document.sections[0]!.values)).toEqual(['body'])
  expect(sampleFieldNames(undo(edited).document.sections[0]!.values)).toEqual(['heading', 'body'])
  expect(sampleFieldNames(redo(undo(edited)).document.sections[0]!.values)).toEqual(['body'])
})
it('keeps unchanged sample chips when repeated fields change together', () => {
  const state = initial()
  const next = setSectionValues(state, 0, { ...state.document.sections[0]!.values, body: 'Our story' })
  expect(sampleFieldNames(next.document.sections[0]!.values)).toEqual(['heading'])
})
it('lists remaining examples as a blocking confirmation without relaxing other checks', () => {
  const report = runReadinessChecks({
    title: 'Page',
    metaDescription: undefined,
    html: '<h1>Hello</h1>',
    sectionCount: 1,
    knownPaths: new Set(),
    sampleContent: [{ section: 'Hero', fields: ['intro'] }],
  })
  expect(report.blocking).toEqual([expect.objectContaining({ rule: 'sample_content', detail: 'intro' })])
  expect(report.advisory).toEqual([expect.objectContaining({ rule: 'missing_meta_description' })])
  expect(report.ok).toBe(false)
})

it('restores a sample marker with per-field revert', () => {
  const edited = setValue(initial(), 0, 'heading', 'Our title')
  expect(sampleFieldNames(revertSlot(edited, 0, 'heading').document.sections[0]!.values)).toEqual(['body', 'heading'])
})

it('cancels a nested field edit with its sample marker while preserving other draft changes', async () => {
  const { captureFieldEdit, cancelFieldEdit } = await import('./editing.ts')
  const original = { label: '[Link]', url: '#next' },
    values = { ...markSampleValues({ link: original }), heading: 'Original' }
  const state = createEditorState({ sections: [{ section_def_id: 'def', section_def_version: 1, values }], meta: {} })
  const snapshot = captureFieldEdit(values, 'link')
  const edited = setValue(
    setValue(state, 0, 'link', { label: 'Typed', url: 'https://example.test' }),
    0,
    'heading',
    'Kept',
  )
  const restored = cancelFieldEdit(edited, 0, 'link', snapshot)
  expect(restored.document.sections[0]!.values.link).toEqual(original)
  expect(restored.document.sections[0]!.values.heading).toBe('Kept')
  expect(sampleFieldNames(restored.document.sections[0]!.values)).toEqual(['link'])
  const absent = captureFieldEdit({}, 'optional')
  expect(
    cancelFieldEdit(setValue(restored, 0, 'optional', { url: '/added' }), 0, 'optional', absent).document.sections[0]!
      .values,
  ).not.toHaveProperty('optional')
})
