import { renderedFeatures } from './feature-markers.ts'
import { escapeAttribute as attr, escapeText as text, safeUrl } from './escape.ts'
import { ECHELON_MAP_POINTS } from './echelon-map-points.ts'
type Context = { chapters?: unknown; query?: string; pagePath?: string; widgetKey?: string }
type Entry = { slug: string; name: string; label: string; href: string; external: boolean }
function entries(input: unknown): Entry[] {
  return (Array.isArray(input) ? input : [])
    .slice(0, 500)
    .flatMap((value: unknown) => {
      if (!value || typeof value !== 'object') return []
      const row = value as Record<string, unknown>
      if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 160) return []
      const external =
        typeof row.externalUrl === 'string' && row.externalUrl.startsWith('https://') ? safeUrl(row.externalUrl) : ''
      const path = typeof row.path === 'string' && /^\/(?!\/)/.test(row.path) ? safeUrl(row.path) : ''
      const href = external || path
      if (!href) return []
      return [
        {
          slug: typeof row.slug === 'string' && /^[a-z0-9-]{1,80}$/.test(row.slug) ? row.slug : '',
          name: row.name,
          label: row.name.replace(/\s+Chapter$/i, ''),
          href,
          external: Boolean(external),
        },
      ]
    })
    .sort((a, b) => {
      const priority = (slug: string) => (slug === 'chicago' ? -2 : slug === 'indianapolis' ? -1 : 0)
      return priority(a.slug) - priority(b.slug) || a.label.localeCompare(b.label, 'en-US')
    })
}
/** Source geometry supplies appearance; the redacted publication reader supplies every destination. */
export function renderEchelonDirectory(context: Context): string {
  const rows = entries(context.chapters)
  const query = (context.query ?? '').trim().slice(0, 120)
  const lower = query.toLocaleLowerCase('en-US')
  const shown = rows.filter(row => row.name.toLocaleLowerCase('en-US').includes(lower))
  const key = 'ech-directory-' + (/^[a-z0-9-]{1,40}$/.test(context.widgetKey ?? '') ? context.widgetKey : 'list')
  const path = context.pagePath && /^\/(?!\/)/.test(context.pagePath) ? safeUrl(context.pagePath) : '/chapters'
  const listId = key + '-list'
  const hidden = (row: Entry) => (lower && !row.name.toLocaleLowerCase('en-US').includes(lower) ? ' hidden' : '')
  const link = (row: Entry) =>
    `href="${attr(row.href)}"${row.external ? ' target="_blank" rel="noopener noreferrer"' : ''}`
  const markers = rows
    .flatMap(row => {
      const point = ECHELON_MAP_POINTS[row.slug]
      return point
        ? [
            `<a ${link(row)} data-chapter-marker="${attr(row.slug)}" data-chapter-name="${attr(row.name)}" aria-label="${attr(row.name)}"${hidden(row)}><title>${text(row.name)}</title><circle class="ech-map-hit" cx="${point.x}" cy="${point.y}" r="12"/><circle class="ech-map-dot" cx="${point.x}" cy="${point.y}" r="5.2275"/></a>`,
          ]
        : []
    })
    .join('')
  return `<div data-cms-echelon-directory><a class="ech-directory-list-link" href="#${listId}">View chapter list →</a><div class="ech-map-layout"><div class="ech-directory-map-wrap"><svg class="ech-directory-map" viewBox="-12.3 -6.15 615 436.65" preserveAspectRatio="xMinYMin" aria-label="Map of Echelon chapters"><image aria-hidden="true" href="/cms-themes/echelon/us-map.svg" x="-12.3" y="-6.15" width="615" height="436.65"/>${markers}</svg><div class="ech-directory-popup" hidden role="region" aria-label="Selected chapter"><button type="button" data-chapter-close aria-label="Close chapter details">×</button><strong data-chapter-popup-name></strong><a data-chapter-popup-link>Visit webpage →</a></div><p class="ech-small ech-muted">Select a marker for a chapter's webpage.</p></div><div class="ech-chapter-list" id="${listId}" tabindex="-1"><form action="${attr(path)}#${listId}" method="get"><label>Find a chapter by name<input type="search" name="q" maxlength="120" value="${attr(query)}" placeholder="Search chapters" data-chapter-search></label><button class="cms-button" type="submit" data-chapter-submit>Search</button></form><p class="ech-directory-status" role="status" aria-live="polite" data-chapter-status${shown.length && !query ? ' hidden' : ''}>${shown.length ? `${shown.length} ${shown.length === 1 ? 'chapter' : 'chapters'}${query ? ' found' : ''}` : rows.length ? 'No chapters match your search. Try another name.' : 'Chapter information is being updated. Contact Echelon to get connected.'}</p><ul class="ech-directory-entries">${rows.map(row => `<li data-chapter-entry="${attr(row.slug)}" data-chapter-name="${attr(row.name)}"${hidden(row)}><a class="ech-chapter" ${link(row)}><strong><i class="cms-material-symbols" aria-hidden="true">location_on</i>${text(row.label)}</strong><span>Visit webpage →</span></a></li>`).join('')}</ul></div></div></div>`
}
export const hasEchelonDirectory = (html: string) => renderedFeatures(html).chapterDirectory
