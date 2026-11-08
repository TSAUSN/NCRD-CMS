import { repeatItemKeys } from './repeat-items.ts'

const KEY = '__cms_tile_layout'
export type NationalTileLayout = 'three' | 'four' | 'five'
const inferred = (values: Record<string, unknown>, count = repeatItemKeys(values.cards).length): NationalTileLayout => {
  return count === 4 ? 'four' : count === 5 ? 'five' : 'three'
}
/** Older sections infer their approved presentation until their list changes. */
export function nationalTileLayout(values: Record<string, unknown>, count?: number): NationalTileLayout {
  const saved = values[KEY]
  return saved === 'three' || saved === 'four' || saved === 'five' ? saved : inferred(values, count)
}
/** Content edits preserve the current presentation; cancelling removes redundant state. */
export function preserveNationalTileLayout(
  slug: string | undefined,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  if (slug !== 'core-feature-tiles' || repeatItemKeys(before.cards).length === repeatItemKeys(after.cards).length)
    return after
  const layout = nationalTileLayout(before)
  const next = { ...after }
  if (layout === inferred(next)) delete next[KEY]
  else next[KEY] = layout
  return next
}
