import { describe, expect, it } from 'vitest'
import {
  changedCells,
  pageContentChanges,
  pageChangePresentation,
  readableReleaseValue,
  storyEntryPresentation,
} from './release-copy.ts'
const form = {
  'a:1': {
    name: 'Hero',
    slots: [
      { id: 'heading', kind: 'text', label: 'Heading' },
      { id: 'photo', kind: 'image', label: 'Photo' },
    ],
  },
}
const a = {
  section_def_id: 'a',
  section_def_version: 1,
  values: { heading: 'Before', photo: { src: '/old', alt: 'Earlier image' } },
}
describe('human release summaries', () => {
  it('counts real text and image changes and retains their complete before and after values', () => {
    const result = pageContentChanges(
      [a],
      [{ ...a, values: { heading: 'After', photo: { src: '/new', alt: 'New image' } } }],
      form,
    )
    expect(result.summary).toEqual(['Hero: changed heading', 'Hero: changed the photo'])
    expect(result.cells).toContainEqual({ label: 'Hero · Heading', before: 'Before', after: 'After' })
  })
  it('distinguishes reorder, addition and removal from text edits', () => {
    const b = { ...a, section_def_id: 'b', label: 'Footer' }
    expect(pageContentChanges([a, b], [b, a], form).summary).toEqual(['Sections rearranged'])
    expect(pageContentChanges([a], [a, b], form).summary).toEqual(['Footer: added this section'])
    expect(pageContentChanges([a, b], [a], form).summary).toEqual(['Footer: removed this section'])
  })
  it('shows empty and boolean fields plainly and does not expose private sample markers', () => {
    expect(changedCells({ label: '' }, { label: 'A complete long name' }, { label: 'Name' })).toEqual([
      { label: 'Name', before: 'Empty', after: 'A complete long name' },
    ])
    expect(readableReleaseValue({ __cms_sample_fields: ['name'], name: 'Sample person' })).toBe('Sample person')
    expect(readableReleaseValue(false)).toBe('No')
  })
})

it('describes Story content changes with names while keeping media IDs and tag keys out of the review', () => {
  const fields = [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'tags', label: 'Project Sectors', type: 'text' },
      { key: 'photo', label: 'Lead photo', type: 'image' },
    ],
    names = { main: { 'health-key': 'Health' }, secondary: {} }
  const before = {
      title: '[Story]',
      tags: '',
      photo: { src: '/media/11111111-1111-4111-8111-111111111111/wide', alt: '[Earlier photo]', decorative: false },
    },
    after = {
      ...before,
      tags: 'health-key',
      photo: { ...before.photo, src: '/media/22222222-2222-4222-8222-222222222222/wide', alt: '[New photo]' },
    }
  const result = storyEntryPresentation(before, after, fields, names)
  expect(result.summary).toBe('[Story]: Project Sectors changed, Lead photo changed')
  expect(JSON.stringify(result)).not.toContain('health-key')
  expect(JSON.stringify(result)).not.toContain('/media/')
  expect(result.cells).toContainEqual({ label: '[Story] · Project Sectors', before: 'Empty', after: 'Health' })
  expect(storyEntryPresentation(null, after, fields, names).summary).toBe('Added story: [Story]')
  const focus = storyEntryPresentation(
    after,
    { ...after, photo: { ...after.photo, focal: { x: 0.2, y: 0.8 } } },
    fields,
    names,
  )
  expect(focus.summary).toBe('[Story]: Photo focus changed')
})

it('names new and removed cards without treating a shifted section as a reorder', () => {
  const forms = {
      ...form,
      'cards:1': {
        name: 'Cards',
        slots: [
          {
            id: 'cards',
            kind: 'repeat',
            label: 'Cards',
            constraints: { item: { unit: 'Card', fields: [{ id: 'title', kind: 'text', label: 'Title' }] } },
          },
        ],
      },
    },
    before = {
      section_def_id: 'cards',
      section_def_version: 1,
      label: 'What We Do',
      values: { cards: { items: ['a'] }, cards__a__title: 'Health' },
    },
    after = { ...before, values: { ...before.values, cards: { items: ['a', 'b'] }, cards__b__title: 'Protection' } }
  expect(pageContentChanges([before], [after], forms).summary).toEqual(['What We Do: added a card, "Protection"'])
  expect(pageContentChanges([after], [before], forms).summary).toEqual(['What We Do: removed card, "Protection"'])
  expect(pageContentChanges([before], [after], forms).cells).toContainEqual({
    label: 'What We Do · card, "Protection" · Title',
    before: 'Not on this page',
    after: 'Protection',
  })
  expect(pageContentChanges([after], [before], forms).cells).toContainEqual({
    label: 'What We Do · card, "Protection" · Title',
    before: 'Protection',
    after: 'Removed from this page',
  })
  expect(pageContentChanges([before], [a, before], forms).summary).toEqual(['Hero: added this section'])
})
it('detects repeated item text and slide focus even when the order value stays unchanged', () => {
  const fields = [
      { id: 'title', kind: 'text', label: 'Title' },
      { id: 'photo', kind: 'image', label: 'Photo' },
    ],
    forms = {
      'slides:1': {
        name: 'Hero',
        slots: [{ id: 'slides', kind: 'repeat', label: 'Slides', constraints: { item: { unit: 'Slide', fields } } }],
      },
    },
    old = {
      section_def_id: 'slides',
      section_def_version: 1,
      label: 'Hero',
      values: {
        slides: { items: ['a', 'b'] },
        slides__b__title: 'Hope',
        slides__b__photo: { src: '/photo', alt: 'A photo', focal: { x: 0.5, y: 0.5 } },
      },
    },
    next = {
      ...old,
      values: { ...old.values, slides__b__photo: { src: '/photo', alt: 'A photo', focal: { x: 0.2, y: 0.8 } } },
    }
  const changes = pageContentChanges([old], [next], forms)
  expect(changes.summary).toEqual(['Hero: changed the focus point on slide 2'])
  expect(JSON.stringify(changes)).not.toContain('slides__b')
  expect(JSON.stringify(changes)).not.toContain('/photo')
  const text = pageContentChanges(
    [old],
    [{ ...old, values: { ...old.values, slides__b__title: 'Updated hope' } }],
    forms,
  )
  expect(text.summary).toEqual(['Hero: edited slide, "Updated hope"'])
  expect(text.cells[0]?.after).toBe('Updated hope')
})
it('describes paragraph and appearance changes without showing executable source', () => {
  const forms = { 'text:1': { name: 'About Us', slots: [{ id: 'body', kind: 'richtext', label: 'Text' }] } },
    before = { section_def_id: 'text', section_def_version: 1, values: { body: '<p>Before</p>' }, custom_css: 'old' },
    after = { ...before, values: { body: '<p>After</p>' }, custom_css: 'new' }
  const result = pageContentChanges([before], [after], forms)
  expect(result.summary).toEqual(['About Us: edited 1 paragraph', 'About Us: changed the appearance'])
  expect(JSON.stringify(result)).not.toContain('<p>')
  expect(result.cells[0]?.after).toBe('After')
})

it('shares the named content and page-details words with exact Show destinations', () => {
  const result = pageChangePresentation(
    [a],
    [{ ...a, values: { ...a.values, heading: 'After' } }],
    form,
    { title: 'Page', address: 'page', description: 'Before' },
    { title: 'Page', address: 'page', description: 'After' },
  )
  expect(result.summary).toBe('Hero: changed heading · Search description: changed')
  expect(result.changes).toEqual([
    { text: 'Hero: changed heading', sectionIndex: 0 },
    { text: 'Search description: changed' },
  ])
})

it('identifies one changed paragraph among unchanged paragraphs and headings', () => {
  const forms = { 'text:1': { name: 'About Us', slots: [{ id: 'body', kind: 'richtext', label: 'Text' }] } },
    before = { section_def_id: 'text', values: { body: '<p>First</p><h3>Heading</h3><p>Second</p>' } },
    after = { ...before, values: { body: '<p>Updated</p><h3>Heading</h3><p>Second</p>' } }
  expect(pageContentChanges([before], [after], forms).summary).toEqual(['About Us: edited 1 paragraph'])
})
