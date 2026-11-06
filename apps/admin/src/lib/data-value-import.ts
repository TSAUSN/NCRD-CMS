import { DataValue, parseCsvRows, type DataValue as NumberValue } from '@cms/schema'
export function numberFileUrl(source: string): URL {
  const url = new URL(source)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname) ||
    url.hostname.endsWith('.localhost')
  )
    throw new Error('Use a public https file address without sign-in details.')
  if (
    (url.hostname.replace(/\.+$/, '').toLowerCase() === 'sawso.org' ||
      url.hostname.replace(/\.+$/, '').toLowerCase().endsWith('.sawso.org')) &&
    /^\/sawso\/story\/symphony\/json(?:\/|$)/i.test(decodeURIComponent(url.pathname))
  )
    throw new Error('Use Refresh in Stories for the approved SAWSO story feed. Choose a number file here.')
  return url
}
export function previewNumberFile(text: string, current: readonly NumberValue[]): NumberValue[] {
  if (new TextEncoder().encode(text).byteLength > 1048576) throw new Error('Choose a file smaller than 1 MB.')
  let rows: unknown
  if (/^\s*[\[{]/.test(text)) {
    const parsed = JSON.parse(text)
    rows = Array.isArray(parsed) ? parsed : (parsed.numbers ?? parsed.dataValues)
  } else {
    const [head, ...csv] = parseCsvRows(text)
    if (!head) throw new Error('The file is empty.')
    rows = csv
      .filter(row => row.some(Boolean))
      .map(row => Object.fromEntries(head.map((key, index) => [key.trim(), row[index] ?? ''])))
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 100)
    throw new Error('Use a JSON list or CSV with 1 to 100 numbers. Include label, value and source.')
  const seen = new Set<string>()
  return rows.map(input => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Each row needs a label, value and source.')
    const raw = input as Record<string, unknown>,
      label = String(raw.label ?? '').trim(),
      matches = current.filter(row => row.label.toLowerCase() === label.toLowerCase()),
      old = current.find(row => row.id === raw.id) ?? (matches.length === 1 ? matches[0] : undefined),
      id = old?.id ?? crypto.randomUUID(),
      value =
        typeof raw.value === 'number' && Number.isFinite(raw.value)
          ? String(raw.value)
          : typeof raw.value === 'string'
            ? raw.value.trim()
            : ''
    if (!label || label.length > 120 || !value || value.length > 100 || seen.has(id))
      throw new Error('Use one row per number, with a label and value.')
    seen.add(id)
    if (old?.status === 'does-not-change') return { ...old }
    const row = {
      ...old,
      id,
      label,
      value,
      unit: String(raw.unit ?? old?.unit ?? ''),
      source: typeof raw.source === 'string' ? raw.source.trim() : value === old?.value ? old.source : '',
      sourcePageId: old?.sourcePageId ?? null,
      asOf: String(raw.asOf ?? old?.asOf ?? ''),
      status: 'needs-checking' as NumberValue['status'],
      showSource: old?.showSource ?? false,
    }
    if (old && row.value === old.value && row.source === old.source && row.unit === old.unit && row.asOf === old.asOf)
      row.status = old.status
    if (!DataValue.safeParse({ ...row, source: row.source || '[Source required]' }).success)
      throw new Error('A row is too long or invalid. Check its label, value, source and date.')
    return row
  })
}
export function mergeNumberFile(current: readonly NumberValue[], incoming: readonly NumberValue[]): NumberValue[] {
  const result = current.map(row => incoming.find(next => next.id === row.id) ?? row)
  return [...result, ...incoming.filter(row => !current.some(old => old.id === row.id))]
}
