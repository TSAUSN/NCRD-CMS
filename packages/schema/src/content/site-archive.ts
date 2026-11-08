import { z } from 'zod'
import { SiteAssetRecord } from './site-assets.ts'
import { SiteFileBundle, SiteFileView } from './site-files.ts'
import { PageContent, SlotDef } from './sections.ts'
import { SeoMeta } from './seo.ts'
import { ThemeTokens } from './theme.ts'
import { NavTree } from './nav.ts'
import { CollectionFields, CollectionPresentation } from './collections.ts'
import { HeaderConfig, FooterConfig } from './global-elements.ts'

/** A content transfer, never a database/credential backup. Keep every row closed. */
export const SITE_ARCHIVE_FORMAT = 'cms-site-content'
export const SITE_ARCHIVE_VERSION = 1
export const MAX_SITE_ARCHIVE_BYTES = 64 * 1024 * 1024
const id = z.uuid()
const timestamp = z.string().datetime({ offset: true })
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const json = z.json()
const pointers = { id, revision, draft_version_id: id.nullable(), published_version_id: id.nullable() }
const version = { id, revision: revision.refine(v => v > 0), created_at: timestamp }
const slug = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const path = z
  .string()
  .max(240)
  .regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/)
const image = {
  width: z.number().int().min(1).max(32768),
  height: z.number().int().min(1).max(32768),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(25 * 1024 * 1024),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
}
const rows = <T extends z.ZodType>(shape: T, max = 20_000) => z.array(shape).max(max)
export const SiteArchiveContent = z.strictObject({
  site: z.strictObject({
    name: z.string().min(1).max(120),
    slug,
    kind: z.enum(['resource', 'event', 'conference', 'campaign', 'general']),
  }),
  pages: rows(
    z.strictObject({
      ...pointers,
      slug: path,
      title: z.string().min(1).max(200),
      layout_mode: z.literal('sections'),
      status: z.enum(['draft', 'published', 'archived']),
      editor_label: z.string(),
      sort_index: z.number().int(),
      parent_page_id: id.nullable().optional(),
      archived_at: timestamp.nullable(),
    }),
    2_000,
  ),
  page_versions: rows(
    z.strictObject({
      ...version,
      page_id: id,
      content: PageContent,
      meta: SeoMeta,
      kind: z.enum(['autosave', 'checkpoint', 'submission', 'publish', 'restore']),
      note: z.string(),
      page_title: z.string(),
      page_slug: z.string(),
    }),
  ),
  themes: rows(z.strictObject(pointers), 1),
  theme_versions: rows(z.strictObject({ ...version, theme_id: id, tokens: ThemeTokens })),
  site_settings: rows(z.strictObject(pointers), 1),
  site_setting_versions: rows(z.strictObject({ ...version, site_settings_id: id, settings: json })),
  navigations: rows(z.strictObject({ ...pointers, mode: z.enum(['auto', 'manual']) }), 1),
  navigation_versions: rows(z.strictObject({ ...version, navigation_id: id, tree: NavTree })),
  global_elements: rows(
    z.strictObject({ ...pointers, kind: z.enum(['header', 'footer']), use_on_live: z.boolean() }),
    2,
  ),
  global_element_versions: rows(z.strictObject({ ...version, global_element_id: id, content: json })),
  section_defs: rows(
    z.strictObject({
      id,
      slug,
      name: z.string().min(1).max(200),
      category: z.string(),
      status: z.enum(['active', 'hidden', 'retired']),
      scope: z.enum(['site', 'global']),
      // Pre-authored-frame v1 archives omit this. Keep their original bytes;
      // the import command interprets absence as page, never as a frame.
      placement: z.enum(['page', 'header', 'footer']).optional(),
    }),
    2_000,
  ),
  section_def_versions: rows(
    z.strictObject({
      id,
      section_def_id: id,
      version: z.number().int().min(1),
      source_html: z.string().max(524288),
      source_css: z.string().max(262144),
      slots: z.array(SlotDef),
      definition_kind: z.enum(['legacy', 'structured']),
      structured_doc: json.nullable(),
      structured_schema_version: z.number().int().nullable(),
      changelog: z.string(),
      created_at: timestamp,
    }),
  ),
  collections: rows(
    z.strictObject({
      id,
      revision,
      slug,
      name: z.string().min(1),
      reader_key: z.string(),
      source: z.enum(['builtin', 'admin']),
      draft_schema_version_id: id.nullable(),
      published_schema_version_id: id.nullable(),
      entry_revision: revision,
      published_entry_revision: revision,
    }),
    200,
  ),
  collection_schema_versions: rows(
    z.strictObject({ ...version, collection_id: id, fields: CollectionFields, sort: CollectionPresentation }),
  ),
  collection_entries: rows(
    z.strictObject({
      ...pointers,
      collection_id: id,
      stable_key: z.string(),
      sort_index: z.number().int(),
      published_sort_index: z.number().int().nullable(),
      archived_at: timestamp.nullable(),
      published_archived_at: timestamp.nullable(),
    }),
  ),
  collection_entry_versions: rows(
    z.strictObject({
      ...version,
      entry_id: id,
      collection_id: id,
      schema_version_id: id,
      values: z.record(z.string(), json),
    }),
  ),
  site_assets: rows(SiteAssetRecord, 2_000).optional(),
  site_files: rows(SiteFileView.extend({ created_at: timestamp }), 2_000).optional(),
  site_file_versions: rows(
    z.strictObject({ id, version: revision.refine(v => v > 0), bundle: SiteFileBundle, reviewed_at: timestamp }),
  ).optional(),
  site_file_heads: rows(
    z.strictObject({ revision, draft_version_id: id.nullable(), published_version_id: id.nullable() }),
    1,
  ).optional(),
  document_metadata: rows(
    z.strictObject({
      asset_id: id,
      category: z
        .string()
        .trim()
        .max(80)
        .regex(/^[^\u0000-\u001f\u007f]*$/),
      archived: z.boolean(),
    }),
    2_000,
  ).optional(),
  page_recipes: rows(
    z.strictObject({
      id,
      name: z.string().trim().min(1).max(120),
      revision,
      current_version_id: id.nullable(),
      retired_at: timestamp.nullable(),
    }),
    2_000,
  ).optional(),
  page_recipe_versions: rows(
    z.strictObject({ ...version, recipe_id: id, source_version_id: id, content: PageContent }),
  ).optional(),
  media: rows(
    z.strictObject({
      id,
      ...image,
      original_name: z.string().max(255),
      alt_text: z.string().max(1000),
      decorative: z.boolean(),
      focal: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable(),
      status: z.enum(['ready', 'deleted']),
      deleted_at: timestamp.nullable(),
      folder: z.string().max(200),
      attribution: z.string().max(500),
      source: z.string().max(1000),
      tags: z.array(z.string().max(64)).max(20),
      created_at: timestamp,
    }),
    2_000,
  ),
  media_variants: rows(
    z.strictObject({ id, media_id: id, ...image, kind: z.enum(['original', 'thumbnail', 'card', 'wide']) }),
    8_000,
  ),
})
export type SiteArchiveContent = z.infer<typeof SiteArchiveContent>
export const SiteArchive = z.strictObject({
  format: z.literal(SITE_ARCHIVE_FORMAT),
  version: z.literal(SITE_ARCHIVE_VERSION),
  exported_at: timestamp,
  content: SiteArchiveContent,
  objects: rows(
    z.strictObject({
      media_id: id,
      kind: z.enum(['original', 'thumbnail', 'card', 'wide', 'asset', 'site-file']),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      base64: z.string().max(35 * 1024 * 1024),
    }),
    8_000,
  ),
})
export type SiteArchive = z.infer<typeof SiteArchive>
export const SiteArchiveDestination = z.strictObject({
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(120),
})
export type SiteArchiveDestination = z.infer<typeof SiteArchiveDestination>

/** Returns the original JSON after validation: defaults must never alter saved content. */
export function parseSiteArchive(input: unknown): SiteArchive {
  SiteArchive.parse(input)
  const archive = input as SiteArchive
  validateArchiveReferences(archive.content)
  return archive
}

export function validateArchiveReferences(content: SiteArchiveContent): void {
  const fail = (message: string): never => {
    throw new Error(`The archive ${message}.`)
  }
  const allIds = new Set<string>()
  for (const [table, list] of Object.entries(content)) {
    if (!Array.isArray(list)) continue
    for (const row of list) {
      if (!('id' in row)) continue
      if (allIds.has(row.id)) fail(`reuses an ID in ${table}`)
      allIds.add(row.id)
    }
  }
  const relationships = [
    ['pages', 'page_versions', 'page_id', 'draft_version_id', 'published_version_id'],
    ['themes', 'theme_versions', 'theme_id', 'draft_version_id', 'published_version_id'],
    ['site_settings', 'site_setting_versions', 'site_settings_id', 'draft_version_id', 'published_version_id'],
    ['navigations', 'navigation_versions', 'navigation_id', 'draft_version_id', 'published_version_id'],
    ['global_elements', 'global_element_versions', 'global_element_id', 'draft_version_id', 'published_version_id'],
    [
      'collections',
      'collection_schema_versions',
      'collection_id',
      'draft_schema_version_id',
      'published_schema_version_id',
    ],
    ['collection_entries', 'collection_entry_versions', 'entry_id', 'draft_version_id', 'published_version_id'],
  ] as const
  for (const [heads, versions, foreign, draft, live] of relationships) {
    const byId = new Map<string, Record<string, unknown>>(
      (content[heads] as { id: string }[]).map(row => [row.id, row]),
    )
    const byVersion = new Map<string, Record<string, unknown>>(
      (content[versions] as { id: string }[]).map(row => [row.id, row]),
    )
    for (const row of byVersion.values()) {
      const head = byId.get(row[foreign] as string)
      if (!head || (row['revision'] as number) > (head['revision'] as number))
        fail(`has an orphaned or future ${versions} row`)
    }
    for (const head of byId.values())
      for (const pointer of [draft, live]) {
        if (head[pointer] !== null && byVersion.get(head[pointer] as string)?.[foreign] !== head['id'])
          fail(`has a foreign ${heads} version pointer`)
      }
  }
  if (
    content.themes.length !== 1 ||
    content.navigations.length !== 1 ||
    content.site_settings.length !== 1 ||
    content.global_elements.length !== 2 ||
    new Set(content.global_elements.map(row => row.kind)).size !== 2
  )
    fail('is missing a shared workspace')
  const definitions = new Map(content.section_defs.map(row => [row.id, row]))
  const sectionVersions = new Set<string>()
  for (const row of content.section_def_versions) {
    if (!definitions.has(row.section_def_id)) fail('has an orphaned section version')
    const key = `${row.section_def_id}:${row.version}`
    if (sectionVersions.has(key)) fail('repeats a section version')
    sectionVersions.add(key)
  }
  for (const row of content.page_versions)
    for (const section of row.content) {
      if ((definitions.get(section.section_def_id)?.placement ?? 'page') !== 'page')
        fail('places a site frame component in page content')
    }
  const frames = new Map(content.global_elements.map(row => [row.id, row.kind]))
  for (const row of content.global_element_versions) {
    const kind = frames.get(row.global_element_id)
    const parsed = (kind === 'header' ? HeaderConfig : FooterConfig).safeParse(row.content)
    if (!parsed.success) fail(`has invalid ${kind ?? 'frame'} content`)
    if (parsed.data?.schemaVersion === 2) {
      const component = parsed.data.component
      if (!sectionVersions.has(`${component.section_def_id}:${component.section_def_version}`))
        fail('references a missing pinned frame version')
      if (definitions.get(component.section_def_id)?.placement !== kind)
        fail(`pins a definition with the wrong ${kind} placement`)
    }
  }
  const pageIds = new Set(content.pages.map(row => row.id))
  const parentIds = new Map(content.pages.map(row => [row.id, row.parent_page_id]))
  for (const page of content.pages) {
    const seen = new Set<string>([page.id])
    let parent = page.parent_page_id
    while (parent) {
      if (!pageIds.has(parent)) fail('references a missing parent page')
      if (seen.has(parent)) fail('contains a cycle in page parents')
      seen.add(parent)
      parent = parentIds.get(parent)
    }
  }
  const fileLists = ['site_files', 'site_file_versions', 'site_file_heads'] as const
  if (fileLists.some(key => content[key] !== undefined) && fileLists.some(key => content[key] === undefined))
    fail('is missing reviewed file history')
  const files = new Map((content.site_files ?? []).map(row => [row.id, row]))
  const fileVersions = new Map((content.site_file_versions ?? []).map(row => [row.id, row]))
  const fileNumbers = new Set<number>()
  const fileHead = content.site_file_heads?.[0]
  for (const row of fileVersions.values()) {
    if (fileNumbers.has(row.version) || !fileHead || row.version > fileHead.revision)
      fail('has duplicate, orphaned or future reviewed file versions')
    fileNumbers.add(row.version)
    for (const pin of row.bundle.original?.definitions ?? [])
      if (!sectionVersions.has(pin.section_def_id + ':' + pin.section_def_version))
        fail('references a missing original layout version')
    for (const page of row.bundle.original?.pages ?? [])
      if (!pageIds.has(page.pageId)) fail('uses an original layout on a missing page')
    for (const file of row.bundle.files) if (!files.has(file)) fail('references a missing reviewed file')
    for (const binding of row.bundle.scripts)
      if (files.get(binding.fileId)?.kind !== 'script') fail('loads a non-script as a script')
    for (const binding of row.bundle.styles)
      if (files.get(binding.fileId)?.kind !== 'stylesheet') fail('loads a non-stylesheet as a stylesheet')
    for (const binding of [...row.bundle.scripts, ...row.bundle.styles])
      for (const page of binding.pages) if (!pageIds.has(page)) fail('loads a reviewed file on a missing page')
  }
  if (fileHead) {
    if (
      fileHead.revision < fileVersions.size ||
      (fileVersions.size > 0 && Math.max(...fileNumbers) !== fileVersions.size) ||
      (fileVersions.size === 0 && fileHead.revision !== 0)
    )
      fail('has incomplete reviewed file history')
    for (const pointer of [fileHead.draft_version_id, fileHead.published_version_id])
      if (pointer !== null && !fileVersions.has(pointer)) fail('has a foreign reviewed file version pointer')
    if (fileHead.revision > 0 && fileHead.draft_version_id === null) fail('is missing its reviewed file draft')
  }
  const assetIds = new Set((content.site_assets ?? []).map(row => row.id))
  const metadataIds = new Set<string>()
  for (const row of content.document_metadata ?? []) {
    if (
      metadataIds.has(row.asset_id) ||
      !content.site_assets?.some(asset => asset.id === row.asset_id && asset.kind === 'document')
    )
      fail('has duplicate or foreign document metadata')
    metadataIds.add(row.asset_id)
  }
  const recipes = new Map((content.page_recipes ?? []).map(row => [row.id, row]))
  const recipeVersions = new Map((content.page_recipe_versions ?? []).map(row => [row.id, row]))
  const pageVersions = new Set(content.page_versions.map(row => row.id))
  for (const row of recipeVersions.values()) {
    const head = recipes.get(row.recipe_id)
    if (!head || row.revision > head.revision || !pageVersions.has(row.source_version_id))
      fail('has an orphaned or future recipe version')
    for (const section of row.content)
      if ((definitions.get(section.section_def_id)?.placement ?? 'page') !== 'page')
        fail('places a site frame component in a recipe')
  }
  for (const row of recipes.values())
    if (row.current_version_id === null || recipeVersions.get(row.current_version_id)?.recipe_id !== row.id)
      fail('has a foreign recipe version pointer')
  const mediaIds = new Set(content.media.map(row => row.id))
  const collectionIds = new Set(content.collections.map(row => row.id))
  const schemas = new Map(content.collection_schema_versions.map(row => [row.id, row]))
  const entries = new Map(content.collection_entries.map(row => [row.id, row]))
  for (const entry of entries.values())
    if (!collectionIds.has(entry.collection_id)) fail('has an orphaned collection entry')
  for (const row of content.collection_entry_versions) {
    if (
      entries.get(row.entry_id)?.collection_id !== row.collection_id ||
      schemas.get(row.schema_version_id)?.collection_id !== row.collection_id
    )
      fail('has a foreign collection schema')
  }
  const variantKeys = new Set<string>()
  for (const row of content.media_variants) {
    const key = `${row.media_id}:${row.kind}`
    if (!mediaIds.has(row.media_id) || variantKeys.has(key)) fail('has an orphaned or duplicate image variant')
    variantKeys.add(key)
  }
  for (const row of fileVersions.values())
    for (const alias of row.bundle.native ?? []) {
      if (alias.kind === 'asset') {
        if (!assetIds.has(alias.assetId)) fail('references a missing original document or font')
      } else {
        if (
          !mediaIds.has(alias.mediaId) ||
          alias.variants.some(variant => variant !== 'original' && !variantKeys.has(`${alias.mediaId}:${variant}`))
        )
          fail('references a missing original image or size')
      }
    }
  const inspect = (value: unknown, depth = 0): void => {
    if (depth > 80) fail('is nested too deeply')
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\/assets\/([0-9a-f-]{36})/gi))
        if (!assetIds.has(match[1]!)) fail('references a missing document or font')
      for (const match of value.matchAll(/\/media\/([0-9a-f-]{36})\/(original|thumbnail|card|wide)/gi)) {
        if (!mediaIds.has(match[1]!) || (match[2] !== 'original' && !variantKeys.has(`${match[1]}:${match[2]}`)))
          fail('references a missing media file')
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach(child => inspect(child, depth + 1))
      return
    }
    if (!value || typeof value !== 'object') return
    const row = value as Record<string, unknown>
    if (row['asset_id'] !== undefined && (typeof row['asset_id'] !== 'string' || !assetIds.has(row['asset_id'])))
      fail('references a missing document or font')
    if (
      row['section_def_id'] !== undefined &&
      row['section_def_version'] !== undefined &&
      !sectionVersions.has(`${row['section_def_id']}:${row['section_def_version']}`)
    )
      fail('references a missing pinned section version')
    for (const key of ['media_id', 'logoMediaId', 'compactLogoMediaId', 'social_image']) {
      if (
        typeof row[key] === 'string' &&
        /^[0-9a-f-]{36}$/i.test(row[key] as string) &&
        !mediaIds.has(row[key] as string)
      )
        fail('references missing media')
    }
    if (
      typeof row['readerKey'] === 'string' &&
      row['selection'] &&
      !content.collections.some(collection => collection.reader_key === row['readerKey'])
    )
      fail('references a missing collection')
    if (row['type'] === 'page' && !pageIds.has(row['page_id'] as string)) fail('references a missing navigation page')
    for (const child of Object.values(row)) inspect(child, depth + 1)
  }
  inspect(content)
}

/** Executable files and original document structure both require fresh root review. */
export function requiresSiteFileReview(
  content: Pick<SiteArchiveContent, 'site_files' | 'site_file_versions'>,
): boolean {
  return Boolean(content.site_files?.length || content.site_file_versions?.some(version => version.bundle.original))
}
