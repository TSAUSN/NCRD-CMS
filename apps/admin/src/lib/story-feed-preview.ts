import { orderedNewsroomStories, STORY_WIDGET_SOURCE_LIMIT } from '@cms/schema'
import { asUser } from '@cms/platform'
import { escapeText, escapeAttribute, renderPage, type RenderManifest, type SectionDefView } from '@cms/renderer'
import { storyCatalog, storyAllowedInFeeds, storyDateInFeed, storyTagIds, type SlotDef } from '@cms/schema'
import { readSitePreview } from './site-preview.ts'
import { getStoryListState } from './stories-workspace.ts'
import { filterStoryList, storyListQuery, type StoryListFilters } from './story-list.ts'
import type { WorldChoice, SplitChoice } from './story-widget-choice.ts'
import { worldChoiceQuery, splitChoiceQuery } from './story-widget-choice.ts'
import { SCRIPTLESS_RENDER_OPTIONS } from './scriptless-preview.ts'
const fields = [
  { key: 'photo', label: 'Photo', type: 'image', required: false },
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'summary', label: 'Description', type: 'text', required: false },
  { key: 'published_date', label: 'Date', type: 'date', required: true },
  { key: 'region_label', label: 'Region', type: 'text', required: false },
  { key: 'sector_links', label: 'Tags', type: 'richtext', required: false },
  { key: 'photo_note', label: 'Photo note', type: 'text', required: false },
  { key: 'story_url', label: 'Read story', type: 'url', required: true },
] as const
/** A private view projection contains card fields only, never complete articles. */
export async function buildStoryFeedPreview(
  userId: string,
  siteId: string,
  slug: string,
  filters: StoryListFilters,
  pageNumber = 1,
  world?: WorldChoice,
  widgetQuery: Record<string, string | undefined> = {},
  split?: SplitChoice,
) {
  const widget = Boolean(world || split)
  const state = await getStoryListState(userId, siteId, slug)
  if (!state) return null
  return asUser({ userId }, async client => {
    const preview = await readSitePreview(client, siteId, 'draft')
    if (!preview) return null
    const head = (
      await client.query('SELECT draft_schema_version_id AS id FROM collections WHERE id=$1 AND site_id=$2', [
        state.collectionId,
        siteId,
      ])
    ).rows[0]
    if (!head?.id) return null
    const definitions = (
        await client.query<SectionDefView & { slots: SlotDef[] }>(
          `SELECT DISTINCT ON(d.slug) d.id AS section_def_id,d.slug,v.version,v.compiled_ast,v.compiled_css AS css,v.slots,v.sanitizer_policy_version,v.css_policy_version,v.definition_kind,v.structured_doc,v.structured_schema_version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.scope='global' AND d.status='active' AND d.slug=ANY($1::text[]) ORDER BY d.slug,v.version DESC`,
          [
            [
              'core-stories',
              'core-text-block',
              ...(world ? ['core-story-world'] : []),
              ...(split ? ['core-story-split'] : []),
            ],
          ],
        )
      ).rows,
      feed = definitions.find(d => d.slug === 'core-stories'),
      notice = definitions.find(d => d.slug === 'core-text-block')
    if (!feed || !notice) return null
    const paths = (
        await client.query(
          'SELECT slug,draft_version_id FROM pages WHERE site_id=$1 AND archived_at IS NULL AND draft_version_id IS NOT NULL',
          [siteId],
        )
      ).rows,
      map = new Map(
        paths.map(p => ['/' + p.slug, '/preview/' + p.draft_version_id + '?visit=1&site=draft&lists=draft']),
      )
    const matching = filterStoryList(state.rows, filters, state.settings, state.publishedSettings),
      eligible = (filters.main || filters.secondary || widget ? matching : orderedNewsroomStories(matching)).filter(
        row => storyAllowedInFeeds(row.values, state.settings) && storyDateInFeed(row.values.published_date),
      ),
      pages = Math.max(1, Math.ceil(eligible.length / 24)),
      page = Math.min(Math.max(1, pageNumber), pages),
      chosen = world
        ? eligible
            .filter(row => !world.main.length || storyTagIds(row.values, 'main').some(id => world.main.includes(id)))
            .slice(0, STORY_WIDGET_SOURCE_LIMIT)
        : split
          ? eligible.slice(0, STORY_WIDGET_SOURCE_LIMIT)
          : eligible.slice((page - 1) * 24, page * 24)
    const entries = chosen.map(row => {
      const v = row.values,
        main = storyTagIds(v, 'main'),
        secondary = storyTagIds(v, 'secondary'),
        photo = v.photo && typeof v.photo === 'object' && !Array.isArray(v.photo) ? v.photo : null
      return {
        id: row.id,
        stableKey: row.stableKey,
        schemaVersionId: head.id,
        values: {
          ...(typeof v.newsroom_rank === 'number' ? { newsroom_rank: v.newsroom_rank } : {}),
          ...(widget ? { tags: main.join(','), regions: secondary.join(',') } : {}),
          title: String(v.title ?? ''),
          summary: String(v.summary ?? ''),
          published_date: String(v.published_date ?? ''),
          ...(photo ? { photo } : {}),
          photo_note: String(v.photo_note ?? ''),
          region_label: state.settings.secondaryTags
            .filter(t => secondary.includes(t.id))
            .map(t => t.label)
            .join(', '),
          sector_links: state.settings.mainTags
            .filter(t => main.includes(t.id))
            .map(t => {
              const href = map.get('/ways-we-help/' + t.id)
              return href
                ? '<a href="' + escapeAttribute(href) + '">' + escapeText(t.label) + '</a>'
                : escapeText(t.label)
            })
            .join(' '),
          story_url: map.get(String(v.story_url ?? '')) ?? String(v.story_url ?? ''),
        },
      }
    })
    const list = {
      ...(state.ready ? { storyCatalog: storyCatalog(state.settings) } : {}),
      kind: 'collection',
      collectionId: state.collectionId,
      readerKey: 'stories',
      publishedSchemaVersionId: head.id,
      publishedSchemaRevision: state.catalogRevision,
      publishedEntryRevision: state.entryRevision,
      schemas: [
        {
          id: head.id,
          revision: state.catalogRevision,
          fields: [
            ...fields,
            { key: 'newsroom_rank', label: 'Newsroom order', type: 'number', required: false },
            ...(widget
              ? [
                  { key: 'tags', label: 'Main tags', type: 'text', required: false },
                  { key: 'regions', label: 'Secondary tags', type: 'text', required: false },
                ]
              : []),
          ],
        },
      ],
      entries,
    }
    const status = {
        all: 'All stories',
        review: 'Needs review',
        untagged: 'Missing tags',
        live: 'Live',
        hidden: 'Hidden',
        removed: 'No longer in feed',
      }[filters.status],
      labels = [
        status,
        filters.q ? 'Search: ' + filters.q : '',
        filters.main
          ? filters.main === '__none'
            ? 'No ' + state.settings.mainLabel
            : (state.settings.mainTags.find(t => t.id === filters.main)?.label ?? 'Unavailable main tag')
          : '',
        filters.secondary
          ? filters.secondary === '__none'
            ? 'No ' + state.settings.secondaryLabel
            : (state.settings.secondaryTags.find(t => t.id === filters.secondary)?.label ?? 'Unavailable secondary tag')
          : '',
      ].filter(Boolean),
      query = storyListQuery(filters),
      back = '/sites/' + siteId + '/stories' + (query.size ? '?' + query.toString() : '')
    const link = (number: number, label: string) => {
        const q = new URLSearchParams(query)
        if (number > 1) q.set('page', String(number))
        return (
          '<a href="' +
          escapeAttribute('/preview/stories/' + siteId + (q.size ? '?' + q.toString() : '')) +
          '">' +
          label +
          '</a>'
        )
      },
      paging = [page > 1 ? link(page - 1, 'Previous stories') : '', page < pages ? link(page + 1, 'More stories') : '']
        .filter(Boolean)
        .join(' · ')
    const message =
      '<p>Private draft preview. ' +
      matching.length +
      ' ' +
      (matching.length === 1 ? 'story matches' : 'stories match') +
      ' the list filters; ' +
      eligible.length +
      ' ' +
      (eligible.length === 1 ? 'is' : 'are') +
      ' eligible for feeds. Showing ' +
      chosen.length +
      '. ' +
      escapeText(labels.join(' · ')) +
      '.</p><p>Saved drafts are shown. Hidden, removed and older stories stay out of feeds; unreviewed stories follow this site’s setting. This preview does not publish.</p><p><a href="' +
      escapeAttribute(back) +
      '">Back to Stories</a>' +
      (paging ? ' · ' + paging : '') +
      '</p>'
    const instance = (def: SectionDefView, values: Record<string, unknown>) => ({
      def,
      instance: { section_def_id: def.section_def_id, section_def_version: def.version, values },
    })
    const manifest: RenderManifest = {
      page: { id: 'story-preview', version_id: 'story-preview', title: 'Private Story preview', path: '/' },
      meta: { noindex: true },
      fonts: preview.fonts,
      sections: [
        instance(notice, { heading: 'Private Story preview', body: message }),
        instance(feed, {
          heading: 'Stories',
          stories: list,
          empty_mode: 'line',
          empty_line: 'No feed stories match these filters.',
          newsroom: { url: '', label: '' },
        }),
      ],
    }
    if (world) {
      const def = definitions.find(d => d.slug === 'core-story-world')
      if (!def) return null
      manifest.sections = [
        instance(def, { heading: world.heading, start_region: world.region, per_region: world.limit, stories: list }),
      ]
    }
    if (split) {
      const def = definitions.find(d => d.slug === 'core-story-split')
      if (!def) return null
      manifest.sections = [
        instance(def, {
          heading: split.heading,
          introduction: split.introduction,
          start_view: split.first,
          page_size: split.size,
          stories: list,
        }),
      ]
    }
    return renderPage({
      manifest,
      shell: preview.shell,
      navigationPaths: preview.navigationPaths,
      isStaging: true,
      options: {
        ...SCRIPTLESS_RENDER_OPTIONS,
        siteFiles: false,
        previewRuntime: false,
        ...(widget
          ? {
              siteFrame: false,
              storyWidgets: {
                path: '/preview/stories/' + siteId,
                fixedQuery: Object.fromEntries(world ? worldChoiceQuery(world) : splitChoiceQuery(split!)),
                query: widgetQuery,
              },
            }
          : {}),
      },
    }).html
  })
}
