import { describe, expect, it } from 'vitest'
import {
  STRUCTURED_SCHEMA_VERSION,
  StructuredDocument,
  StructuredRepeatBinding,
  structuredShapeDefects,
  upgradeStructuredDocument,
} from './structured.ts'

const repeat = {
  type: 'repeat' as const,
  field: 'speakers',
  item: [{ type: 'element' as const, tag: 'article' as const, children: [{ type: 'text' as const, field: 'name' }] }],
  empty: { behavior: 'message' as const, text: 'No speakers have been published.' },
}

describe('structured schema v3 repeats', () => {
  it('accepts a typed item subtree and explicit empty behavior', () => {
    expect(
      StructuredDocument.safeParse({
        schemaVersion: STRUCTURED_SCHEMA_VERSION,
        fields: [{ name: 'speakers', type: 'repeat', label: 'Speakers' }],
        nodes: [repeat],
      }).success,
    ).toBe(true)
  })

  it('bounds and strictly shapes automatic and manual selections', () => {
    expect(
      StructuredRepeatBinding.safeParse({ readerKey: 'workshops', selection: { mode: 'automatic', limit: 125 } })
        .success,
    ).toBe(true)
    expect(
      StructuredRepeatBinding.safeParse({ readerKey: 'workshops', selection: { mode: 'automatic', limit: 200 } })
        .success,
    ).toBe(true)
    expect(
      StructuredRepeatBinding.safeParse({ readerKey: 'speakers', selection: { mode: 'automatic', limit: 24 } }).success,
    ).toBe(true)
    expect(
      StructuredRepeatBinding.safeParse({ readerKey: 'speakers', selection: { mode: 'automatic', limit: 201 } })
        .success,
    ).toBe(false)
    expect(
      StructuredRepeatBinding.safeParse({
        readerKey: 'speakers',
        selection: { mode: 'manual', stableKeys: ['ada', 'grace'] },
      }).success,
    ).toBe(true)
    expect(
      StructuredRepeatBinding.safeParse({
        readerKey: 'speakers',
        selection: { mode: 'manual', stableKeys: ['ada', 'ada'] },
      }).success,
    ).toBe(false)
    expect(
      StructuredRepeatBinding.safeParse({
        readerKey: 'speakers',
        selection: { mode: 'automatic', limit: 2, sort: 'title' },
      }).success,
    ).toBe(false)
  })

  it('upgrades schema v2 without changing any authored byte-bearing property', () => {
    const old = {
      schemaVersion: 2,
      fields: [{ name: 'picture', type: 'image', label: 'Picture' }],
      nodes: [{ type: 'image', field: 'picture', staticAttributes: { class: ['portrait'], width: 320, height: 240 } }],
    }
    const upgraded = upgradeStructuredDocument(old)
    expect(upgraded).toEqual({ ...old, schemaVersion: 3 })
  })

  it('fails before recursive parsing when a repeat uses children as a shallow decoy', () => {
    let deep: Record<string, unknown> = { type: 'text', field: 'name' }
    for (let index = 0; index < 50_000; index += 1) {
      deep = { type: 'element', tag: 'div', children: [deep] }
    }
    const hostile = {
      schemaVersion: 3,
      fields: [{ name: 'speakers', type: 'repeat', label: 'Speakers' }],
      nodes: [{ ...repeat, children: [], item: [deep] }],
    }
    expect(() => structuredShapeDefects(hostile)).not.toThrow()
    expect(structuredShapeDefects(hostile).map(problem => problem.code)).toContain('node-container-conflict')
  })
})

it('accepts only bounded, closed newest/category choices', () => {
  for (const selection of [
    { mode: 'automatic', limit: 3, order: 'newest' },
    { mode: 'automatic', limit: 10, filter: { field: 'track', value: 'Community' } },
  ])
    expect(StructuredRepeatBinding.safeParse({ readerKey: 'program', selection }).success).toBe(true)
  for (const selection of [
    { mode: 'automatic', limit: 3, order: 'random' },
    { mode: 'automatic', limit: 10, filter: { field: '../bad', value: 'x' } },
    { mode: 'automatic', limit: 10, filter: { field: 'track', value: '' } },
    { mode: 'automatic', limit: 10, filter: { field: 'track', value: 'x', sql: 'true' } },
  ])
    expect(StructuredRepeatBinding.safeParse({ readerKey: 'program', selection }).success).toBe(false)
})
