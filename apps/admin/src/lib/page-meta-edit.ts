import { parsePageMeta, type SeoMeta } from '@cms/schema'
import { safeUrl } from '@cms/renderer'

export type PageMetaEdit = Partial<SeoMeta>

/** Optional fields stay intact when an older editor submits only search text. */
export function mergeEditedPageMeta(current: unknown, fields: PageMetaEdit) {
  const previous = parsePageMeta(current ?? {})
  if (!previous.ok) return previous
  return parsePageMeta({ ...previous.meta, ...fields })
}

/** Share-image URLs must actually name a fetchable image address, not a link action. */
export function socialImageProblem(value: string): string | null {
  if (!value.trim()) return null
  if (value.length > 2048) return 'Use an image address of 2,048 characters or fewer.'
  const clean = value.trim()
  if (
    clean.startsWith('/media/') &&
    !/^\/media\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/(original|thumbnail|card|wide)$/.test(
      clean,
    )
  ) {
    return 'Choose the sharing image from Media again. Its media address is incomplete or unsupported.'
  }
  if (safeUrl(clean) === '#') return 'Use a public HTTPS image address or a path beginning with /.'
  try {
    const url = new URL(clean, 'https://cms-image.invalid')
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (clean.startsWith('/') || /^https:\/\//i.test(clean))
    )
      return null
  } catch {
    /* Return a field-level explanation below. */
  }
  return 'Use a public HTTPS image address or a path beginning with /, without sign-in credentials.'
}

/** Full metadata from the current editor; two-field transport remains compatible. */
export function readEditedPageMeta(
  formData: FormData,
): { ok: true; fields: PageMetaEdit } | { ok: false; problems: { field: string; message: string }[] } {
  let value: unknown
  try {
    value = formData.has('meta')
      ? JSON.parse(String(formData.get('meta')))
      : {
          title: String(formData.get('metaTitle') ?? ''),
          description: String(formData.get('metaDescription') ?? ''),
        }
  } catch {
    return {
      ok: false,
      problems: [{ field: 'metadata', message: 'The metadata could not be read. Your local changes are still here.' }],
    }
  }
  const parsed = parsePageMeta(value)
  if (!parsed.ok) return parsed
  const fields = value as PageMetaEdit
  const problem = fields.social_image === undefined ? null : socialImageProblem(fields.social_image)
  if (problem) return { ok: false, problems: [{ field: 'social_image', message: problem }] }
  return { ok: true, fields }
}
