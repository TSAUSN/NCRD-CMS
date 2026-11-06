import { isDeepStrictEqual } from 'node:util'
import type { Queryable } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { CollectionModel } from '@cms/schema'
import { WorldChoice, SplitChoice } from './story-widget-choice.ts'
import { corePageDefinitions } from './core-pages.ts'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export async function storyWidgetPages(client: Queryable, siteId: string) {
  if (!(await client.query('SELECT app.can_administer_site($1) AS allowed', [siteId])).rows[0]?.allowed) return []
  return (
    await client.query<{ id: string; title: string; slug: string; revision: string }>(
      `SELECT p.id,p.title,p.slug,p.revision FROM pages p WHERE p.site_id=$1 AND p.archived_at IS NULL AND p.draft_version_id IS NOT NULL AND p.slug NOT LIKE 'stories/%' AND NOT EXISTS(SELECT 1 FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.site_id=p.site_id AND v.config->>'pageId'=p.id::text) ORDER BY lower(p.title),p.id`,
      [siteId],
    )
  ).rows
}
/** One ordinary optimistic page save; no draft is created until confirmed. */
async function addStoryWidgetToPage(
  client: Queryable,
  siteId: string,
  pageId: string,
  revision: string,
  input: unknown,
  kind: 'world' | 'split',
) {
  const label = kind === 'world' ? 'World View' : 'Split View'
  if (!uuid.test(pageId) || !/^\d+$/.test(revision))
    throw new DomainError('invalid_state', 'Choose a page and try again.')
  if (!(await client.query('SELECT app.can_administer_site($1) AS allowed', [siteId])).rows[0]?.allowed)
    throw new DomainError('not_authorized', 'A Site admin can add sections to pages.')
  const world = kind === 'world' ? WorldChoice.parse(input) : null,
    split = kind === 'split' ? SplitChoice.parse(input) : null,
    page = (
      await client.query(
        `SELECT p.revision,v.id,v.content,v.meta,v.note,v.author_id=app.current_user_id() AS own FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1 AND p.site_id=$2 AND p.archived_at IS NULL`,
        [pageId, siteId],
      )
    ).rows[0]
  if (!page) throw new DomainError('not_found', 'This page is unavailable.')
  if (!(await storyWidgetPages(client, siteId)).some(p => p.id === pageId))
    throw new DomainError('invalid_state', 'Stories are not available on chapter pages.')
  const list = (
    await client.query(
      `SELECT v.fields,v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.site_id=$1 AND c.reader_key='stories' ORDER BY c.created_at,c.id LIMIT 1`,
      [siteId],
    )
  ).rows[0]
  if (!list) throw new DomainError('invalid_state', 'Turn on Stories before adding ' + label + '.')
  const model = CollectionModel.safeParse(list.fields),
    settings = (model.success ? model.data : CollectionModel.parse({ fields: list.fields, presentation: list.sort }))
      .presentation.stories
  if (
    !settings ||
    (world &&
      ((world.region && !settings.secondaryTags.some(t => t.id === world.region)) ||
        world.main.some(id => !settings.mainTags.some(t => t.id === id))))
  )
    throw new DomainError('invalid_state', 'The Story tags changed. Reload before adding this section.')
  const def = (await corePageDefinitions(client)).find(d => d.slug === 'core-story-' + kind)
  if (!def)
    throw new DomainError('invalid_state', label + ' is unavailable. Ask a Super admin to check the section library.')
  if (!Array.isArray(page.content))
    throw new DomainError('invalid_state', 'This page could not be opened. Saved content is unchanged.')
  const selection = {
    readerKey: 'stories',
    selection: {
      mode: 'automatic',
      order: 'newest',
      dateField: 'published_date',
      maxAgeMonths: 13,
      limit: 200,
      ...(world?.main.length ? { storyTags: { main: world.main, secondary: [] } } : {}),
    },
  }
  const content = page.content,
    section = {
      section_def_id: def.id,
      section_def_version: def.version,
      label,
      hidden: false,
      hidden_at: [],
      values: world
        ? { heading: world.heading, start_region: world.region, per_region: world.limit, stories: selection }
        : {
            heading: split!.heading,
            introduction: split!.introduction,
            start_view: split!.first,
            page_size: split!.size,
            stories: selection,
          },
    }

  if (String(page.revision) !== revision) {
    const before = (
      await client.query('SELECT content,meta FROM page_versions WHERE page_id=$1 AND revision=$2', [pageId, revision])
    ).rows[0]
    if (
      BigInt(page.revision) === BigInt(revision) + 1n &&
      page.own &&
      page.note === 'Added ' + label &&
      before &&
      isDeepStrictEqual(content.slice(0, -1), before.content) &&
      isDeepStrictEqual(page.meta, before.meta) &&
      isDeepStrictEqual(content.at(-1), section)
    )
      return { pageId, revision: String(page.revision), versionId: String(page.id) }
    throw new DomainError('stale_revision', 'This page changed. Reload the page choices before adding the section.')
  }
  const saved = (
    await client.query("SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint',$5)", [
      pageId,
      revision,
      JSON.stringify([...content, section]),
      JSON.stringify(page.meta),
      'Added ' + label,
    ])
  ).rows[0]!
  return { pageId, revision: String(saved.revision), versionId: String(saved.version_id) }
}

export function addWorldToPage(client: Queryable, siteId: string, pageId: string, revision: string, input: unknown) {
  return addStoryWidgetToPage(client, siteId, pageId, revision, input, 'world')
}
export function addSplitToPage(client: Queryable, siteId: string, pageId: string, revision: string, input: unknown) {
  return addStoryWidgetToPage(client, siteId, pageId, revision, input, 'split')
}
