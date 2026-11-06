import type { Queryable } from '@cms/platform'
import { ECHELON_REFERENCE_MEDIA, withEchelonMedia, type EchelonMediaValues } from '@cms/seeds/echelon-chapters'
import { markSampleValues, sectionStartingValues } from '@cms/schema'
/** RLS remains in force. Only this site's ready imported reference objects qualify. */
export async function echelonSiteMedia(client: Queryable, siteId: string): Promise<EchelonMediaValues | null> {
  if (!(await client.query('SELECT chapters_enabled FROM sites WHERE id=$1', [siteId])).rows[0]?.chapters_enabled)
    return null
  const sources = ECHELON_REFERENCE_MEDIA.map(row => row.source),
    rows = (
      await client.query<{ id: string; source: string; alt_text: string; focal: { x: number; y: number } }>(
        "SELECT id,source,alt_text,focal FROM media WHERE site_id=$1 AND source=ANY($2::text[]) AND status='ready' AND deleted_at IS NULL ORDER BY created_at,id",
        [siteId, sources],
      )
    ).rows,
    result: EchelonMediaValues = {}
  for (const row of rows) {
    const reference = ECHELON_REFERENCE_MEDIA.find(item => item.source === row.source)
    if (reference && row.alt_text.trim())
      result[reference.key] = {
        src: '/media/' + row.id + '/original',
        alt: row.alt_text,
        decorative: false,
        focal: row.focal,
      }
  }
  return result
}
export function echelonSectionStartingValues(
  slots: Parameters<typeof sectionStartingValues>[0],
  media: EchelonMediaValues,
  slug: string,
) {
  return withEchelonMedia(markSampleValues(sectionStartingValues(slots)), media, slug)
}
