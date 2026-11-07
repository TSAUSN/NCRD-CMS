import { createHash } from 'node:crypto'
import { asUser, evaluateVersionReadiness, evaluateVersionsReadiness, type Queryable } from '@cms/platform'
import { DomainError, READINESS_POLICY_VERSION, type ReadinessReport } from '@cms/domain'
import { renderPage, type RenderManifest, type SiteShell } from '@cms/renderer'
import { releaseReadinessFixLinks } from './readiness-targets.ts'
import { changedNumberIds, numbersOnlySettingsChange } from './number-release-scope.ts'
import { SCRIPTLESS_RENDER_OPTIONS } from './scriptless-preview.ts'

export type ReleaseType =
  | 'page'
  | 'theme'
  | 'navigation'
  | 'frame'
  | 'collection_schema'
  | 'collection_entries'
  | 'site_files'
  | 'chapter_setup'
  | 'site_settings'
export type ReleaseItem = {
  key: string
  type: ReleaseType
  id: string
  label: string
  revision: string
  versionId: string | null
  secondaryRevision?: string
  secondaryVersionId?: string | null
  unpublished?: boolean
  requiresAdmin?: boolean
  action?: 'publish' | 'unpublish'
  recoveryId?: string
  entryIds?: string[]
}

async function checkInitialRelease(client: Queryable, siteId: string, items: ReleaseItem[]) {
  const initial = (
    await client.query<{ initial_release_required: boolean }>(
      'SELECT initial_release_required FROM sites WHERE id=$1',
      [siteId],
    )
  ).rows[0]?.initial_release_required
  if (!initial) return
  if (items[0]?.recoveryId && items.every(item => item.action === 'unpublish')) return
  items = items.filter(item => item.action !== 'unpublish')
  if (!items.some(item => item.type === 'page'))
    throw new DomainError('invalid_state', 'Select at least one page for the first site release.')
  const missing = (
    await client.query<{ type: ReleaseType }>(
      `SELECT 'theme' AS type FROM themes WHERE site_id=$1 AND published_version_id IS NULL
    UNION SELECT 'navigation' FROM navigations WHERE site_id=$1 AND published_version_id IS NULL
    UNION SELECT 'frame' FROM global_elements WHERE site_id=$1 AND published_version_id IS NULL`,
      [siteId],
    )
  ).rows
  if (missing.some(dependency => !items.some(item => item.type === dependency.type))) {
    throw new DomainError(
      'invalid_state',
      'Include the theme, header & footer, and navigation in the first site release so pages open with their complete design.',
    )
  }
}
export type ReleaseCheck = {
  pageId: string
  versionId: string
  title: string
  report: ReadinessReport
  fixLinks?: string[]
}
export type ReleaseRow = {
  id: string
  site_id: string
  status: 'planned' | 'applied' | 'cancelled'
  snapshot: ReleaseItem[]
  context_hash: string
  after_hash: string
  preview_report: ReleaseCheck[]
  created_at: Date
  finished_at: Date | null
  created_by: string
  finished_by?: string | null
  stale?: boolean
  scope_before_hash?: string | null
  scope_after_hash?: string | null
}

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
  const header = frame.find(row => row.kind === 'header'),
    footer = frame.find(row => row.kind === 'footer')
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
export function listSiteReleases(userId: string, siteId: string): Promise<ReleaseRow[]> {
  return asUser({ userId }, async client => {
    const current = await fingerprint(client, siteId)
    const releases = (
      await client.query<ReleaseRow>(
        'SELECT r.*,sc.before_hash AS scope_before_hash,sc.after_hash AS scope_after_hash FROM site_releases r LEFT JOIN site_release_story_scopes sc ON sc.release_id=r.id WHERE r.site_id=$1 ORDER BY r.created_at DESC LIMIT 30',
        [siteId],
      )
    ).rows
    const candidates = await releaseCandidates(client, siteId)
    for (const release of releases) {
      release.stale =
        release.status === 'planned' &&
        (release.scope_before_hash
          ? (await storyFingerprint(client, siteId, release.snapshot)) !== release.scope_before_hash
          : release.context_hash !== current)
      if (release.status !== 'planned' || release.stale) continue
      if (!release.snapshot.some(item => item.recoveryId)) {
        try {
          checkedReleaseSelection(candidates, await plannedSelectionInput(client, release))
        } catch {
          release.stale = true
        }
      } else {
        // History can contain an old recovery plan; a refusal must not abort
        // this read transaction or hide the rest of the history.
        await client.query('SAVEPOINT history_recovery_check')
        try {
          await client.query('SELECT app.check_release_recovery_selection($1,$2)', [
            siteId,
            JSON.stringify(release.snapshot),
          ])
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT history_recovery_check')
          if (!['CMS01', 'CMS02', 'CMS03', 'CMS04', '42501'].includes((error as { code?: string }).code ?? ''))
            throw error
          release.stale = true
        } finally {
          await client.query('RELEASE SAVEPOINT history_recovery_check')
        }
      }
    }
    return releases
  })
}

function sameTarget(a: ReleaseItem, b: ReleaseItem): boolean {
  return (
    a.type === b.type &&
    a.id === b.id &&
    a.revision === b.revision &&
    a.versionId === b.versionId &&
    a.secondaryRevision === b.secondaryRevision &&
    a.secondaryVersionId === b.secondaryVersionId &&
    a.action === b.action &&
    a.recoveryId === b.recoveryId &&
    JSON.stringify(a.entryIds) === JSON.stringify(b.entryIds)
  )
}
export function checkedReleaseSelection(candidates: ReleaseItem[], requested: ReleaseItem[]): ReleaseItem[] {
  if (
    !requested.length ||
    requested.length > 200 ||
    new Set(requested.map(item => item.key)).size !== requested.length
  ) {
    throw new DomainError('invalid_state', 'Select between 1 and 200 distinct release items.')
  }
  const picked = new Set(requested.map(item => item.key))
  for (const request of requested) {
    const actual = candidates.find(item => item.key === request.key)
    if (
      request.entryIds !== undefined &&
      (request.type !== 'collection_entries' ||
        !Array.isArray(request.entryIds) ||
        !request.entryIds.length ||
        request.entryIds.length > 200 ||
        new Set(request.entryIds).size !== request.entryIds.length ||
        request.entryIds.some(
          id =>
            typeof id !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id),
        ))
    )
      throw new DomainError('invalid_state', 'Choose distinct stories from this site.')
    if (!actual || !sameTarget(actual, { ...request, entryIds: undefined }))
      throw new DomainError('stale_revision', 'A selected item changed. Refresh and review the release again.')
    if (
      request.type === 'collection_entries' &&
      candidates.some(item => item.key === `collection_schema:${request.id}`) &&
      !picked.has(`collection_schema:${request.id}`)
    )
      throw new DomainError('invalid_state', 'Include the collection schema change before releasing its records.')
  }
  return candidates
    .filter(item => picked.has(item.key))
    .map(item => {
      const scope = requested.find(request => request.key === item.key)?.entryIds
      return scope ? { ...item, entryIds: [...scope] } : item
    })
}

async function resolveReleaseSelection(
  client: Queryable,
  siteId: string,
  requested: ReleaseItem[],
): Promise<ReleaseItem[]> {
  if (requested.some(item => item.recoveryId !== undefined || item.action !== undefined)) {
    // Exact target scope, actions, versions and revisions are generated and
    // compared by the database; recovery never trusts caller-supplied choices.
    await client.query('SELECT app.check_release_recovery_selection($1,$2)', [siteId, JSON.stringify(requested)])
    return requested
  }
  const selected = checkedReleaseSelection(await releaseCandidates(client, siteId), requested)
  for (const item of selected) {
    if (!item.entryIds) continue
    const rows = (
      await client.query<{ title: string }>(
        `SELECT v.values->>'title' AS title FROM collection_entries e JOIN collections c ON c.id=e.collection_id JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE c.site_id=$1 AND c.id=$2 AND c.reader_key='stories' AND e.id=ANY($3::uuid[]) AND e.archived_at IS NULL ORDER BY e.id`,
        [siteId, item.id, item.entryIds],
      )
    ).rows
    if (rows.length !== item.entryIds.length)
      throw new DomainError('not_found', 'A selected story is unavailable to this site.')
    item.label = rows.length === 1 ? 'Story: ' + rows[0]!.title : rows.length + ' selected stories'
  }
  return selected
}

async function fingerprint(client: Queryable, siteId: string): Promise<string> {
  return (await client.query<{ hash: string }>('SELECT app.release_fingerprint($1) AS hash', [siteId])).rows[0]!.hash
}

async function storyFingerprint(client: Queryable, siteId: string, items: ReleaseItem[]): Promise<string | null> {
  return (
    await client.query<{ hash: string | null }>('SELECT app.story_release_fingerprint($1,$2) AS hash', [
      siteId,
      JSON.stringify(items),
    ])
  ).rows[0]!.hash
}
async function withStoryScope(client: Queryable, release: ReleaseRow): Promise<ReleaseRow> {
  const scope = (
    await client.query<{ before_hash: string; after_hash: string }>(
      'SELECT before_hash,after_hash FROM site_release_story_scopes WHERE release_id=$1',
      [release.id],
    )
  ).rows[0]
  return scope ? { ...release, scope_before_hash: scope.before_hash, scope_after_hash: scope.after_hash } : release
}
/** Only the list's concurrency counter advances. Exact selected version/order,
 * article and dependency pins are independently checked before this is used. */
async function plannedSelectionInput(client: Queryable, release: ReleaseRow): Promise<ReleaseItem[]> {
  if (!release.scope_before_hash) return release.snapshot
  const item = release.snapshot.find(item => item.type === 'collection_entries' && item.entryIds),
    head = item
      ? (
          await client.query<{ entry_revision: string }>(
            'SELECT entry_revision FROM collections WHERE id=$1 AND site_id=$2',
            [item.id, release.site_id],
          )
        ).rows[0]
      : null
  if (!head) throw new DomainError('stale_revision', 'This story is unavailable. Review it again.')
  return release.snapshot.map(choice => (choice === item ? { ...choice, revision: head.entry_revision } : choice))
}
async function reviewedContextMatches(client: Queryable, release: ReleaseRow): Promise<boolean> {
  return release.scope_before_hash
    ? (await storyFingerprint(client, release.site_id, release.snapshot)) === release.scope_before_hash
    : (await fingerprint(client, release.site_id)) === release.context_hash
}
/** Existing published findings are not new effects of this one Story. Read all
 * baselines server-side under the same site locks, including its private article
 * against published lists, so no other private Story can supply an exception. */
async function publishedStoryBaselines(client: Queryable, release: ReleaseRow): Promise<Map<string, ReadinessReport>> {
  const pages = (
    await client.query<{ id: string; version_id: string; published: boolean }>(
      `SELECT id,published_version_id AS version_id,true AS published FROM pages WHERE site_id=$1 AND archived_at IS NULL AND published_version_id IS NOT NULL`,
      [release.site_id],
    )
  ).rows
  for (const item of release.snapshot.filter(item => item.type === 'page'))
    if (!pages.some(page => page.id === item.id && page.version_id === item.versionId)) {
      const at = pages.findIndex(page => page.id === item.id)
      if (at >= 0) pages.splice(at, 1)
      pages.push({ id: item.id, version_id: item.versionId!, published: false })
    }
  const reports = await evaluateVersionsReadiness(
    client,
    pages.map(page => ({
      versionId: page.version_id,
      access: page.published ? 'published' : 'published-context',
    })),
  )
  return new Map(pages.map((page, index) => [page.id, reports[index]!]))
}
const sameFinding = (a: ReadinessReport['findings'][number], b: ReadinessReport['findings'][number]) =>
  a.rule === b.rule && a.severity === b.severity && a.message === b.message && a.detail === b.detail

/** Both the rollback-only preview and the committed release execute these
 * exact commands in this exact order. No network I/O occurs in this transaction. */
async function publishSelection(
  client: Queryable,
  siteId: string,
  items: ReleaseItem[],
  reports: Map<string, ReadinessReport> | null,
  override: string | null,
  plannedPaths: string[],
) {
  const recoveryId = items[0]?.recoveryId
  if (recoveryId) await client.query('SELECT app.apply_release_recovery_unpublishes($1)', [recoveryId])
  items = items.filter(item => item.action !== 'unpublish')
  for (const item of items.filter(item => item.type === 'site_settings'))
    await client.query('SELECT app.publish_site_settings($1,$2)', [siteId, item.revision])
  for (const item of items.filter(item => item.type === 'theme'))
    await client.query('SELECT app.publish_theme($1,$2)', [siteId, item.revision])
  for (const item of items.filter(item => item.type === 'collection_schema'))
    await client.query('SELECT app.publish_collection_schema($1,$2)', [item.id, item.revision])
  for (const item of items.filter(item => item.type === 'collection_entries')) {
    let revision = item.revision
    const rows = (
      await client.query<{
        id: string
        stable_key: string
        values: Record<string, unknown>
        schema_id: string
        draft_schema: string
      }>(
        `
      SELECT e.id,e.stable_key,v."values",v.schema_version_id AS schema_id,c.draft_schema_version_id AS draft_schema
      FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id JOIN collections c ON c.id=e.collection_id
      WHERE e.collection_id=$1 AND e.archived_at IS NULL AND ($2::uuid[] IS NULL OR e.id=ANY($2::uuid[])) ORDER BY e.sort_index,e.id`,
        [item.id, item.entryIds ?? null],
      )
    ).rows
    if (rows.some(row => row.schema_id !== row.draft_schema)) {
      if (item.entryIds)
        throw new DomainError(
          'invalid_state',
          'Save the selected story again after changing its fields, then review publication.',
        )
      revision = (
        await client.query<{ entry_revision: string }>('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
          item.id,
          revision,
          JSON.stringify(rows.map(row => ({ id: row.id, stableKey: row.stable_key, values: row.values }))),
        ])
      ).rows[0]!.entry_revision
    }
    if (item.entryIds)
      await client.query('SELECT app.publish_story_entries($1,$2,$3)', [item.id, revision, item.entryIds])
    else await client.query('SELECT app.publish_collection_entries($1,$2)', [item.id, revision])
  }
  for (const item of items.filter(item => item.type === 'chapter_setup'))
    await client.query('SELECT app.publish_chapter_setup($1,$2)', [item.id, item.revision])
  for (const item of items.filter(item => item.type === 'page')) {
    const report =
      reports?.get(item.id) ?? (await evaluateVersionReadiness(client, item.versionId!, 'member', plannedPaths))
    await client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [
      item.id,
      item.revision,
      report.policyVersion,
      override,
      JSON.stringify(report.findings),
    ])
  }
  for (const item of items.filter(item => item.type === 'site_files'))
    await client.query('SELECT app.publish_site_files($1,$2)', [siteId, item.revision])
  for (const item of items.filter(item => item.type === 'frame'))
    await client.query('SELECT app.publish_global_elements($1,$2,$3)', [siteId, item.revision, item.secondaryRevision])
  for (const item of items.filter(item => item.type === 'navigation')) {
    const head = (
      await client.query<{ revision: string; draft_version_id: string }>(
        'SELECT revision,draft_version_id FROM navigations WHERE site_id=$1',
        [siteId],
      )
    ).rows[0]!
    if (head.draft_version_id !== item.versionId)
      throw new DomainError('stale_revision', 'The navigation draft changed during release preparation.')
    await client.query('SELECT app.publish_navigation($1,$2)', [siteId, head.revision])
  }
}

async function simulateRelease(
  client: Queryable,
  siteId: string,
  items: ReleaseItem[],
  previewPageId?: string,
  preparedChecks?: ReleaseCheck[],
): Promise<{ checks: ReleaseCheck[]; afterHash: string; scopeHash: string | null; html?: string }> {
  await checkInitialRelease(client, siteId, items)
  const [only] = items
  // Other settings, multi-item releases and recovery can affect the whole site.
  const numberIds =
    items.length === 1 && only?.type === 'site_settings' && only.versionId && !only.recoveryId && !only.action
      ? await changedNumberIds(client, siteId, only.versionId)
      : null
  const plannedPaths = (
    await client.query<{ path: string }>(
      `SELECT path FROM published_routes WHERE site_id=$1 AND page_id<>ALL($3::uuid[])
    UNION SELECT app.page_path(v.page_slug) FROM page_versions v WHERE v.id=ANY($2::uuid[])`,
      [
        siteId,
        items.filter(item => item.type === 'page' && item.action !== 'unpublish').map(item => item.versionId),
        items.filter(item => item.type === 'page' && item.action === 'unpublish').map(item => item.id),
      ],
    )
  ).rows.map(row => row.path)
  await client.query('SAVEPOINT release_preview')
  try {
    // This reason exists only in a transaction that is always rolled back.
    // It permits constructing the future projection before judging the final
    // header/navigation/dependency state. Non-overridable SQL gates still hold.
    // Execution has an immutable server-recorded review under the same locked
    // fingerprint. Reuse only matching version/policy reports for constructing
    // this trial. The complete future projection is still freshly judged below
    // and compared with the review before any real publication is committed.
    const reports = preparedChecks
      ? new Map(
          preparedChecks
            .filter(
              check =>
                check.report.policyVersion === READINESS_POLICY_VERSION &&
                items.some(
                  item => item.type === 'page' && item.id === check.pageId && item.versionId === check.versionId,
                ),
            )
            .map(check => [check.pageId, check.report]),
        )
      : null
    await publishSelection(client, siteId, items, reports, 'Rollback-only release preview', plannedPaths)
    const pages = (
      await client.query<{ id: string; version_id: string; title: string }>(
        `
      SELECT p.id,v.id AS version_id,v.page_title AS title FROM pages p JOIN page_versions v ON v.id=p.published_version_id
      WHERE p.site_id=$1 AND p.archived_at IS NULL
        AND p.id IN (SELECT page_id FROM app.release_readiness_pages($1))
        AND ($2::text[] IS NULL OR jsonb_path_query_array(v.content, '$[*].values.__cms_data_values.*.parts[*].valueId') ?| $2)
      ORDER BY p.id`,
        [siteId, numberIds],
      )
    ).rows
    const reportsAfterPublication = await evaluateVersionsReadiness(
      client,
      pages.map(page => ({
        versionId: page.version_id,
        access: 'published',
      })),
    )
    const targets = pages.map((page, index) => ({
      pageId: page.id,
      versionId: page.version_id,
      findings: reportsAfterPublication[index]!.findings,
    }))
    const links = await releaseReadinessFixLinks(client, siteId, targets)
    const checks: ReleaseCheck[] = pages.map((page, index) => ({
      pageId: page.id,
      versionId: page.version_id,
      title: page.title,
      report: reportsAfterPublication[index]!,
      fixLinks: links[index]!,
    }))
    let html: string | undefined
    if (previewPageId) {
      const route = (
        await client.query<{ render_manifest: RenderManifest }>(
          'SELECT render_manifest FROM published_routes WHERE site_id=$1 AND page_id=$2',
          [siteId, previewPageId],
        )
      ).rows[0]
      if (!route) throw new DomainError('not_found', 'This page is not included in the proposed public site.')
      const shell = (
        await client.query<{ payload: SiteShell }>('SELECT payload FROM published_site_shells WHERE site_id=$1', [
          siteId,
        ])
      ).rows[0]!.payload
      const routes = (
        await client.query<{ page_id: string; path: string }>(
          'SELECT page_id,path FROM published_routes WHERE site_id=$1',
          [siteId],
        )
      ).rows
      html = renderPage({
        manifest: route.render_manifest,
        shell,
        isStaging: true,
        navigationPaths: Object.fromEntries(routes.map(row => [row.page_id, row.path])),
        options: {
          ...SCRIPTLESS_RENDER_OPTIONS,
          ...(shell.staging_host ? { canonicalBase: `https://${shell.staging_host}` } : {}),
        },
      }).html
    }
    return {
      checks,
      afterHash: await fingerprint(client, siteId),
      scopeHash: await storyFingerprint(client, siteId, items),
      ...(html === undefined ? {} : { html }),
    }
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT release_preview')
    await client.query('RELEASE SAVEPOINT release_preview')
  }
}

/** Render the combined future state while every temporary publication remains
 * inside the rollback-only savepoint. Refuse an old plan instead of silently
 * showing a new draft under the old review's identity. */
export async function previewSiteReleasePage(userId: string, id: string, pageId: string): Promise<string> {
  return asUser({ userId }, async client => {
    const owner = (await client.query<{ site_id: string }>('SELECT site_id FROM site_releases WHERE id=$1', [id]))
      .rows[0]
    if (!owner) throw new DomainError('not_found', 'Release not found.')
    await client.query('SELECT app.lock_release_site($1)', [owner.site_id])
    const release = await withStoryScope(
      client,
      (await client.query<{ release: ReleaseRow }>('SELECT app.lock_site_release($1) AS release', [id])).rows[0]!
        .release,
    )
    if (release.status !== 'planned')
      throw new DomainError(
        'invalid_state',
        'This release is no longer pending. Use its content-version links for history.',
      )
    await resolveReleaseSelection(client, release.site_id, await plannedSelectionInput(client, release))
    if (!(await reviewedContextMatches(client, release)))
      throw new DomainError(
        'stale_revision',
        'The site changed after this release was prepared. Prepare a new review before previewing.',
      )
    const simulation = await simulateRelease(
      client,
      release.site_id,
      await plannedSelectionInput(client, release),
      pageId,
    )
    if (
      release.scope_after_hash
        ? simulation.scopeHash !== release.scope_after_hash
        : simulation.afterHash !== release.after_hash
    )
      throw new DomainError('stale_revision', 'The proposed outcome changed. Prepare a new release.')
    return simulation.html!
  })
}

export async function planSiteRelease(
  userId: string,
  id: string,
  siteId: string,
  requested: ReleaseItem[],
): Promise<ReleaseRow> {
  return asUser({ userId, requestId: id }, async client => {
    await client.query('SELECT app.lock_release_site($1)', [siteId])
    const existing = (await client.query<ReleaseRow>('SELECT * FROM site_releases WHERE id=$1', [id])).rows[0]
    if (existing) {
      const receipt = await withStoryScope(client, existing),
        sameStoryContext = Boolean(receipt.scope_before_hash && (await reviewedContextMatches(client, receipt)))
      if (
        existing.site_id !== siteId ||
        existing.created_by !== userId ||
        requested.length !== existing.snapshot.length ||
        new Set(requested.map(item => item.key)).size !== requested.length ||
        requested.some(
          item =>
            !existing.snapshot.some(
              saved =>
                saved.key === item.key &&
                sameTarget(
                  saved,
                  sameStoryContext && saved.type === 'collection_entries' && saved.entryIds
                    ? { ...item, revision: saved.revision }
                    : item,
                ),
            ),
        )
      ) {
        throw new DomainError('invalid_state', 'This release request was already used for different choices.')
      }
      return receipt
    }
    const items = await resolveReleaseSelection(client, siteId, requested)
    const context = await fingerprint(client, siteId)
    const simulation = await simulateRelease(client, siteId, items)
    await client.query('SELECT app.record_site_release($1,$2,$3,$4,$5,$6)', [
      id,
      siteId,
      JSON.stringify(items),
      context,
      simulation.afterHash,
      JSON.stringify(simulation.checks),
    ])
    if (simulation.scopeHash)
      await client.query('SELECT app.record_story_release_scope($1,$2)', [id, simulation.scopeHash])
    return withStoryScope(
      client,
      (await client.query<ReleaseRow>('SELECT * FROM site_releases WHERE id=$1', [id])).rows[0]!,
    )
  })
}

/** Browser and timer use the same checks and publication commands. */
async function reviewedSiteRelease(client: Queryable, id: string, override: string, samplesConfirmed?: boolean) {
  const owner = (await client.query<{ site_id: string }>('SELECT site_id FROM site_releases WHERE id=$1', [id])).rows[0]
  if (!owner) throw new DomainError('not_found', 'Release not found.')
  await client.query('SELECT app.lock_release_site($1)', [owner.site_id])
  const release = await withStoryScope(
    client,
    (await client.query<{ release: ReleaseRow }>('SELECT app.lock_site_release($1) AS release', [id])).rows[0]!.release,
  )
  if (release.status !== 'planned') throw new DomainError('invalid_state', 'This release is no longer pending.')
  if (!(await reviewedContextMatches(client, release)))
    throw new DomainError('stale_revision', 'The site changed after this preview. Prepare a new release.')
  const selection = await resolveReleaseSelection(client, release.site_id, await plannedSelectionInput(client, release))
  const baselines = release.scope_before_hash ? await publishedStoryBaselines(client, release) : null
  const simulation = await simulateRelease(client, release.site_id, selection, undefined, release.preview_report)
  const ignored: ReleaseCheck[] = []
  if (baselines)
    simulation.checks = simulation.checks.map(check => {
      const reviewed = release.preview_report.find(old => old.pageId === check.pageId)?.report,
        baseline = baselines.get(check.pageId),
        existing = check.report.blocking.filter(
          finding =>
            !reviewed?.blocking.some(old => sameFinding(old, finding)) &&
            baseline?.blocking.some(old => sameFinding(old, finding)),
        )
      if (!existing.length) return check
      ignored.push({ ...check, report: { ...check.report, findings: existing, blocking: existing, advisory: [] } })
      const findings = check.report.findings.filter(finding => !existing.some(old => sameFinding(old, finding))),
        blocking = findings.filter(finding => finding.severity === 'blocking')
      return { ...check, report: { ...check.report, findings, blocking, ok: blocking.length === 0 } }
    })
  if (
    release.scope_after_hash
      ? simulation.scopeHash !== release.scope_after_hash
      : simulation.afterHash !== release.after_hash
  )
    throw new DomainError('stale_revision', 'The proposed outcome changed. Prepare a new release.')
  for (const check of simulation.checks) {
    const previous = release.preview_report.find(previous => previous.pageId === check.pageId)?.report
    if ((previous?.policyVersion ?? baselines?.get(check.pageId)?.policyVersion) !== check.report.policyVersion)
      throw new DomainError('stale_revision', 'The publishing checks changed. Review these changes again.')
    const seen = previous?.blocking ?? []
    if (
      check.report.blocking.some(
        finding =>
          !seen.some(
            old => old.rule === finding.rule && old.message === finding.message && old.detail === finding.detail,
          ),
      )
    ) {
      throw new DomainError(
        'stale_revision',
        'New readiness findings appeared. Review these changes again before publishing or scheduling.',
      )
    }
  }
  const sampleFindings = simulation.checks.flatMap(check =>
    check.report.blocking.filter(finding => finding.rule === 'sample_content'),
  )
  const sampleConsent =
    samplesConfirmed === true ||
    (samplesConfirmed === undefined && override === 'Confirmed: Publish with sample content.')
  if (sampleFindings.length && !sampleConsent)
    throw new DomainError(
      'invalid_state',
      'This release still contains sample content. Review the listed examples and confirm Publish with sample content.',
    )
  const blocking = simulation.checks.flatMap(check =>
    check.report.blocking
      .filter(finding => !sampleConsent || finding.rule !== 'sample_content')
      .map(finding => `${check.title}: ${finding.message}`),
  )
  if (sampleFindings.length && sampleConsent && !override.trim()) override = 'Confirmed: Publish with sample content.'
  if (blocking.length && !override.trim()) throw new DomainError('invalid_state', blocking.join(' '))
  return { release, simulation, override, selection, ignored }
}

/** The full immutable report remains on the release; its audit entry is bounded. */
function releaseReadinessAudit(checks: ReleaseCheck[]) {
  const rules: Record<string, { blocking: number; advisory: number }> = {}
  let blocking = 0,
    advisory = 0
  for (const check of checks)
    for (const severity of ['blocking', 'advisory'] as const)
      for (const finding of check.report[severity]) {
        const counts = (rules[finding.rule] ??= { blocking: 0, advisory: 0 })
        counts[severity]++
        if (severity === 'blocking') blocking++
        else advisory++
      }
  return { pages: checks.length, blocking, advisory, rules }
}

/** The caller owns the transaction so publication and schedule settlement are atomic. */
export async function executeSiteReleaseInTransaction(
  client: Queryable,
  id: string,
  override: string,
  samplesConfirmed?: boolean,
): Promise<void> {
  const receipt = (await client.query<ReleaseRow>('SELECT * FROM site_releases WHERE id=$1', [id])).rows[0]
  if (receipt?.status === 'applied') {
    await client.query('SELECT app.lock_site_release($1)', [id])
    return
  }
  const checked = await reviewedSiteRelease(client, id, override, samplesConfirmed)
  const { release, simulation } = checked
  override = checked.override
  if (release.scope_before_hash) await client.query('SELECT app.refresh_story_release_recovery($1)', [id])
  await publishSelection(
    client,
    release.site_id,
    checked.selection,
    new Map(simulation.checks.map(check => [check.pageId, check.report])),
    override.trim() || null,
    [],
  )
  await client.query('SELECT app.finish_site_release($1,false,$2)', [
    id,
    JSON.stringify({
      ...(release.scope_before_hash ? { existing_public_findings: releaseReadinessAudit(checked.ignored) } : {}),
      items: release.snapshot.map(item => ({ key: item.key, versionId: item.versionId })),
      override_reason: override.trim() || null,
      readiness: releaseReadinessAudit(simulation.checks),
      readiness_report_ref: release.id,
      readiness_report_sha256: createHash('sha256').update(JSON.stringify(simulation.checks)).digest('hex'),
    }),
  ])
}

export async function executeSiteRelease(
  userId: string,
  id: string,
  override: string,
  samplesConfirmed?: boolean,
): Promise<void> {
  await asUser({ userId, requestId: id }, client =>
    executeSiteReleaseInTransaction(client, id, override, samplesConfirmed),
  )
}

export async function scheduleSiteRelease(
  userId: string,
  id: string,
  runAt: string,
  override: string,
  samplesConfirmed: boolean,
  requestId: string,
): Promise<string> {
  return asUser({ userId, requestId }, async client => {
    const existing = (await client.query('SELECT id FROM scheduled_actions WHERE request_id=$1', [requestId])).rows[0]
    const scheduled = (
      await client.query<{ id: string }>('SELECT app.schedule_release_action($1,$2,$3,$4,$5,$6) AS id', [
        id,
        runAt,
        override,
        samplesConfirmed,
        requestId,
        READINESS_POLICY_VERSION,
      ])
    ).rows[0]!.id
    if (!existing) await reviewedSiteRelease(client, id, override, samplesConfirmed)
    return scheduled
  })
}
