import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Queryable } from '@cms/platform'
import { DomainError, addSection, createEditorState } from '@cms/domain'
import { PageContent, NavTree, sectionAnchorNames, validSectionAnchor, type SectionInstance } from '@cms/schema'
import {
  changeSectionAnchor,
  nextSectionAnchor,
  rewriteSectionLinks,
  type SectionLinkContext,
} from './section-link-edit.ts'
type SavedPage = {
  id: string
  site_id: string
  title: string
  slug: string
  revision: string
  draft_version_id: string
  content: unknown
  meta: Record<string, unknown>
}
export type SectionToolSource = { pageId: string; versionId: string; revision: string; index: number }
export type SectionLinkReview = {
  ok: true
  fingerprint: string
  name: string
  suggested: string
  path: string
  title: string
  references: number
  affected: string[]
  unsafe: boolean
}
async function sourcePage(client: Queryable, input: SectionToolSource) {
  if (!Number.isInteger(input.index) || input.index < 0)
    throw new DomainError('invalid_state', 'Choose a section on this page.')
  const source = (
    await client.query<SavedPage>(
      'SELECT p.id,p.site_id,p.title,p.slug,p.revision::text,p.draft_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1 AND p.archived_at IS NULL',
      [input.pageId],
    )
  ).rows[0]
  if (!source) throw new DomainError('not_found', 'This page is unavailable.')
  if (source.draft_version_id !== input.versionId || source.revision !== input.revision)
    throw new DomainError('stale_revision', 'The source page changed. Return to the section and open this step again.')
  const allowed = (
    await client.query(
      "SELECT app.can_administer_site($1) AND NOT EXISTS(SELECT 1 FROM site_file_heads h JOIN site_file_versions v ON v.id IN(h.draft_version_id,h.published_version_id) WHERE h.site_id=$1 AND v.bundle ? 'original') AS allowed",
      [source.site_id],
    )
  ).rows[0]?.allowed
  if (!allowed)
    throw new DomainError('not_authorized', 'A Site admin manages section links and copies on native pages.')
  const content = PageContent.parse(source.content),
    section = content[input.index]
  if (!section) throw new DomainError('stale_revision', 'This section moved. Return to the page and choose it again.')
  return { source, content, section }
}
async function linkPlan(client: Queryable, input: SectionToolSource, newName?: string) {
  const { source, content, section } = await sourcePage(client, input),
    oldName = typeof section.values.__cms_anchor === 'string' ? section.values.__cms_anchor : '',
    path = source.slug ? '/' + source.slug : '/',
    name = section.label || String(section.values.heading ?? section.values.title ?? 'Section'),
    suggested = oldName || nextSectionAnchor(name, content)
  if (
    newName &&
    (!validSectionAnchor(newName) ||
      content.some((part, index) => index !== input.index && sectionAnchorNames(part.values).includes(newName)))
  )
    throw new DomainError(
      'invalid_state',
      'Use a unique link name starting with a letter, with lowercase letters, numbers and hyphens.',
    )
  const paths = [
      path,
      ...(
        await client.query<{ path: string }>('SELECT path FROM published_routes WHERE site_id=$1 AND page_id=$2', [
          source.site_id,
          source.id,
        ])
      ).rows.map(row => row.path),
    ],
    hosts = (
      await client.query<{ hostname: string }>(
        "SELECT staging_hostname AS hostname FROM sites WHERE id=$1 AND staging_hostname IS NOT NULL UNION SELECT hostname_normalized AS hostname FROM domains WHERE site_id=$1 AND removed_at IS NULL AND status='live'",
        [source.site_id],
      )
    ).rows.map(row => row.hostname),
    context: SectionLinkContext = {
      targetPaths: [...new Set(paths)],
      pagePath: path,
      hosts,
      oldName,
      oldNames: sectionAnchorNames(section.values),
      newName: newName ?? oldName,
    }
  const pages = (
    await client.query<SavedPage>(
      'SELECT p.id,p.site_id,p.title,p.slug,p.revision::text,p.draft_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.archived_at IS NULL ORDER BY p.id',
      [source.site_id],
    )
  ).rows
  const changedPages = pages
    .map(page => {
      const scan = rewriteSectionLinks(page.content, { ...context, pagePath: page.slug ? '/' + page.slug : '/' })
      return { page, content: PageContent.parse(scan.value), ...scan }
    })
    .filter(item => item.page.id === source.id || (oldName && (item.count > 0 || item.unsafe)))
  // Count against a distinct valid name, so opening review finds references without changing any draft.
  const countContext = { ...context, newName: nextSectionAnchor('section-link-review', content) }
  const counts = oldName
    ? pages.map(page => ({
        page,
        ...rewriteSectionLinks(page.content, { ...countContext, pagePath: page.slug ? '/' + page.slug : '/' }),
      }))
    : []
  const frames = (
    await client.query(
      'SELECT g.id,g.kind,g.revision::text,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 ORDER BY g.kind',
      [source.site_id],
    )
  ).rows.map(row => ({
    ...row,
    scan: oldName
      ? rewriteSectionLinks(row.content, { ...context, fragmentOnly: false })
      : { value: row.content, count: 0, unsafe: false },
    countScan: oldName
      ? rewriteSectionLinks(row.content, { ...countContext, fragmentOnly: false })
      : { count: 0, unsafe: false },
  }))
  const navigation = (
      await client.query(
        'SELECT n.id,n.revision::text,n.mode,v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
        [source.site_id],
      )
    ).rows[0],
    navScan = oldName
      ? rewriteSectionLinks(navigation.tree, { ...context, fragmentOnly: false })
      : { value: navigation.tree, count: 0, unsafe: false },
    navCount = oldName
      ? rewriteSectionLinks(navigation.tree, { ...countContext, fragmentOnly: false })
      : { count: 0, unsafe: false }
  const lists = (
    await client.query(
      'SELECT c.id,c.name,c.entry_revision::text,c.draft_schema_version_id,v.fields FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.site_id=$1 ORDER BY c.id',
      [source.site_id],
    )
  ).rows
  const collections = []
  for (const list of lists) {
    const rows = (
        await client.query(
          'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.created_at,e.id',
          [list.id],
        )
      ).rows,
      urlKeys = (list.fields as { key: string; type: string }[])
        .filter(field => ['url', 'link'].includes(field.type))
        .map(field => field.key),
      scanRows = (ctx: SectionLinkContext) => {
        let count = 0,
          unsafe = false
        const value = rows.map(row => {
          const path =
              typeof row.values.story_url === 'string' && row.values.story_url.startsWith('/')
                ? row.values.story_url
                : null,
            scan = rewriteSectionLinks(row, {
              ...ctx,
              urlKeys,
              pagePath: path ?? ctx.pagePath,
              fragmentOnly: Boolean(path),
            })
          count += scan.count
          unsafe ||= scan.unsafe
          return scan.value
        })
        return { value, count, unsafe }
      },
      scan = oldName ? scanRows(context) : { value: rows, count: 0, unsafe: false },
      countScan = oldName ? scanRows(countContext) : { count: 0, unsafe: false }
    if (countScan.count || countScan.unsafe) collections.push({ ...list, scan, countScan })
  }
  const pageRefs = counts.filter(item => item.count || item.unsafe),
    frameRefs = frames.filter(row => row.countScan.count || row.countScan.unsafe),
    references =
      pageRefs.reduce((sum, item) => sum + item.count, 0) +
      frameRefs.reduce((sum, item) => sum + item.countScan.count, 0) +
      navCount.count +
      collections.reduce((sum, list) => sum + list.countScan.count, 0),
    affected = [
      ...pageRefs.map(item => item.page.title),
      ...frameRefs.map(row => (row.kind === 'header' ? 'Header' : 'Footer')),
      ...(navCount.count ? ['Menu'] : []),
      ...collections.map(list => list.name),
    ],
    unsafe =
      pageRefs.some(item => item.unsafe) ||
      frameRefs.some(row => row.countScan.unsafe) ||
      navCount.unsafe ||
      collections.some(list => list.countScan.unsafe)
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        source: [source.id, source.draft_version_id, source.revision, input.index, oldName],
        paths: context.targetPaths,
        hosts,
        pages: pageRefs.map(item => [item.page.id, item.page.revision]),
        frames: frames.map(row => [row.id, row.revision]),
        nav: [navigation.id, navigation.revision],
        lists: collections.map(list => [list.id, list.entry_revision, list.draft_schema_version_id]),
      }),
    )
    .digest('hex')
  const review: SectionLinkReview = {
    ok: true,
    fingerprint,
    name: oldName,
    suggested,
    path,
    title: name,
    references,
    affected: [...new Set(affected)],
    unsafe,
  }
  return { review, source, content, section, changedPages, frames, navigation, navScan, collections }
}
export async function reviewSectionLink(client: Queryable, input: SectionToolSource) {
  return (await linkPlan(client, input)).review
}
export async function renameSectionLinkDrafts(
  client: Queryable,
  input: SectionToolSource & { name: string; fingerprint: string },
) {
  if (!validSectionAnchor(input.name))
    throw new DomainError(
      'invalid_state',
      'Use a link name starting with a letter, with lowercase letters, numbers and hyphens.',
    )
  const plan = await linkPlan(client, input, input.name),
    { review, source } = plan
  if (review.fingerprint !== input.fingerprint)
    throw new DomainError(
      'stale_revision',
      'A linked draft changed after you opened this step. Reload its link review before saving.',
    )
  if (review.unsafe)
    throw new DomainError(
      'invalid_state',
      'A shared or formatted link needs a manual review. Open the listed draft and check its destination before renaming this section.',
    )
  if (input.name === review.name)
    return {
      revision: Number(source.revision),
      versionId: source.draft_version_id,
      message: 'This link name is already saved.',
      references: 0,
      affected: [] as string[],
    }
  let sourceSaved: { revision: string; version_id: string } | undefined
  for (const item of plan.changedPages) {
    const content = item.content
    if (item.page.id === source.id) content[input.index] = changeSectionAnchor(content[input.index]!, input.name)
    if (item.page.id !== source.id && isDeepStrictEqual(content, item.page.content)) continue
    const saved = (
      await client.query<{ revision: string; version_id: string }>(
        "SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint','Changed a section link name and updated its links')",
        [item.page.id, item.page.revision, JSON.stringify(content), JSON.stringify(item.page.meta)],
      )
    ).rows[0]!
    if (item.page.id === source.id) sourceSaved = saved
  }
  const header = plan.frames.find(row => row.kind === 'header'),
    footer = plan.frames.find(row => row.kind === 'footer')
  if (header && footer && plan.frames.some(row => row.scan.count > 0))
    await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5,true)', [
      source.site_id,
      header.revision,
      footer.revision,
      JSON.stringify(header.scan.value),
      JSON.stringify(footer.scan.value),
    ])
  if (plan.navScan.count)
    await client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
      source.site_id,
      plan.navigation.revision,
      JSON.stringify(NavTree.parse(plan.navScan.value)),
      plan.navigation.mode,
    ])
  for (const list of plan.collections) {
    if (!list.scan.count) continue
    await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      list.id,
      list.entry_revision,
      JSON.stringify(
        list.scan.value.map((row: { id: string; stable_key: string; values: unknown }) => ({
          id: row.id,
          stableKey: row.stable_key,
          values: row.values,
        })),
      ),
    ])
  }
  if (!sourceSaved) throw Error('The link update did not produce its saved source page.')
  return {
    revision: Number(sourceSaved.revision),
    versionId: sourceSaved.version_id,
    references: review.references,
    affected: review.affected,
    message:
      'Link name saved. ' +
      review.references +
      ' linked ' +
      (review.references === 1 ? 'destination was' : 'destinations were') +
      ' updated as drafts. Review the affected drafts together in Publish. Earlier public links keep working.',
  }
}
export async function sectionCopyChoices(client: Queryable, input: SectionToolSource) {
  const { source } = await sourcePage(client, input),
    rows = (
      await client.query<{ id: string; title: string; revision: string; content: unknown }>(
        "SELECT p.id,p.title,p.revision::text,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.id<>$2 AND p.archived_at IS NULL AND p.slug NOT LIKE 'stories/%' AND NOT EXISTS(SELECT 1 FROM collections c JOIN collection_entries e ON e.collection_id=c.id JOIN collection_entry_versions ev ON ev.id=e.draft_version_id WHERE c.site_id=p.site_id AND c.reader_key='stories' AND ev.values->>'story_url'=app.page_path(p.slug)) ORDER BY p.title,p.id",
        [source.site_id, source.id],
      )
    ).rows
  return {
    ok: true as const,
    pages: rows.map(page => ({
      id: page.id,
      title: page.title,
      revision: page.revision,
      sections: PageContent.parse(page.content).map((section, index) => ({
        label: section.label || String(section.values.heading ?? section.values.title ?? 'Section ' + (index + 1)),
      })),
    })),
  }
}
export async function copySectionDraft(
  client: Queryable,
  input: SectionToolSource & { targetPageId: string; targetRevision: string; at: number },
) {
  const { source, section } = await sourcePage(client, input),
    allowed = await sectionCopyChoices(client, input)
  if (!allowed.pages.some(page => page.id === input.targetPageId))
    throw new DomainError('not_authorized', 'Choose another ordinary page on this site.')
  const target = (
    await client.query<SavedPage>(
      'SELECT p.id,p.site_id,p.title,p.slug,p.revision::text,p.draft_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1 AND p.site_id=$2 AND p.archived_at IS NULL',
      [input.targetPageId, source.site_id],
    )
  ).rows[0]!
  if (target.revision !== input.targetRevision)
    throw new DomainError('stale_revision', 'The destination page changed. Reload its places before copying.')
  const before = PageContent.parse(target.content)
  if (!Number.isInteger(input.at) || input.at < 0 || input.at > before.length)
    throw new DomainError('invalid_state', 'Choose a place on the destination page.')
  const state = addSection(createEditorState({ sections: before, meta: target.meta }), section, input.at),
    copied = PageContent.parse(state.document.sections),
    inserted = copied[input.at]!,
    oldName = section.values.__cms_anchor,
    newName = inserted.values.__cms_anchor
  if (typeof oldName === 'string' && typeof newName === 'string' && oldName !== newName)
    inserted.values = rewriteSectionLinks(inserted.values, {
      targetPaths: [target.slug ? '/' + target.slug : '/'],
      pagePath: target.slug ? '/' + target.slug : '/',
      hosts: [],
      oldName,
      newName,
    }).value
  const saved = (
    await client.query<{ revision: string; version_id: string }>(
      "SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint','Copied a section into this page draft')",
      [target.id, target.revision, JSON.stringify(copied), JSON.stringify(target.meta)],
    )
  ).rows[0]!
  return {
    pageId: target.id,
    title: target.title,
    revision: Number(saved.revision),
    versionId: saved.version_id,
    message:
      'Copied to ' + target.title + ' as a draft. Nothing was published. Review its text, tags and links on that page.',
  }
}
