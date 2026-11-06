import { orderedNewsroomStories, orderedStoryWidgetRows } from '@cms/schema'
import { resolvedCollection } from './structured.ts'
import { escapeAttribute, escapeText } from './escape.ts'
export type NewsroomQuery = { sector?: string; region?: string; page?: string; q?: string; view?: string }
type Choice = { id: string; label: string }
function choices(value: unknown): Choice[] {
  return Array.isArray(value)
    ? value
        .slice(0, 50)
        .flatMap(item =>
          item &&
          typeof item === 'object' &&
          typeof item.id === 'string' &&
          /^[a-z][a-z0-9-]{0,79}$/.test(item.id) &&
          typeof item.label === 'string' &&
          item.label.length <= 120
            ? [{ id: item.id, label: item.label }]
            : [],
        )
    : []
}
/** Visitors filter only an immutable published envelope with ordinary page requests. */
export function newsroomValues(
  values: Record<string, unknown>,
  query: NewsroomQuery = {},
  options: Record<string, unknown> = {},
): Record<string, unknown> {
  const list = resolvedCollection(values.stories)
  if (!list) return values
  const home = values.home === 'home',
    sectors = choices(options.sectors),
    regions = choices(options.regions),
    sector = sectors.some(s => s.id === query.sector) ? query.sector! : '',
    region = regions.some(r => r.id === query.region) ? query.region! : '',
    search = (query.q ?? '').trim().slice(0, 120).toLocaleLowerCase('en-US')
  const selected = (
      sector || region ? orderedStoryWidgetRows(list.entries) : orderedNewsroomStories(list.entries)
    ).filter(entry => {
      if (!entry.values || typeof entry.values !== 'object' || Array.isArray(entry.values)) return false
      const data = entry.values as Record<string, unknown>
      return (
        (!sector ||
          String(data.tags ?? '')
            .split(',')
            .includes(sector)) &&
        (!region || data.region === region) &&
        (!search ||
          [data.title, data.summary].some(v => typeof v === 'string' && v.toLocaleLowerCase('en-US').includes(search)))
      )
    }),
    total = selected.length,
    pages = Math.max(1, Math.ceil(total / 12)),
    page = home ? 1 : Math.max(1, Math.min(pages, /^[0-9]{1,4}$/.test(query.page ?? '') ? Number(query.page) : 1))
  function url(next: { sector?: string; region?: string; page?: number }) {
    const p = new URLSearchParams(),
      s = next.sector ?? sector,
      r = next.region ?? region
    if (s) p.set('sector', s)
    if (r) p.set('region', r)
    if (search) p.set('q', search)
    if (next.page && next.page > 1) p.set('page', String(next.page))
    return '/newsroom' + (p.size ? '?' + p.toString() : '')
  }
  function group(label: string, items: Choice[], active: string, key: 'sector' | 'region') {
    return (
      '<p><b>' +
      label +
      '</b> ' +
      [{ id: '', label: key === 'sector' ? 'All sectors' : 'All regions' }, ...items]
        .map(item =>
          item.id === active
            ? '<strong>' + escapeText(item.label) + '</strong>'
            : '<a href="' + escapeAttribute(url({ [key]: item.id })) + '">' + escapeText(item.label) + '</a>',
        )
        .join(' ') +
      '</p>'
    )
  }
  const filters = home
      ? ''
      : group('Project sector', sectors, sector, 'sector') + group('Region', regions, region, 'region'),
    count = Math.min(12, Math.max(0, total - (page - 1) * 12)),
    paging =
      '<p>Showing ' +
      count +
      ' of ' +
      total +
      ' stories</p><p>' +
      (page > 1 ? '<a href="' + escapeAttribute(url({ page: page - 1 })) + '">Newer stories</a> ' : '') +
      (page < pages
        ? '<a href="' +
          escapeAttribute(home ? '/newsroom' : url({ page: page + 1 })) +
          '">' +
          (home ? 'Show more stories' : 'Older stories') +
          '</a>'
        : '') +
      '</p>'
  return {
    ...values,
    stories: { ...list, entries: selected.slice((page - 1) * 12, page * 12) },
    filters,
    paging,
    empty_line:
      sector && sectors.some(s => s.id === sector)
        ? 'Check back soon for stories from our ' + sectors.find(s => s.id === sector)!.label.toLowerCase() + ' work.'
        : 'No stories match these filters.',
  }
}
