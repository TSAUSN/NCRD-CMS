import { nationalTileLayout } from '@cms/schema'
import { resolvedCollection } from '../structured.ts'
import type { SectionBodyBehavior } from './types.ts'

export const featureTileLayout: SectionBodyBehavior = (body, { def, values }) => {
  if (def.slug === 'core-feature-tiles')
    body = body.replace(
      'class="national-tiles"',
      'class="national-tiles" data-national-tile-layout="' +
        nationalTileLayout(values, resolvedCollection(values.cards)?.entries.length) +
        '"',
    )
  return body
}
