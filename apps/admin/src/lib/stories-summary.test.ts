import { it, expect } from 'vitest'
import { storyDetailValues, type StoryEditInput } from './stories-edit.ts'
it('limits new or edited summaries to155 without rewriting approved longer imported copy', () => {
  const input: StoryEditInput = {
    title: '[Story]',
    summary: 'a'.repeat(180),
    tags: ['health'],
    region: 'africa',
    published_date: '',
    countries: '',
    body: '',
    body_is_sample: false,
  }
  expect(storyDetailValues(input, { summary: input.summary }).summary).toBe(input.summary)
  expect(() => storyDetailValues(input)).toThrow(/155/)
  expect(() => storyDetailValues({ ...input, summary: 'b'.repeat(180) }, { summary: input.summary })).toThrow(/155/)
  expect(storyDetailValues({ ...input, summary: '[Edited description]' }, { summary: input.summary }).summary).toBe(
    '[Edited description]',
  )
})
