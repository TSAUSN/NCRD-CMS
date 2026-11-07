import type { ReorderDecision, ReorderPoint } from './use-reorderable-list.ts'

export type FlatMove = { from: number; to: number }

/** Convert the marked gap to the final index after removing the source row. */
export function flatReorderIntent(ids: readonly string[], point: ReorderPoint): ReorderDecision<FlatMove> {
  const from = ids.indexOf(point.from)
  const over = ids.indexOf(point.over)
  if (from < 0 || over < 0) return { status: 'blocked', message: 'This list changed. Try moving the item again.' }
  if (from === over) return { status: 'unchanged' }
  const gap = over + (point.edge === 'after' ? 1 : 0)
  const to = gap - (from < gap ? 1 : 0)
  if (from === to) return { status: 'unchanged' }
  return { status: 'move', marker: { row: point.over, edge: point.edge }, move: { from, to } }
}
