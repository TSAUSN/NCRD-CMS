import { parseHtml, type HtmlNode } from './source-html.ts'
import {
  storyTagIds,
  storyWidgetMaximum,
  storyWorldLimit,
  selectedStoryWidgetRows,
  type StoryCatalog,
} from '@cms/schema'
import { resolvedCollection } from './structured.ts'
import { escapeAttribute as attr, escapeText as text } from './escape.ts'
import map from './story-world-map.json' with { type: 'json' }
/** Geometry copied once from the approved stories-tool/worldmap-data.js.
 * Its source declaration is retained: Natural Earth1:110m, public domain. */
export type StoryWidgetContext = {
  editing?: boolean
  pagePath?: string
  path?: string
  query?: Record<string, string | undefined>
  fixedQuery?: Record<string, string>
}
export function storyWidgetQuery(params: URLSearchParams): Record<string, string> {
  return Object.fromEntries(
    [...params]
      .filter(([key, value]) => /^story[0-9]{1,3}_(region|sector|view|page)$/.test(key) && value.length <= 80)
      .slice(0, 40),
  )
}
export function storyWidgetHref(index: number, context: StoryWidgetContext, next: Record<string, string>): string {
  const path =
      context.path?.startsWith('/') && !context.path.startsWith('//') && !/[?#\\\s]/.test(context.path)
        ? context.path
        : '/',
    query = new URLSearchParams(context.fixedQuery)
  for (const [key, value] of Object.entries(context.query ?? {}))
    if (value !== undefined && /^story[0-9]{1,3}_(region|sector|view|page)$/.test(key) && value.length <= 80)
      query.set(key, value)
  for (const [key, value] of Object.entries(next)) {
    if (value) query.set('story' + index + '_' + key, value)
    else query.delete('story' + index + '_' + key)
  }
  return path + (query.size ? '?' + query.toString() : '') + '#s' + index
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
export function storyWorldValues(values: Record<string, unknown>, index: number, context: StoryWidgetContext = {}) {
  const list = resolvedCollection(values.stories),
    catalog = list?.readerKey === 'stories' ? list.storyCatalog : undefined,
    maximum = storyWidgetMaximum(catalog, context.pagePath ?? context.path ?? ''),
    pool = list?.entries ?? [],
    regions = catalog?.secondaryTags ?? [],
    counts = new Map(
      regions.map(region => [
        region.id,
        pool.filter(entry => {
          const v = record(entry.values)
          return v && storyTagIds(v, 'secondary').includes(region.id)
        }).length,
      ]),
    ),
    asked = context.query?.['story' + index + '_region'] ?? String(values.start_region ?? ''),
    selected = regions.find(region => region.id === asked && (counts.get(region.id) ?? 0) > 0),
    limit = storyWorldLimit(values.per_region),
    used = new Set<string>()
  const areaById = new Map(map.areas.map(area => [area.id, area])),
    mapped = regions.map(region => {
      const areas = region.areas.filter(area => areaById.has(area) && !used.has(area))
      areas.forEach(area => used.add(area))
      return { ...region, areas, count: counts.get(region.id) ?? 0 }
    }),
    active = mapped.filter(region => region.count > 0 && region.areas.length),
    activeAreas = new Set<string>(active.flatMap(region => region.areas))
  const href = (id: string) => storyWidgetHref(index, context, { region: id }),
    links = regions
      .map(region => {
        const count = counts.get(region.id) ?? 0,
          label = region.label + ' (' + count + ')'
        return count
          ? '<a data-cms-story-region="' +
              attr(region.id) +
              '" href="' +
              attr(href(region.id)) +
              '"' +
              (selected?.id === region.id ? ' aria-current="true"' : '') +
              '>' +
              text(label) +
              '</a>'
          : '<span aria-disabled="true">' + text(label) + '</span>'
      })
      .join(' ')
  const land = map.areas
      .filter(area => !activeAreas.has(area.id))
      .map(area => '<path class="cms-story-map-land" d="' + attr(area.d) + '"></path>')
      .join(''),
    shapes = active
      .map(region => {
        const at = areaById.get(region.areas.some(area => area === region.id) ? region.id : region.areas[0]!)!,
          label = region.label + ': ' + region.count + ' ' + (region.count === 1 ? 'story' : 'stories')
        return (
          '<a class="cms-story-map-region" tabindex="0" data-cms-story-region="' +
          attr(region.id) +
          '" href="' +
          attr(href(region.id)) +
          '" aria-label="' +
          attr(label) +
          '"' +
          (selected?.id === region.id ? ' aria-current="true"' : '') +
          '><title>' +
          text(label) +
          '</title>' +
          region.areas.map(id => '<path d="' + attr(areaById.get(id)!.d) + '"></path>').join('') +
          '<g class="cms-story-map-pin" aria-hidden="true"><circle cx="' +
          at.x +
          '" cy="' +
          at.y +
          '" r="16"></circle><text x="' +
          at.x +
          '" y="' +
          at.y +
          '">' +
          region.count +
          '</text></g></a>'
        )
      })
      .join(''),
    svg =
      '<svg class="cms-story-map" viewBox="0 0 ' +
      map.width +
      ' ' +
      map.height +
      '" role="group" aria-label="World map: choose a region to see its stories">' +
      land +
      shapes +
      '</svg>'
  return {
    catalog,
    active: selected?.id ?? '',
    map: svg,
    values: {
      ...values,
      region_heading: selected ? 'Our Stories from ' + selected.label : '',
      region_links: links,
      hint: !catalog
        ? context.editing
          ? 'Ask a Site admin to save and publish the Story tags and map areas.'
          : 'Stories will appear here soon.'
        : !pool.length
          ? context.editing
            ? 'No current stories match this section. Add or tag a story, then review and publish.'
            : 'No current stories are available. Please check back soon.'
          : selected
            ? ''
            : 'Select a region on the map to see our stories.',
      empty_line: selected ? 'No stories match this region.' : '',
      stories: list
        ? {
            ...list,
            entries: selected ? selectedStoryWidgetRows(pool, 'map', selected.id, Math.min(limit, maximum)) : [],
          }
        : values.stories,
    },
  }
}
export function storyCardLabels(body: string, catalog: StoryCatalog | undefined): string {
  if (!catalog) return body
  return body
    .replaceAll(
      '<b>Project sector</b>',
      () => '<b>' + text(catalog.mainLabel === 'Project Sectors' ? 'Project sector' : catalog.mainLabel) + '</b>',
    )
    .replaceAll(
      '<b>Region</b>',
      () => '<b>' + text(catalog.secondaryLabel === 'Regions' ? 'Region' : catalog.secondaryLabel) + '</b>',
    )
}
export const STORY_WORLD_CSS = `
#cms-main .cms-section--core-story-world{scroll-margin-top:120px}
#cms-main .core-story-world{padding-block:24px}
#cms-main .core-world-heading{text-align:center;margin:0 0 24px}
#cms-main .core-world-panel{background:white;padding:32px;border-radius:20px;min-width:0}
#cms-main .core-world-results{margin-top:24px;padding:0;background:white;min-width:0;scroll-margin-top:100px}
#cms-main .core-world-results>h3{text-align:center;margin:0 0 24px;font-size:24px;font-family:var(--font-heading);font-weight:400}
#cms-main .cms-story-map{display:block;width:100%;height:auto;max-width:1100px;margin:0 auto;overflow:visible}
#cms-main .cms-story-map-land{fill:#e2e2e2;stroke:white;stroke-width:.5}
#cms-main .cms-story-map-region{cursor:pointer;outline:none}
#cms-main .cms-story-map-region path{fill:#f4a7ad;stroke:white;stroke-width:.5;transition:fill .15s}
#cms-main .cms-story-map-region:hover path,#cms-main .cms-story-map-region:focus-visible path{fill:#f06470}
#cms-main .cms-story-map-region:focus-visible path{stroke:#2a313f;stroke-width:1.2}
#cms-main .cms-story-map-region[aria-current=true] path{fill:#ed1c2b}
#cms-main .cms-story-map-pin{transform-box:fill-box;transform-origin:center;pointer-events:none}
#cms-main .cms-story-map-pin circle{fill:white;stroke:#ed1c2b;stroke-width:2.5}
#cms-main .cms-story-map-pin text{fill:#c4121f;font:700 17px/1 system-ui,sans-serif;text-anchor:middle;dominant-baseline:central}
#cms-main .cms-story-map-region[aria-current=true] circle{fill:#c4121f;stroke:white}
#cms-main .cms-story-map-region[aria-current=true] text{fill:white}
#cms-main .core-world-regions{display:flex;justify-content:center;flex-wrap:wrap;gap:8px 16px;margin:16px 0 0;font-size:14px}
#cms-main .core-world-regions[hidden]{display:none}
#cms-main .core-world-regions [aria-current=true]{font-weight:700}
#cms-main .core-world-regions [aria-disabled=true]{color:#6b6b70}
#cms-main .core-world-hint{text-align:center;margin:24px 0 0;color:#6b6b70}
#cms-main .cms-story-widget-status{margin:0 0 16px;padding:12px 16px;background:white;border-radius:12px;scroll-margin-top:120px}
#cms-main .cms-story-widget-status button{font:inherit;margin-inline:8px}
#cms-main .core-world-hint:empty,#cms-main .core-world-empty:empty{display:none}
@media(max-width:600px){#cms-main .core-world-panel{padding:20px;border-radius:12px}#cms-main .cms-story-map-pin{transform:scale(2)}}
@media(prefers-reduced-motion:reduce){#cms-main .cms-story-map-region path{transition:none}}
`

/** Only the code-owned World section calls this; authored map/HTML fields are ignored. */
export function renderStoryWorld(body: string, index: number, model: ReturnType<typeof storyWorldValues>): string {
  const parsed = parseHtml(body, { locations: true })
  if (!parsed.ok) return body
  const edits: { start: number; end: number; value: string }[] = []
  function walk(nodes: HtmlNode[]) {
    for (const node of nodes)
      if (node.kind === 'element') {
        const classes = node.attributes.find(a => a.name === 'class')?.value.split(/\s+/) ?? [],
          source = node.source
        if (source && (classes.includes('core-story-world') || classes.includes('core-story-split')))
          edits.push({
            start: source.start + 1 + node.tag.length,
            end: source.start + 1 + node.tag.length,
            value: ' data-cms-stories-widget="' + index + '"',
          })
        if (source && classes.includes('core-world-regions'))
          edits.push({ start: source.openEnd, end: source.closeStart, value: model.values.region_links })
        if (source && classes.includes('core-world-hint'))
          edits.push({ start: source.openEnd, end: source.closeStart, value: text(model.values.hint) })
        if (source && classes.includes('core-world-region-heading'))
          edits.push({ start: source.openEnd, end: source.closeStart, value: text(model.values.region_heading) })
        if (source && classes.includes('core-world-map'))
          edits.push({ start: source.openEnd, end: source.closeStart, value: model.map })
        if (source && classes.includes('core-world-results') && !model.active)
          edits.push({ start: source.start, end: source.end, value: '' })
        else walk(node.children)
      }
  }
  walk(parsed.nodes)
  for (const edit of edits.sort((a, b) => b.start - a.start))
    body = body.slice(0, edit.start) + edit.value + body.slice(edit.end)
  return storyCardLabels(body, model.catalog)
}
