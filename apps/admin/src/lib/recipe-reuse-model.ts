import type { RecipeSection } from './page-recipes.ts'

export type RecipeBinding = {
  readerKey: string
  selection: { mode: 'automatic'; limit: number } | { mode: 'manual'; stableKeys: string[] }
}
export type RecipeBindings = Record<string, RecipeBinding>
export type RecipeTarget = {
  id: string
  name: string
  canCreate: boolean
  pages: { id: string; title: string; revision: string }[]
  collections: { readerKey: string; name: string; entries: { stableKey: string; label: string }[] }[]
}

/** Stored binding requirements, never expanded collection records. */
export function recipeBindingRequirements(content: readonly RecipeSection[]): string[] {
  const keys = new Set<string>()
  for (const section of content)
    for (const value of Object.values(section.values)) {
      if (value !== null && typeof value === 'object' && 'readerKey' in value && typeof value.readerKey === 'string')
        keys.add(value.readerKey)
    }
  return [...keys]
}
