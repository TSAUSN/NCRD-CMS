import { asUser, type Queryable } from '@cms/platform'
import type { ReleaseItem } from './release-types.ts'
import { numbersOnlySettingsChange } from './number-release-scope.ts'

export async function releaseCandidates(client: Queryable, siteId: string): Promise<ReleaseItem[]> {
  const pages = (
    await client.query<{ id: string; title: string; revision: string; draft: string; published: string | null }>(
      `SELECT id,title,revision,draft_version_id AS draft,published_version_id AS published FROM pages
     WHERE site_id=$1 AND archived_at IS NULL AND draft_version_id IS NOT NULL AND draft_version_id IS DISTINCT FROM published_version_id
     ORDER BY sort_index,title,id`,
      [siteId],
    )
  ).rows
  const items: ReleaseItem[] = pages.map(page => ({
    key: `page:${page.id}`,
    type: 'page',
    id: page.id,
    label: page.title,
    revision: page.revision,
    versionId: page.draft,
    unpublished: page.published === null,
  }))
  for (const [table, type, label, requiresAdmin] of [
    ['site_settings', 'site_settings', 'Site settings', true],
    ['themes', 'theme', 'Theme', true],
    ['navigations', 'navigation', 'Navigation', false],
  ] as const) {
    const row = (
      await client.query<{ id: string; revision: string; draft: string }>(
        `
      SELECT h.id,h.revision,h.draft_version_id AS draft FROM ${table} h WHERE h.site_id=$1
      AND h.draft_version_id IS NOT NULL AND h.draft_version_id IS DISTINCT FROM h.published_version_id
      ${
        type === 'theme'
          ? `AND (h.published_version_id IS NULL OR
        (SELECT tokens FROM theme_versions WHERE id=h.draft_version_id) IS DISTINCT FROM
        (SELECT tokens FROM theme_versions WHERE id=h.published_version_id))`
          : ''
      }`,
        [siteId],
      )
    ).rows[0]
    if (row) {
      const title =
        type === 'site_settings' && (await numbersOnlySettingsChange(client, siteId, row.draft)) ? 'Data values' : label
      items.push({
        key: `${type}:${row.id}`,
        type,
        id: row.id,
        label: title,
        revision: row.revision,
        versionId: row.draft,
        requiresAdmin,
      })
    }
  }
  const frame = (
    await client.query<{ kind: string; revision: string; draft: string | null; published: string | null }>(
      'SELECT kind,revision,draft_version_id AS draft,published_version_id AS published FROM global_elements WHERE site_id=$1',
      [siteId],
    )
  ).rows
  const header = frame.find(row => row.kind === 'header')
  const footer = frame.find(row => row.kind === 'footer')
  if (header && footer && (header.draft !== header.published || footer.draft !== footer.published)) {
    items.push({
      key: `frame:${siteId}`,
      type: 'frame',
      id: siteId,
      label: 'Header & footer',
      revision: header.revision,
      versionId: header.draft,
      secondaryRevision: footer.revision,
      secondaryVersionId: footer.draft,
    })
  }
  const collections = (
    await client.query<{
      id: string
      name: string
      revision: string
      entry_revision: string
      published_entry_revision: string
      draft: string | null
      published: string | null
      entries: string
      reader_key: string
      entries_needing_update: string
    }>(
      `
    SELECT c.id,c.name,c.reader_key,c.revision,c.entry_revision,c.published_entry_revision,c.draft_schema_version_id AS draft,c.published_schema_version_id AS published,
      (SELECT COALESCE(sum(models.story_count),0)::text FROM (
       SELECT v.schema_version_id,count(*) AS story_count FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id
        WHERE e.collection_id=c.id AND c.reader_key='stories' AND e.archived_at IS NULL GROUP BY v.schema_version_id
      ) models WHERE models.schema_version_id<>c.draft_schema_version_id AND NOT app.story_controls_schema_compatible(models.schema_version_id,c.draft_schema_version_id)) AS entries_needing_update,
      (SELECT count(*) FROM collection_entries e WHERE e.collection_id=c.id AND e.archived_at IS NULL) AS entries
    FROM collections c WHERE c.site_id=$1 ORDER BY c.name,c.id`,
      [siteId],
    )
  ).rows
  for (const collection of collections) {
    const schemaChanged = collection.draft !== collection.published
    if (schemaChanged && collection.draft)
      items.push({
        key: `collection_schema:${collection.id}`,
        type: 'collection_schema',
        id: collection.id,
        label: `${collection.name} schema`,
        revision: collection.revision,
        versionId: collection.draft,
        requiresAdmin: true,
      })
    if (
      collection.entry_revision !== collection.published_entry_revision ||
      Number(collection.entries_needing_update) > 0 ||
      (schemaChanged && collection.reader_key !== 'stories' && Number(collection.entries) > 0)
    ) {
      items.push({
        key: `collection_entries:${collection.id}`,
        type: 'collection_entries',
        id: collection.id,
        label: `${collection.name} records`,
        revision: collection.entry_revision,
        versionId: collection.draft,
      })
    }
  }
  // A reviewed executable-file change is visible as a release choice only
  // to the role that can approve and publish it. SQL repeats this boundary.
  const files = (
    await client.query<{ revision: string; draft: string }>(
      `SELECT revision,draft_version_id AS draft FROM site_file_heads
    WHERE site_id=$1 AND app.is_super_admin() AND draft_version_id IS NOT NULL AND draft_version_id IS DISTINCT FROM published_version_id`,
      [siteId],
    )
  ).rows[0]
  if (files)
    items.push({
      key: `site_files:${siteId}`,
      type: 'site_files',
      id: siteId,
      label: 'Site scripts and files',
      revision: files.revision,
      versionId: files.draft,
      requiresAdmin: true,
    })
  const chapters = (
    await client.query(
      `SELECT c.id,c.revision,c.draft_version_id AS draft,d.config->>'name' AS name FROM chapters c JOIN chapter_versions d ON d.id=c.draft_version_id JOIN sites s ON s.id=c.site_id WHERE c.site_id=$1 AND (NOT s.initial_release_required OR d.config->>'destination'='division') AND c.draft_version_id IS DISTINCT FROM c.published_version_id AND (d.config->>'pageId' IS NULL OR d.config->>'destination' IN('external','division')) ORDER BY c.slug`,
      [siteId],
    )
  ).rows
  for (const chapter of chapters)
    items.push({
      key: 'chapter_setup:' + chapter.id,
      type: 'chapter_setup',
      id: chapter.id,
      label: chapter.name + ' · directory link',
      revision: chapter.revision,
      versionId: chapter.draft,
      requiresAdmin: true,
    })
  return items
}

export function listReleaseCandidates(userId: string, siteId: string): Promise<ReleaseItem[]> {
  return asUser({ userId }, client => releaseCandidates(client, siteId))
}
