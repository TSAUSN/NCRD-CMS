// Write the demo sites' content archives (demo/sites/*.cms-site.json.gz).
//
// The demo data started as the V1 migration of HNI and Echelon, corrected until
// both matched V1 (docs/v1-migration.md). This script takes them out of that
// database through the product's own export, then keeps only what the demo
// needs: live pages and their current versions, the section library, and the
// images, documents and fonts something still uses. Migration-only material —
// reference pages, per-page source definitions, superseded versions — stays
// behind. `pnpm demo` imports the result through the product's own import.
//
//   cd apps/admin && node --experimental-strip-types scripts/demo-export.ts \
//     <super-admin-user-id> <site-id>=<file-stem> [...] --out ../../demo/sites
//
// Needs DATABASE_URL_AUTHENTICATED and the media store variables of the source
// database. Reads only; the export itself is recorded in the activity log.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { closePools, configuredMediaStore } from '@cms/platform'
import { parseSiteArchive, type SiteArchive } from '@cms/schema'
import { exportSiteArchive, inspectArchiveObjects } from '../src/lib/site-portability.ts'

/** Library categories that only ever held migration scaffolding. */
const MIGRATION_ONLY = new Set(['V1 migration reference', 'Existing page', 'Migrated V1 site frame', 'Site Chrome'])
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

type Content = SiteArchive['content']
const heads = (rows: { draft_version_id: string | null; published_version_id: string | null }[]) =>
  new Set(
    rows.flatMap(row => [row.draft_version_id, row.published_version_id]).filter((id): id is string => id !== null),
  )
const idsIn = (value: unknown) =>
  new Set(
    JSON.stringify(value)
      .match(UUID)
      ?.map(id => id.toLowerCase()) ?? [],
  )

export function pruneDemoArchive(archive: SiteArchive): SiteArchive {
  const source = archive.content
  const content: Content = structuredClone(source)

  // Pages: live ones, plus any archived page a page template was saved from
  // (a template keeps a link to the version it came from).
  const recipeSources = new Set((source.page_recipe_versions ?? []).map(row => row.source_version_id))
  const templatePages = new Set(source.page_versions.filter(row => recipeSources.has(row.id)).map(row => row.page_id))
  content.pages = source.pages.filter(page => page.archived_at === null || templatePages.has(page.id))
  for (const page of content.pages)
    if (templatePages.has(page.id) && page.archived_at !== null) page.title = 'Page template sources'
  const pageIds = new Set(content.pages.map(page => page.id))
  const keptPageVersions = new Set([...heads(content.pages), ...recipeSources])
  content.page_versions = source.page_versions.filter(row => pageIds.has(row.page_id) && keptPageVersions.has(row.id))

  // Shared workspaces: only the versions their heads point at.
  content.theme_versions = source.theme_versions.filter(row => heads(source.themes).has(row.id))
  content.site_setting_versions = source.site_setting_versions.filter(row => heads(source.site_settings).has(row.id))
  content.navigation_versions = source.navigation_versions.filter(row => heads(source.navigations).has(row.id))
  content.global_element_versions = source.global_element_versions.filter(row =>
    heads(source.global_elements).has(row.id),
  )
  if (source.page_recipes) {
    const current = new Set(source.page_recipes.map(row => row.current_version_id))
    content.page_recipe_versions = (source.page_recipe_versions ?? []).filter(row => current.has(row.id))
  }

  // Section definitions: everything still placed somewhere, and the library.
  const pinned = new Map<string, Set<number>>()
  const pin = (id: string, version: number) => {
    if (!pinned.has(id)) pinned.set(id, new Set())
    pinned.get(id)!.add(version)
  }
  for (const row of [...content.page_versions, ...(content.page_recipe_versions ?? [])]) {
    for (const section of row.content) pin(section.section_def_id, section.section_def_version)
  }
  for (const row of content.global_element_versions) {
    const component = (
      row.content as { schemaVersion?: number; component?: { section_def_id: string; section_def_version: number } }
    ).component
    if ((row.content as { schemaVersion?: number }).schemaVersion === 2 && component)
      pin(component.section_def_id, component.section_def_version)
  }
  content.section_defs = source.section_defs.filter(
    def =>
      pinned.has(def.id) ||
      (def.status === 'active' && !MIGRATION_ONLY.has(def.category) && def.category !== 'Migrated V1 content'),
  )
  const newest = new Map<string, number>()
  for (const row of source.section_def_versions)
    newest.set(row.section_def_id, Math.max(newest.get(row.section_def_id) ?? 0, row.version))
  const keptDefs = new Set(content.section_defs.map(def => def.id))
  content.section_def_versions = source.section_def_versions.filter(
    row =>
      keptDefs.has(row.section_def_id) &&
      (row.version === newest.get(row.section_def_id) || pinned.get(row.section_def_id)?.has(row.version)),
  )
  // Sections that came from V1's pages are page-specific: they keep rendering
  // where they are placed but stay out of the insert library, where V1's own
  // catalogue already offers each kind.
  for (const def of content.section_defs) {
    if (def.category === 'Migrated V1 content' || MIGRATION_ONLY.has(def.category)) def.status = 'hidden'
  }

  // Files: what the kept rows still mention. Fonts stay; themes name them by key.
  const mentioned = idsIn({ ...content, media: [], media_variants: [], site_assets: [], document_metadata: [] })
  content.media = source.media.filter(row => mentioned.has(row.id))
  const mediaIds = new Set(content.media.map(row => row.id))
  content.media_variants = source.media_variants.filter(row => mediaIds.has(row.media_id))
  if (source.site_assets)
    content.site_assets = source.site_assets.filter(row => row.kind === 'font' || mentioned.has(row.id))
  const assetIds = new Set((content.site_assets ?? []).map(row => row.id))
  if (source.document_metadata)
    content.document_metadata = source.document_metadata.filter(row => assetIds.has(row.asset_id))
  const objects = archive.objects.filter(object =>
    object.kind === 'asset'
      ? assetIds.has(object.media_id)
      : mediaIds.has(object.media_id) &&
        (object.kind === 'original' ||
          content.media_variants.some(row => row.media_id === object.media_id && row.kind === object.kind)),
  )

  return parseSiteArchive({ ...archive, content, objects })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const outIndex = args.indexOf('--out')
  const out = resolve(outIndex >= 0 ? args[outIndex + 1]! : '../../demo/sites')
  const [userId, ...targets] = args.filter((_, index) => outIndex < 0 || (index !== outIndex && index !== outIndex + 1))
  if (!userId || !targets.length) {
    console.error('usage: demo-export.ts <super-admin-user-id> <site-id>=<file-stem> [...] [--out dir]')
    process.exit(1)
  }
  mkdirSync(out, { recursive: true })
  try {
    for (const target of targets) {
      const [siteId, stem] = target.split('=')
      const exported = await exportSiteArchive(userId, siteId!, configuredMediaStore())
      const archive = pruneDemoArchive(exported)
      await inspectArchiveObjects(archive)
      const file = join(out, `${stem}.cms-site.json.gz`)
      const bytes = gzipSync(JSON.stringify(archive), { level: 9 })
      writeFileSync(file, bytes)
      const c = archive.content
      console.log(
        `${stem}: ${c.pages.length} pages (${c.page_versions.length} versions), ${c.section_defs.length} sections, ` +
          `${c.media.length} images, ${(c.site_assets ?? []).length} documents and fonts → ${file} (${(bytes.byteLength / 1048576).toFixed(1)} MB)`,
      )
    }
  } finally {
    await closePools()
  }
}
