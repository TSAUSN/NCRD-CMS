import type { Queryable } from '@cms/platform'
import { imageFocus, type ImageFocus } from '@cms/schema'
import { DomainError } from '@cms/domain'
export type StoryPhotoInput = { id: string; description: string; focus: ImageFocus | null }
/** Client drafts identify a library image; only the server constructs its URL. */
export async function resolveStoryPhoto(client: Queryable, siteId: string, input: StoryPhotoInput) {
  if (
    !input ||
    typeof input.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id) ||
    typeof input.description !== 'string' ||
    !input.description.trim() ||
    input.description.length > 1000 ||
    (input.focus !== null &&
      (!imageFocus(input.focus) || Object.keys(input.focus).some(key => key !== 'x' && key !== 'y')))
  )
    throw new DomainError('invalid_state', 'Choose a ready photo, add its description and check its focus point.')
  const media = (
    await client.query(
      "SELECT id FROM media WHERE id=$1 AND status='ready' AND deleted_at IS NULL AND (site_id=$2 OR site_id IS NULL) AND EXISTS(SELECT 1 FROM media_variants v WHERE v.media_id=media.id AND v.kind='wide')",
      [input.id, siteId],
    )
  ).rows[0]
  if (!media) throw new DomainError('invalid_state', 'Choose a ready photo from this site’s Media.')
  return {
    src: '/media/' + media.id + '/wide',
    alt: input.description.trim(),
    decorative: false,
    ...(input.focus ? { focal: imageFocus(input.focus) } : {}),
  }
}
