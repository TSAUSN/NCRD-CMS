import { describe, expect, it } from 'vitest'
import { flatReorderIntent } from './flat-reorder.ts'
import type { DropEdge } from './use-reorderable-list.ts'

describe('an insertion gap in a flat list', () => {
  const ids = ['one', 'two', 'three']
  const move = (from: string, over: string, edge: DropEdge) =>
    flatReorderIntent(ids, { from, over, edge, horizontalDistance: 90 })

  it('moves one step down or up, and can reach both ends', () => {
    expect(move('one', 'two', 'after')).toMatchObject({ move: { from: 0, to: 1 } })
    expect(move('three', 'two', 'before')).toMatchObject({ move: { from: 2, to: 1 } })
    expect(move('one', 'three', 'after')).toMatchObject({ move: { from: 0, to: 2 } })
    expect(move('three', 'one', 'before')).toMatchObject({ move: { from: 2, to: 0 } })
  })

  it('does not dirty a draft when the marked gap already surrounds its source', () => {
    expect(move('one', 'two', 'before')).toEqual({ status: 'unchanged' })
    expect(move('two', 'one', 'after')).toEqual({ status: 'unchanged' })
    expect(move('two', 'two', 'after')).toEqual({ status: 'unchanged' })
    expect(move('one', 'removed', 'after')).toMatchObject({ status: 'blocked' })
  })
})
