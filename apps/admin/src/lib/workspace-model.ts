export function pageTree<T extends { id: string; parent_page_id: string | null }>(
  pages: readonly T[],
): { page: T; depth: number }[] {
  const ids = new Set(pages.map(page => page.id))
  const seen = new Set<string>()
  const result: { page: T; depth: number }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const page of pages) {
      if (seen.has(page.id)) continue
      const effective = page.parent_page_id && ids.has(page.parent_page_id) ? page.parent_page_id : null
      if (effective !== parent) continue
      seen.add(page.id)
      result.push({ page, depth })
      walk(page.id, depth + 1)
    }
  }
  walk(null, 0)
  // Damaged/old cyclic data remains reachable instead of disappearing.
  for (const page of pages)
    if (!seen.has(page.id)) {
      seen.add(page.id)
      result.push({ page, depth: 0 })
      walk(page.id, 1)
    }
  return result
}
