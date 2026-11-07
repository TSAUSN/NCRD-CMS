import type { ManifestSection, RenderOptions } from '../types.ts'
import type { storyWorldValues } from '../story-world.ts'
import type { storySplitValues } from '../story-split.ts'

export type SectionBodyContext = {
  def: ManifestSection['def']
  values: Record<string, unknown>
  options: RenderOptions
  index: number
  world: ReturnType<typeof storyWorldValues> | null
  split: ReturnType<typeof storySplitValues> | null
}

export type SectionBodyBehavior = (body: string, context: SectionBodyContext) => string
