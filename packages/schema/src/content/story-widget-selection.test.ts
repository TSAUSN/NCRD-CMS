import { it, expect } from 'vitest'
import {
  STORY_WIDGET_SOURCE_LIMIT,
  storyWidgetCardValues,
  storyWidgetSelection,
  storyWorldLimit,
  storyWidgetMaximum,
} from './story-widget-selection.ts'
import { StructuredRepeatBinding } from './structured.ts'
it('expands managed automatic source pools while preserving authored/manual limits and sector6', () => {
  const selection = { mode: 'automatic' as const, limit: 200 }
  expect(storyWidgetSelection(selection, true).limit).toBe(2000)
  expect(storyWidgetSelection(selection, false)).toBe(selection)
  const manual = { mode: 'manual', stableKeys: ['first'] }
  expect(storyWidgetSelection(manual, true)).toBe(manual)
  expect(
    StructuredRepeatBinding.safeParse({ readerKey: 'stories', selection: { mode: 'automatic', limit: 201 } }).success,
  ).toBe(false)
  expect(storyWorldLimit('200')).toBe(STORY_WIDGET_SOURCE_LIMIT)
  expect(storyWorldLimit('6')).toBe(6)
  expect(storyWidgetMaximum({ sectorPageLimit: 6 }, '/ways-we-help/health')).toBe(6)
  expect(storyWidgetMaximum(undefined, '/newsroom')).toBe(2000)
})
it('projects optional card data without losing required fields or changing the source record', () => {
  const values = {
      title: '[Title]',
      body: '[Whole article]',
      credit: '[Required]',
      editor_note: '[Unused]',
      hidden: false,
    },
    before = structuredClone(values),
    fields = [
      { key: 'body', label: 'Body', type: 'richtext' as const, required: false },
      { key: 'credit', label: 'Credit', type: 'text' as const, required: true },
    ]
  expect(storyWidgetCardValues(values, fields)).toEqual({ title: '[Title]', credit: '[Required]', hidden: false })
  expect(values).toEqual(before)
  expect(storyWidgetCardValues(values, [{ ...fields[0]!, required: true }]).body).toBe('[Whole article]')
})
