import { describe, it, expect } from 'vitest'
import { pageTree } from './workspace-model.ts'
describe('Pages tree', () => {
  it('keeps siblings ordered, places children under parents and includes missing parents', () => {
    expect(
      pageTree([
        { id: 'child', parent_page_id: 'root' },
        { id: 'root', parent_page_id: null },
        { id: 'orphan', parent_page_id: 'missing' },
        { id: 'sibling', parent_page_id: 'root' },
      ]).map(({ page, depth }) => [page.id, depth]),
    ).toEqual([
      ['root', 0],
      ['child', 1],
      ['sibling', 1],
      ['orphan', 0],
    ])
  })
  it('keeps empty, single and corrupted cycles reachable once', () => {
    expect(pageTree([])).toEqual([])
    expect(pageTree([{ id: 'a', parent_page_id: null }])).toHaveLength(1)
    expect(
      pageTree([
        { id: 'a', parent_page_id: 'b' },
        { id: 'b', parent_page_id: 'a' },
      ]).map(({ page }) => page.id),
    ).toEqual(['a', 'b'])
  })
})
