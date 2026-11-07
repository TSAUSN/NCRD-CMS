import { isDeepStrictEqual } from 'node:util'
import { dataValueChangeWords } from './data-value-copy.ts'
import { dataValueUsage, resolvedDataSections } from './data-values.ts'
import 'server-only'
import { STORY_SECTORS, STORY_REGIONS } from '@cms/seeds/sawso-stories'
import { FooterConfig, NavTree, chapterDestinationLabel, type ChapterSetup } from '@cms/schema'
import { menuChangeWords, footerLinkChangeWords } from './page-list-links.ts'
import { asUser } from '@cms/platform'
import { getCollectionSelections } from './collection-queries.ts'
import {
  changedCells,
  pageChangePresentation,
  readableReleaseValue,
  storyEntryPresentation,
  type ReleasePresentation,
} from './release-copy.ts'
import type { ReleaseItem } from './releases.ts'

type ReleasePageContent = Parameters<typeof pageChangePresentation>[1]
type PinnedPage = {
  page_id: string
  version_id: string
  published_version_id: string | null
  content: ReleasePageContent
  meta: Record<string, unknown> | null
  page_title: string
  page_slug: string
  carries_trusted_code: boolean
  trusted_code_approved_by: string | null
  live_content: ReleasePageContent | null
  live_meta: Record<string, unknown> | null
  live_title: string | null
  live_slug: string | null
  live_trusted_code: boolean | null
  live_approved_by: string | null
}
type PinnedChapter = { page_version_id: string; draft: ChapterSetup; live: ChapterSetup | null }

function chapterSetupCells(before: ChapterSetup | null, after: ChapterSetup) {
  return [
    ...changedCells(
      { ...before, destination: chapterDestinationLabel(before?.destination) },
      { ...after, destination: chapterDestinationLabel(after.destination) },
      {
        name: 'Chapter name',
        destination: 'Where visitors go',
        externalUrl: 'Page address',
        updateMode: 'Publishing and approval',
        boardDisplay: 'Board display',
      },
    ),
    ...changedCells(before?.contact ?? {}, after.contact ?? {}, {
      name: 'Contact name',
      role: 'Contact role',
      email: 'Contact email',
    }),
    ...changedCells(before?.sections ?? {}, after.sections ?? {}, {
      paragraph: 'About text',
      social: 'Social links',
      socialFirst: 'Social links above about text',
      events: 'Events',
      board: 'Board',
      photos: 'Photos',
      memberLogin: 'Member login',
    }),
  ]
}

/** Read-only summaries. Publication still resolves every exact pin again. */
export async function releasePresentations(
  userId: string,
  siteId: string,
  items: ReleaseItem[],
  includeFields = false,
): Promise<Record<string, ReleasePresentation>> {
  const result: Record<string, ReleasePresentation> = {}
  const retain = (item: ReleaseItem, data: ReleasePresentation) => {
    result[item.key] = includeFields ? data : { ...data, cells: [] }
  }
  await asUser({ userId }, async client => {
    const native = !(
      await client.query(
        "SELECT EXISTS(SELECT 1 FROM site_file_heads h JOIN site_file_versions v ON v.id IN(h.draft_version_id,h.published_version_id) WHERE h.site_id=$1 AND v.bundle ? 'original') AS original",
        [siteId],
      )
    ).rows[0]?.original
    const forms = Object.fromEntries(
      (
        await client.query(
          `SELECT v.section_def_id,v.version,d.name,v.slots FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.scope='global' OR d.site_id=$1`,
          [siteId],
        )
      ).rows.map(row => [`${row.section_def_id}:${row.version}`, { name: row.name, slots: row.slots }]),
    )
    const page = (
      await client.query(
        `SELECT published_version_id,draft_version_id FROM pages WHERE site_id=$1 AND archived_at IS NULL AND COALESCE(published_version_id,draft_version_id) IS NOT NULL ORDER BY (published_version_id IS NOT NULL) DESC,(slug='') DESC,sort_index,id LIMIT 1`,
        [siteId],
      )
    ).rows[0]
    const lookPreview = page
      ? {
          live: page.published_version_id ? `/preview/${page.published_version_id}?readonly=1` : null,
          saved: `/preview/${page.published_version_id ?? page.draft_version_id}?visit=1&site=draft`,
          note: 'This preview includes all saved Site look changes on the same page.',
        }
      : undefined
    const numberSettings = (
      await client.query(
        'SELECT d.settings AS draft,l.settings AS live FROM site_settings h LEFT JOIN site_setting_versions d ON d.id=h.draft_version_id LEFT JOIN site_setting_versions l ON l.id=h.published_version_id WHERE h.site_id=$1',
        [siteId],
      )
    ).rows[0]
    const pageItems = items.filter(item => item.type === 'page' && item.versionId !== null)
    const versionIds = [...new Set(pageItems.map(item => item.versionId))]
    const pageIds = [...new Set(pageItems.map(item => item.id))]
    const pageRows = new Map<string, PinnedPage>()
    const chapterRows = new Map<string, PinnedChapter>()
    if (pageItems.length) {
      const { rows } = await client.query<PinnedPage>(
        `SELECT p.id AS page_id,d.id AS version_id,p.published_version_id,d.content,d.meta,d.page_title,d.page_slug,d.carries_trusted_code,d.trusted_code_approved_by,
          l.content AS live_content,l.meta AS live_meta,l.page_title AS live_title,l.page_slug AS live_slug,l.carries_trusted_code AS live_trusted_code,l.trusted_code_approved_by AS live_approved_by
          FROM pages p JOIN page_versions d ON d.page_id=p.id AND d.id=ANY($2::uuid[]) LEFT JOIN page_versions l ON l.id=p.published_version_id
          WHERE p.site_id=$1 AND p.id=ANY($3::uuid[])`,
        [siteId, versionIds, pageIds],
      )
      for (const row of rows) pageRows.set(`${row.page_id}:${row.version_id}`, row)
      // A pin references one immutable chapter version. RLS still controls
      // whether the caller can see the contact and setup details it contains.
      const chapters = await client.query<PinnedChapter>(
        `SELECT pin.page_version_id,d.config AS draft,l.config AS live FROM chapter_page_versions pin
             JOIN chapters c ON c.id=pin.chapter_id AND c.site_id=pin.site_id
             JOIN chapter_versions d ON d.id=pin.chapter_version_id
             LEFT JOIN chapter_versions l ON l.id=c.published_version_id
             WHERE pin.page_version_id=ANY($2::uuid[]) AND pin.site_id=$1`,
        [siteId, [...new Set(rows.map(row => row.version_id))]],
      )
      for (const row of chapters.rows) chapterRows.set(row.page_version_id, row)
    }
    const candidateSettings = items.some(item => item.type === 'site_settings')
      ? numberSettings?.draft
      : numberSettings?.live
    for (const item of items) {
      if (item.type === 'page') {
        const row = pageRows.get(`${item.id}:${item.versionId}`)
        if (!row) continue
        const presentation = pageChangePresentation(
          row.published_version_id ? resolvedDataSections(row.live_content ?? [], forms, numberSettings?.live) : null,
          resolvedDataSections(row.content, forms, candidateSettings),
          forms,
          row.published_version_id
            ? { title: row.live_title, address: row.live_slug, description: row.live_meta?.description }
            : null,
          { title: row.page_title, address: row.page_slug, description: row.meta?.description },
        )
        // Publishing a chapter page also applies the immutable chapter setup
        // pinned to that exact page version. Its current draft may be newer.
        // Read through the caller's existing RLS; private contact fields remain
        // unavailable to whole-site Editors and other sites.
        const chapter = item.versionId ? chapterRows.get(item.versionId) : undefined
        const chapterCells = chapter ? chapterSetupCells(chapter.live, chapter.draft) : []
        if (chapterCells.length) {
          const changes = chapterCells.map(cell => ({ text: 'Chapter setup: ' + cell.label + ' changed' }))
          presentation.changes = [...(presentation.changes ?? []), ...changes]
          presentation.summary = [
            ...(presentation.summary === 'No page changes' ? [] : [presentation.summary]),
            ...changes.map(change => change.text),
          ].join(' · ')
          presentation.cells.push(...chapterCells.map(cell => ({ ...cell, label: 'Chapter setup · ' + cell.label })))
        }
        const noVisibleChanges =
          Boolean(row.published_version_id) &&
          presentation.changes?.length === 0 &&
          isDeepStrictEqual(row.meta, row.live_meta) &&
          row.carries_trusted_code === row.live_trusted_code &&
          Boolean(row.trusted_code_approved_by) === Boolean(row.live_approved_by)
        retain(item, {
          ...presentation,
          noVisibleChanges,
          summary: noVisibleChanges
            ? 'No visible page changes'
            : presentation.summary === 'No page changes'
              ? 'Saved page details changed'
              : presentation.summary,
          ...(row.published_version_id ? { beforeVersionId: row.published_version_id } : {}),
        })
      } else if (item.type === 'theme') {
        const row = (
          await client.query(
            'SELECT d.tokens AS draft,l.tokens AS live FROM themes h JOIN theme_versions d ON d.id=h.draft_version_id LEFT JOIN theme_versions l ON l.id=h.published_version_id WHERE h.site_id=$1',
            [siteId],
          )
        ).rows[0]
        if (!row) continue
        const cells = [
          ...changedCells(row.live?.colors ?? {}, row.draft.colors ?? {}, {
            primary: 'Brand colour',
            accent: 'Accent colour',
            ink: 'Dark colour',
            surface: 'Light colour',
            primaryContrast: 'Text on brand colour',
            accentContrast: 'Text on accent colour',
            surfaceAlt: 'Soft background',
            muted: 'Supporting text',
          }),
          ...changedCells(row.live?.fonts ?? {}, row.draft.fonts ?? {}, { heading: 'Heading font', body: 'Body font' }),
          ...changedCells(row.live ?? {}, row.draft, {
            radius: 'Corner shape',
            buttons: 'Buttons',
            density: 'Spacing',
          }),
        ]
        // Include every saved category, including future supported appearance controls.
        for (const key of Object.keys(row.draft))
          if (
            !['colors', 'fonts', 'radius', 'buttons', 'density'].includes(key) &&
            JSON.stringify(row.draft[key]) !== JSON.stringify(row.live?.[key])
          )
            cells.push({
              label: 'Site appearance',
              before: readableReleaseValue(row.live?.[key]),
              after: readableReleaseValue(row.draft[key]),
            })
        retain(item, { summary: cells.map(cell => cell.label).join(', ') + ' changed', preview: lookPreview, cells })
      } else if (item.type === 'navigation') {
        const row = (
          await client.query(
            'SELECT d.tree AS draft,l.tree AS live FROM navigations h JOIN navigation_versions d ON d.id=h.draft_version_id LEFT JOIN navigation_versions l ON l.id=h.published_version_id WHERE h.site_id=$1',
            [siteId],
          )
        ).rows[0]
        if (row)
          retain(item, {
            summary: native
              ? menuChangeWords(NavTree.parse(row.live ?? []), NavTree.parse(row.draft)).join('; ') ||
                'Menu names, links or order changed'
              : 'Menu names, links or order changed',
            preview: lookPreview,
            cells: [{ label: 'Menu', before: readableReleaseValue(row.live), after: readableReleaseValue(row.draft) }],
          })
      } else if (item.type === 'site_settings') {
        const row = (
          await client.query(
            'SELECT d.settings AS draft,l.settings AS live FROM site_settings h JOIN site_setting_versions d ON d.id=$2 AND d.site_settings_id=h.id LEFT JOIN site_setting_versions l ON l.id=h.published_version_id WHERE h.site_id=$1',
            [siteId, item.versionId],
          )
        ).rows[0]
        if (!row) continue
        const cells = [
          ...changedCells(row.live ?? {}, row.draft, { name: 'Site name' }),
          ...changedCells(row.live?.general ?? {}, row.draft.general ?? {}, {
            description: 'Description for search',
            country: 'Country',
            language: 'Language',
            email: 'Contact email',
            phone: 'Contact phone',
            address: 'Mailing address',
          }),
          ...changedCells(row.live?.search ?? {}, row.draft.search ?? {}, {
            verification: 'Site verification tags',
            hints: 'Hints for search engines',
          }),
        ]
        for (const account of row.draft.social ?? []) {
          const old = (row.live?.social ?? []).find((v: { service: string }) => v.service === account.service)
          const name =
            (
              {
                facebook: 'Facebook',
                instagram: 'Instagram',
                x: 'X',
                linkedin: 'LinkedIn',
                youtube: 'YouTube',
                tiktok: 'TikTok',
              } as Record<string, string>
            )[account.service] ?? 'Account'
          cells.push(
            ...changedCells(old ?? {}, account, {
              url: name + ' address',
              handle: name + ' handle',
              inFooter: name + ' in footer',
            }),
          )
        }
        for (const old of row.live?.social ?? [])
          if (!(row.draft.social ?? []).some((v: { service: string }) => v.service === old.service))
            cells.push({ label: 'Social account removed', before: old.url, after: 'Removed' })
        const numbers = dataValueChangeWords(row.live, row.draft, await dataValueUsage(client, siteId))
        cells.push(...numbers.cells)
        retain(item, {
          summary:
            [
              ...numbers.words,
              ...cells.filter(cell => !numbers.cells.includes(cell)).map(cell => cell.label + ': changed'),
            ].join(' · ') || 'Site settings saved',
          preview: lookPreview,
          cells,
        })
      } else if (item.type === 'chapter_setup') {
        const row = (
          await client.query(
            'SELECT d.config AS draft,l.config AS live FROM chapters c JOIN chapter_versions d ON d.id=c.draft_version_id LEFT JOIN chapter_versions l ON l.id=c.published_version_id WHERE c.site_id=$1 AND c.id=$2',
            [siteId, item.id],
          )
        ).rows[0]
        if (row) {
          const cells = chapterSetupCells(row.live, row.draft)
          retain(item, {
            summary: cells.some(cell => ['Where visitors go', 'Page address'].includes(cell.label))
              ? 'Chapter directory destination changed'
              : cells.map(cell => cell.label + ': changed').join(' · ') || 'Chapter details changed',
            cells,
          })
        }
      } else if (item.type === 'site_files') {
        const rows = (
          await client.query(
            `SELECT f.name,f.bytes,f.source,f.sha256 FROM site_file_heads h JOIN site_file_versions v ON v.id=h.draft_version_id JOIN site_files f ON f.site_id=h.site_id AND v.bundle->'files' @> to_jsonb(ARRAY[f.id::text]) WHERE h.site_id=$1 ORDER BY f.name,f.id`,
            [siteId],
          )
        ).rows
        retain(item, {
          summary: `${rows.length} reviewed site ${rows.length === 1 ? 'file' : 'files'} · Super Admin approval`,
          cells: rows.map(row => ({
            label: row.name,
            before: 'Previously published file list retained in History',
            after: `${row.bytes} bytes · ${row.source} · SHA-256 ${row.sha256}`,
          })),
        })
      } else if (item.type === 'frame') {
        const rows = (
          await client.query(
            'SELECT h.kind,d.content AS draft,l.content AS live FROM global_elements h JOIN global_element_versions d ON d.id=h.draft_version_id LEFT JOIN global_element_versions l ON l.id=h.published_version_id WHERE h.site_id=$1',
            [siteId],
          )
        ).rows
        const cells = rows
          .filter(row => JSON.stringify(row.draft) !== JSON.stringify(row.live))
          .map(row => ({
            label: row.kind === 'header' ? 'Header' : 'Footer',
            before: readableReleaseValue(row.live),
            after: readableReleaseValue(row.draft),
          }))
        const footer = rows.find(row => row.kind === 'footer'),
          before = FooterConfig.safeParse(footer?.live),
          after = FooterConfig.safeParse(footer?.draft),
          links = native && before.success && after.success ? footerLinkChangeWords(before.data, after.data) : []
        retain(item, {
          summary: [cells.map(cell => cell.label).join(' and ') + ' changed on every page', ...links].join('; '),
          preview: lookPreview,
          cells,
        })
      }
    }
  })
  const collectionIds = [...new Set(items.filter(item => item.type.startsWith('collection_')).map(item => item.id))]
  const collections = await getCollectionSelections(userId, siteId, collectionIds)
  for (const id of collectionIds) {
    const list = collections.get(id)
    if (!list) continue
    for (const item of items.filter(item => item.id === id && item.type.startsWith('collection_'))) {
      if (item.type === 'collection_schema') {
        const describe = (model: typeof list.draft | null) =>
          model?.fields.map(field => `${field.label}${field.required ? ' (required)' : ''}`).join(' · ') ||
          'No fields yet'
        retain(item, {
          summary: 'Editor form fields changed',
          cells: [{ label: 'Fields', before: describe(list.published), after: describe(list.draft) }],
        })
      } else {
        const entries = item.entryIds
          ? list.entries.filter(entry => entry.id && item.entryIds!.includes(entry.id))
          : list.entries
        const cells = entries.flatMap(entry => {
          const title = readableReleaseValue(entry.values[list.draft.presentation.titleField])
          if (entry.archived)
            return entry.publishedValues && !entry.publishedArchived
              ? [{ label: title, before: 'Live item', after: 'Removed from the live list' }]
              : []
          const fields = changedCells(
            entry.publishedValues ?? {},
            entry.values,
            Object.fromEntries(list.draft.fields.map(field => [field.key, field.label])),
          )
          if (entry.sortIndex !== entry.publishedSortIndex)
            fields.push({
              label: 'Position',
              before: entry.publishedSortIndex == null ? 'Not live' : String(entry.publishedSortIndex + 1),
              after: String(entry.sortIndex + 1),
            })
          return fields.map(field => ({ ...field, label: `${title} · ${field.label}` }))
        })
        if (item.entryIds && entries.length === 1) {
          const entry = entries[0]!,
            catalog = list.draft.presentation.stories,
            names = {
              main: Object.fromEntries((catalog?.mainTags ?? STORY_SECTORS).map(t => [t.id, t.label])),
              secondary: Object.fromEntries((catalog?.secondaryTags ?? STORY_REGIONS).map(t => [t.id, t.label])),
            }
          retain(item, storyEntryPresentation(entry.publishedValues, entry.values, list.draft.fields, names))
          continue
        }
        const count = item.entryIds
          ? entries.filter(
              entry =>
                JSON.stringify(entry.values) !== JSON.stringify(entry.publishedValues) ||
                entry.sortIndex !== entry.publishedSortIndex ||
                entry.archived !== entry.publishedArchived,
            ).length
          : list.changedEntries
        const upgrading =
          list.readerKey === 'stories' && !item.entryIds
            ? await asUser({ userId }, async client =>
                Number(
                  (
                    await client.query(
                      `SELECT COALESCE(sum(models.story_count),0) AS count FROM (
          SELECT v.schema_version_id,count(*) AS story_count FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id
          WHERE e.collection_id=$1 AND e.archived_at IS NULL GROUP BY v.schema_version_id
         ) models WHERE NOT app.story_controls_schema_compatible(models.schema_version_id,$2::uuid)`,
                      [list.id, list.draftSchemaVersionId],
                    )
                  ).rows[0]!.count,
                ),
              )
            : 0
        const words = [
          ...(count || !upgrading
            ? [
                `${count} ${item.entryIds ? (count === 1 ? 'story changed' : 'stories changed') : count === 1 ? 'item changed' : 'items changed'}`,
              ]
            : []),
          ...(upgrading ? [`Update editing controls for ${upgrading} ${upgrading === 1 ? 'story' : 'stories'}`] : []),
          `used on ${list.usedOn?.length ?? 0} ${(list.usedOn?.length ?? 0) === 1 ? 'page' : 'pages'}`,
        ]
        retain(item, { summary: words.join(' · '), cells })
      }
    }
  }
  return result
}
