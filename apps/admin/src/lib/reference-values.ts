/** Values a section stores beside its fields to record what its markup uses:
 * the V1 importer keeps `v1-media-N` (`{ media_id, variant }`) for images its
 * source embeds and `v1-asset-N` (`{ asset_id }`) for the site's fonts and the
 * documents it links. They are not fields, so no field mapping carries them,
 * but the database indexes them from page versions: a page's registered fonts,
 * a document's public delivery and media usage all come from them. Dropping
 * them on an update rendered Echelon without its fonts. */
type Reference = { media_id: string; variant?: string } | { asset_id: string }

function isReference(value: unknown): value is Reference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  if (entries.length === 1 && typeof (value as { asset_id?: unknown }).asset_id === 'string') return true
  return (
    typeof (value as { media_id?: unknown }).media_id === 'string' &&
    entries.every(([key, item]) => key === 'media_id' || (key === 'variant' && typeof item === 'string'))
  )
}

/** The reference values to keep across an update: every non-field entry that
 * holds only a media or site-asset reference and whose key the new definition
 * does not use for a field of its own. */
export function referenceValues(
  values: Record<string, unknown>,
  fields: readonly { id: string }[],
): Record<string, unknown> {
  const taken = new Set(fields.map(field => field.id))
  return Object.fromEntries(
    Object.entries(values)
      .filter(
        ([key, value]) =>
          !taken.has(key) &&
          (isReference(value) ||
            (key === '__cms_anchor' && typeof value === 'string') ||
            (key === '__cms_anchor_aliases' && Array.isArray(value))),
      )
      .map(([key, value]) => [key, structuredClone(value)]),
  )
}
