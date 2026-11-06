import type { NewsroomQuery } from './newsroom.ts'
import { resolvedCollection } from './structured.ts'
import {
  storyTagIds,
  storyWidgetMaximum,
  storySplitPageSize,
  orderedStoryWidgetRows,
  selectedStoryWidgetRows,
} from '@cms/schema'
import { storyWorldValues, renderStoryWorld, storyWidgetHref, type StoryWidgetContext } from './story-world.ts'
import { escapeAttribute as attr, escapeText as text } from './escape.ts'
import { parseHtml, type HtmlNode } from './source-html.ts'
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
export function storySplitValues(
  values: Record<string, unknown>,
  index: number,
  context: StoryWidgetContext = {},
  legacy: NewsroomQuery = {},
) {
  const list = resolvedCollection(values.stories),
    catalog = list?.readerKey === 'stories' ? list.storyCatalog : undefined,
    search = (legacy.q ?? '').trim().slice(0, 120),
    query = { ...context.query },
    prefix = 'story' + index + '_',
    scoped = Object.keys(query).some(key => key.startsWith(prefix)),
    legacyMain = catalog?.mainTags.find(tag => tag.id === legacy.sector),
    legacyRegion = catalog?.secondaryTags.find(tag => tag.id === legacy.region)
  if (!scoped) {
    if (legacyMain) query[prefix + 'sector'] = legacyMain.id
    if (legacyRegion) query[prefix + 'region'] = legacyRegion.id
    const view = legacyRegion ? 'map' : legacyMain ? 'sectors' : legacy.view === 'regions' ? 'map' : legacy.view
    if (view && ['recent', 'sectors', 'map'].includes(view)) query[prefix + 'view'] = view
    if (legacy.page && /^[1-9]\d{0,3}$/.test(legacy.page)) query[prefix + 'page'] = legacy.page
  }
  context = { ...context, query, ...(search ? { fixedQuery: { ...context.fixedQuery, q: search } } : {}) }
  const pool = orderedStoryWidgetRows(
      [...(list?.entries ?? [])].filter(entry => {
        const v = record(entry.values)
        return (
          (!search ||
            [v.title, v.summary].some(
              value =>
                typeof value === 'string' &&
                value.toLocaleLowerCase('en-US').includes(search.toLocaleLowerCase('en-US')),
            )) &&
          (!(!scoped && legacyMain && legacyRegion) || storyTagIds(v, 'main').includes(legacyMain!.id))
        )
      }),
    ),
    source = list ? { ...list, entries: pool } : values.stories
  const fallback = ['recent', 'sectors', 'map'].includes(String(values.start_view))
      ? String(values.start_view)
      : 'recent',
    asked = context.query?.['story' + index + '_view'] ?? fallback,
    view = ['recent', 'sectors', 'map'].includes(asked) ? asked : fallback,
    main = catalog?.mainTags ?? [],
    sectorId = context.query?.['story' + index + '_sector'] ?? '',
    sector = main.find(
      tag => tag.id === sectorId && pool.some(entry => storyTagIds(record(entry.values), 'main').includes(tag.id)),
    ),
    size = storySplitPageSize(values.page_size),
    max = storyWidgetMaximum(catalog, context.pagePath ?? context.path ?? ''),
    total = Math.min(pool.length, max),
    rawPage = context.query?.['story' + index + '_page'] ?? '1',
    page = Math.min(/^[1-9]\d{0,2}$/.test(rawPage) ? Number(rawPage) : 1, Math.max(1, Math.ceil(total / size))),
    shown = Math.min(total, page * size)
  const base = storyWorldValues({ ...values, stories: source, start_region: '', per_region: '200' }, index, context),
    entries =
      view === 'map'
        ? (resolvedCollection(base.values.stories)?.entries ?? [])
        : view === 'sectors'
          ? sector
            ? selectedStoryWidgetRows(pool, 'sectors', sector.id, max)
            : []
          : selectedStoryWidgetRows(pool, 'recent', '', shown, max !== 6 && catalog?.newsroomOrder !== false),
    heading =
      view === 'map'
        ? base.values.region_heading
        : view === 'sectors' && sector
          ? 'Our Stories in ' + sector.label
          : '',
    active = view === 'map' ? base.active : view === 'sectors' ? (sector?.id ?? '') : 'recent',
    hint =
      !catalog || !pool.length
        ? base.values.hint
        : view === 'map'
          ? base.values.hint
          : view === 'sectors' && !sector
            ? 'Choose a ' +
              (catalog.mainLabel === 'Project Sectors' ? 'project sector' : catalog.mainLabel.toLowerCase()) +
              ' to see its stories.'
            : ''
  const href = (next: Record<string, string>) => storyWidgetHref(index, context, next),
    views = [
      ['recent', 'Recently Published'],
      [
        'sectors',
        catalog?.mainLabel === 'Project Sectors' ? 'By Project Sector' : 'By ' + (catalog?.mainLabel ?? 'main tag'),
      ],
      ['map', 'By Map'],
    ],
    tabs =
      views
        .map(
          ([key, label]) =>
            '<a id="story' +
            index +
            '-view-' +
            key +
            '" data-cms-story-nav="view" href="' +
            attr(href({ view: key!, page: '' })) +
            '"' +
            (view === key ? ' aria-current="page"' : '') +
            '>' +
            text(label!) +
            '</a>',
        )
        .join('') + '<span class="core-split-ink" aria-hidden="true"></span>'
  const sectors = main
    .map(tag => ({
      ...tag,
      count: pool.filter(entry => storyTagIds(record(entry.values), 'main').includes(tag.id)).length,
    }))
    .filter(tag => tag.count > 0)
    .map(
      tag =>
        '<a class="core-split-sector" data-cms-story-nav="sector" href="' +
        attr(href({ view: 'sectors', sector: tag.id, page: '' })) +
        '"' +
        (sector?.id === tag.id ? ' aria-current="true"' : '') +
        '><b>' +
        text(tag.label) +
        '</b><span>' +
        tag.count +
        ' ' +
        (tag.count === 1 ? 'story' : 'stories') +
        '</span></a>',
    )
    .join('')
  const tools = [
      ['themes', catalog?.mainLabel === 'Project Sectors' ? 'Project Sector' : (catalog?.mainLabel ?? 'Main tags')],
      ['regions', catalog?.secondaryLabel === 'Regions' ? 'Region' : (catalog?.secondaryLabel ?? 'Secondary tags')],
    ]
      .map(
        ([key, label]) =>
          '<button type="button" role="switch" aria-checked="true" data-cms-story-tag="' +
          key +
          '"><span aria-hidden="true" class="core-split-toggle"></span>' +
          text(label!) +
          '</button>',
      )
      .join(''),
    more =
      view === 'recent' && pool.length
        ? '<p>Showing ' +
          shown +
          ' of ' +
          total +
          ' stories</p>' +
          (shown < total
            ? '<a class="cms-button" data-cms-story-nav="more" href="' +
              attr(href({ view: 'recent', page: String(page + 1) })) +
              '">Show more stories</a>'
            : '')
        : ''
  const clean = {
      ...context,
      fixedQuery: Object.fromEntries(Object.entries(context.fixedQuery ?? {}).filter(([key]) => key !== 'q')),
    },
    combined = !scoped && legacyMain && legacyRegion,
    notice = [
      search ? 'Stories matching “' + search + '”' : '',
      combined ? 'Stories in ' + legacyMain!.label + ' and ' + legacyRegion!.label : '',
    ]
      .filter(Boolean)
      .join(' · '),
    searchNotice = notice
      ? '<p class="core-split-search-note">' +
        text(notice) +
        '. <a href="' +
        attr(storyWidgetHref(index, clean, { view: 'recent', sector: '', region: '', page: '' })) +
        '">Show all stories</a></p>'
      : ''
  return {
    ...base,
    active,
    view,
    shown,
    tabs,
    sectors,
    tools,
    more,
    searchNotice,
    values: {
      ...base.values,
      ...values,
      region_heading: heading,
      hint,
      stories: list ? { ...list, entries } : values.stories,
    },
  }
}
export function renderStorySplit(body: string, index: number, model: ReturnType<typeof storySplitValues>): string {
  body = renderStoryWorld(body, index, model)
  const parsed = parseHtml(body, { locations: true })
  if (!parsed.ok) return body
  const edits: { start: number; end: number; value: string }[] = []
  function walk(nodes: HtmlNode[]) {
    for (const node of nodes)
      if (node.kind === 'element') {
        const classes = node.attributes.find(a => a.name === 'class')?.value.split(/\s+/) ?? [],
          s = node.source
        if (!s) continue
        if (classes.includes('core-story-split'))
          edits.push({
            start: s.start + 1 + node.tag.length,
            end: s.start + 1 + node.tag.length,
            value:
              ' data-cms-story-kind="split" data-cms-story-view="' +
              attr(model.view) +
              '" data-cms-story-shown="' +
              model.shown +
              '"',
          })
        if (classes.includes('core-split-sectors') && model.view === 'sectors' && model.sectors) {
          const prompt =
            'Choose a ' +
            (model.catalog?.mainLabel === 'Project Sectors'
              ? 'project sector'
              : (model.catalog?.mainLabel.toLowerCase() ?? 'main tag')) +
            ' to see its stories.'
          edits.push({
            start: s.start,
            end: s.end,
            value:
              '<p class="core-split-prompt">' +
              text(prompt) +
              '</p><div class="core-split-sectors">' +
              model.sectors +
              '</div>',
          })
          continue
        }
        if (classes.includes('core-world-hint') && model.view === 'sectors' && model.sectors) {
          edits.push({ start: s.start, end: s.end, value: '' })
          continue
        }
        if (classes.includes('core-split-views') && model.searchNotice)
          edits.push({ start: s.start, end: s.start, value: model.searchNotice })
        const generated = classes.includes('core-split-views')
          ? model.tabs
          : classes.includes('core-split-sectors')
            ? model.view === 'sectors'
              ? model.sectors
              : ''
            : classes.includes('core-split-tools')
              ? model.view === 'recent'
                ? '<span>Show tags</span>' + model.tools
                : ''
              : classes.includes('core-split-more')
                ? model.more
                : null
        if (generated !== null) {
          if (!generated) edits.push({ start: s.start, end: s.end, value: '' })
          else edits.push({ start: s.openEnd, end: s.closeStart, value: generated })
          continue
        }
        if (classes.includes('core-split-map') && model.view !== 'map') {
          edits.push({ start: s.start, end: s.end, value: '' })
          continue
        }
        if (classes.includes('core-split-stage'))
          edits.push({
            start: s.start + 1 + node.tag.length,
            end: s.start + 1 + node.tag.length,
            value: ' id="story' + index + '-panel"',
          })
        if (classes.includes('core-world-region-heading') && !model.values.region_heading) {
          edits.push({ start: s.start, end: s.end, value: '' })
          continue
        }
        walk(node.children)
      }
  }
  walk(parsed.nodes)
  for (const edit of edits.sort((a, b) => b.start - a.start))
    body = body.slice(0, edit.start) + edit.value + body.slice(edit.end)
  return body
}
export const STORY_SPLIT_CSS = `
#cms-main .core-story-split{padding-block:24px}
#cms-main .core-split-intro{text-align:center;margin:24px auto 24px;max-width:860px}
#cms-main .core-split-intro h1{margin:0 0 18px;font-size:calc(1.375rem + 1.5vw);font-weight:400;line-height:1.2}
#cms-main .core-split-intro p{font-size:18px;color:#6b6b70;line-height:1.65;margin:0}
#cms-main .core-split-intro p:empty{display:none}
#cms-main .core-split-search-note{text-align:center;margin:0 0 16px}
#cms-main .core-split-views{position:relative;display:flex;justify-content:center;gap:28px;border-bottom:1px solid #dedee1;margin:0 0 32px}
#cms-main .core-split-views>a{position:relative;display:inline-flex;align-items:center;justify-content:center;padding:16px 8px 17px;min-height:44px;text-decoration:none;font:600 15px/1.3 var(--font-body);color:#6b6b70;text-align:center;border-bottom:3px solid transparent}
#cms-main .core-split-views>a[aria-current=page]{color:#1d1d1f;border-bottom-color:#ed1c2b}
#cms-main [data-cms-stories-ready] .core-split-views>a{border-bottom-color:transparent}
#cms-main .core-split-views>a:focus-visible{outline:2px solid #2a313f;outline-offset:2px}
#cms-main .core-split-ink{position:absolute;bottom:0;height:3px;background:#ed1c2b;pointer-events:none;display:none}
#cms-main [data-cms-stories-ready] .core-split-ink{display:block}
#cms-main .core-split-stage{position:relative;min-width:0;scroll-margin-top:100px}
#cms-main .core-split-prompt{text-align:center;color:#6b6b70;margin:0 0 22px}
#cms-main .core-split-sectors{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:0 0 24px}
#cms-main .core-split-sector{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-height:100px;padding:20px 18px 18px;text-align:left;background:white;border:1px solid #e1e1e1;border-radius:4px;color:#1d1d1f;text-decoration:none;transition:border-color .25s,box-shadow .25s}
#cms-main .core-split-sector:before{content:'';position:absolute;left:-1px;right:-1px;top:-1px;height:3px;background:#ed1c2b;transform:scaleX(0);transform-origin:left;transition:transform .35s ease}
#cms-main .core-split-sector:hover{border-color:#cdcdcd;box-shadow:0 6px 20px rgba(0,0,0,.06)}
#cms-main .core-split-sector:hover:before,#cms-main .core-split-sector[aria-current=true]:before{transform:scaleX(1)}
#cms-main .core-split-sector[aria-current=true]{border-color:#ed1c2b}
#cms-main .core-split-sector:focus-visible{outline:2px solid #2a313f;outline-offset:2px}
#cms-main .core-split-sector b{font-size:16px;line-height:1.3}
#cms-main .core-split-sector span{font-size:13px;color:#6b6b70}
#cms-main .core-split-tools{display:none;justify-content:flex-end;align-items:center;flex-wrap:wrap;gap:6px 18px;margin:-8px 0 26px}
#cms-main [data-cms-stories-ready] .core-split-tools{display:flex}
#cms-main .core-split-tools>span{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#727173}
#cms-main .core-split-tools>button{display:inline-flex;align-items:center;gap:9px;padding:4px 0;background:none;border:0;font:inherit;font-size:14px;color:#1d1d1f;cursor:pointer;min-height:44px}
#cms-main .core-split-tools>button:focus-visible{outline:2px solid #2a313f;outline-offset:2px}
#cms-main .core-split-toggle{position:relative;flex:none;width:34px;height:20px;border-radius:10px;background:#c9c9cd;transition:background .25s}
#cms-main .core-split-toggle:after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:white;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .25s}
#cms-main .core-split-tools [aria-checked=true] .core-split-toggle{background:#ed1c2b}
#cms-main .core-split-tools [aria-checked=true] .core-split-toggle:after{transform:translateX(14px)}
#cms-main .core-split-hide-themes .core-story-tags>b:has(+.core-story-sectors),#cms-main .core-split-hide-themes .core-story-sectors,#cms-main .core-split-hide-regions .core-story-tags>b:has(+.core-story-region-pill),#cms-main .core-split-hide-regions .core-story-region-pill,#cms-main .core-split-hide-themes.core-split-hide-regions .core-story-tags{display:none}
#cms-main .core-split-more{text-align:center;padding:16px 0 8px}
#cms-main .core-split-more p{margin:0 0 14px;color:#6b6b70;font-size:14px}
@media(min-width:1200px){#cms-main .core-split-intro h1{font-size:2.5rem}}
@media(max-width:1199px){#cms-main .core-split-sectors{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:767px){#cms-main .core-split-intro{margin-top:16px}#cms-main .core-split-sectors{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}#cms-main .core-split-sector{min-height:88px;padding:16px 14px}#cms-main .core-split-sector b{font-size:15px}#cms-main .core-split-intro p{font-size:16px}#cms-main .core-split-search-note{text-align:center;margin:0 0 16px}
#cms-main .core-split-views{gap:8px}#cms-main .core-split-views>a{font-size:13px;padding:12px 6px 13px;flex:1}}
@media(prefers-reduced-motion:reduce){#cms-main .core-split-sector,#cms-main .core-split-sector:before,#cms-main .core-split-toggle,#cms-main .core-split-toggle:after{transition:none}}
`
