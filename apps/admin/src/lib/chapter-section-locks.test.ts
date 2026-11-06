import { expect, it } from 'vitest'
import { isSharedChapterPart, preservesSharedChapterParts } from './chapter-section-locks.ts'
import type { EditorSection } from '@cms/domain'
const section = (part: string): EditorSection => ({
  section_def_id: 'example',
  section_def_version: 1,
  values: { __cms_chapter_part: part, heading: '[Heading]' },
  hidden: false,
  label: part,
})
it('keeps shared instances and their positions while permitting chapter fields and board order', () => {
  const original = ['what', 'board', 'join'].map(section),
    next = structuredClone(original)
  next[1]!.values.heading = '[New heading]'
  expect(preservesSharedChapterParts(original, next)).toBe(true)
  expect(isSharedChapterPart(original[0])).toBe(true)
  expect(isSharedChapterPart(original[1])).toBe(false)
  for (const mutate of [
    (items: EditorSection[]) => {
      items[0]!.values.heading = 'Changed'
    },
    (items: EditorSection[]) => {
      items[0]!.hidden = true
    },
    (items: EditorSection[]) => {
      items.splice(0, 1)
    },
    (items: EditorSection[]) => {
      items.reverse()
    },
    (items: EditorSection[]) => {
      items.push(structuredClone(items[0]!))
    },
  ]) {
    const changed = structuredClone(original)
    mutate(changed)
    expect(preservesSharedChapterParts(original, changed)).toBe(false)
  }
})
it.each(['about', 'faq', 'jumps'])('protects reviewed chapter %s while preserving content fields elsewhere', part => {
  const original = [section(part), section('paragraph')],
    next = structuredClone(original)
  next[1]!.values.heading = '[Local words]'
  expect(preservesSharedChapterParts(original, next)).toBe(true)
  next[0]!.values.heading = '[Changed shared words]'
  expect(preservesSharedChapterParts(original, next)).toBe(false)
})
