import { it, expect } from 'vitest'
import { StructuredRepeatBinding } from './structured.ts'
import { StoryTagFilter } from './stories.ts'
const groups = { main: ['health', 'education'], secondary: ['africa', 'asia'] }
const binding = (storyTags: unknown, readerKey = 'stories') => ({
  readerKey,
  selection: { mode: 'automatic', limit: 6, storyTags },
})
it('accepts bounded Stories tag groups and empty any-group choices without opening them to other list readers', () => {
  expect(StructuredRepeatBinding.parse(binding(groups)).selection).toMatchObject({ storyTags: groups })
  expect(StoryTagFilter.parse({ main: [], secondary: [] })).toEqual({ main: [], secondary: [] })
  expect(StructuredRepeatBinding.safeParse(binding(groups, 'workshops')).success).toBe(false)
  for (const value of [
    null,
    [],
    { main: [] },
    { ...groups, extra: true },
    { main: ['health', 'health'], secondary: [] },
    { main: ['Health'], secondary: [] },
    { main: [12], secondary: [] },
    { main: Array.from({ length: 101 }, (_, i) => 'tag-' + i), secondary: [] },
  ])
    expect(StructuredRepeatBinding.safeParse(binding(value)).success).toBe(false)
  expect(
    StructuredRepeatBinding.parse({ readerKey: 'workshops', selection: { mode: 'automatic', limit: 125 } }).readerKey,
  ).toBe('workshops')
})
