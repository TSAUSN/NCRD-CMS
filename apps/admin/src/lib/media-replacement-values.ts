/** Change governed image references, never arbitrary IDs or similar prose. */
export function replaceImageReferences(value: unknown, from: string, to: string, key = ''): unknown {
  if (typeof value === 'string') {
    if (value === from && (key === 'media_id' || key.endsWith('MediaId'))) return to
    return value.replace(
      /(^|[\s"'(=])\/media\/([0-9a-f-]{36})\/(original|thumbnail|card|wide)(?=$|[\s"'<>),;])/gi,
      (match, prefix: string, id: string) =>
        id.toLowerCase() === from.toLowerCase() ? `${prefix}/media/${to}/wide` : match,
    )
  }
  if (Array.isArray(value)) return value.map(child => replaceImageReferences(child, from, to))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const result = Object.fromEntries(
    Object.entries(record).map(([name, child]) => [name, replaceImageReferences(child, from, to, name)]),
  )
  if ('src' in record && record.src !== result.src && ('variant' in record || 'media_id' in record))
    result.variant = 'wide'
  // Replacing an image makes that field authored, without clearing other samples.
  if (Array.isArray(record.__cms_sample_fields))
    result.__cms_sample_fields = record.__cms_sample_fields.filter(
      name => typeof name !== 'string' || JSON.stringify(record[name]) === JSON.stringify(result[name]),
    )
  return result
}
