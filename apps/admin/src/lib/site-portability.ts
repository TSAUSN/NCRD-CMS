import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { inspectSiteAsset, inspectReviewedSiteFile, asUser, type MediaStore, type Queryable } from '@cms/platform'
import { DomainError } from '@cms/domain'
import {
  MAX_SITE_ARCHIVE_BYTES,
  SITE_ARCHIVE_FORMAT,
  SITE_ARCHIVE_VERSION,
  parseSiteArchive,
  SiteArchiveDestination,
  SiteFileBundle,
  siteFileAddress,
  requiresSiteFileReview,
  type SiteArchive,
  type SiteArchiveContent,
  type SiteNativeAlias,
  type SiteFontKey,
} from '@cms/schema'
import { compileDefinitionDraft } from './definition-compiler.ts'
import { stagingHostnameFor } from './site-creation.ts'

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
function invalid(message: string): never {
  throw new DomainError('invalid_state', message)
}

/** Stable per-request identities make a retry byte-identical without reusing source IDs. */
export function importedId(requestId: string, sourceId: string): string {
  const hash = sha256(`cms-site-content:1:${requestId}:${sourceId}`)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

/** Replace exact IDs and governed media URL references, never arbitrary substrings in prose. */
export function remapArchiveValue(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    if (ids.has(value)) return ids.get(value)
    return value
      .replace(/\/assets\/([0-9a-f-]{36})/gi, (match, id: string) => (ids.has(id) ? `/assets/${ids.get(id)}` : match))
      .replace(/\/media\/([0-9a-f-]{36})\/(original|thumbnail|card|wide)/gi, (match, id: string, variant: string) =>
        ids.has(id) ? `/media/${ids.get(id)}/${variant}` : match,
      )
  }
  if (Array.isArray(value)) return value.map(child => remapArchiveValue(child, ids))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remapArchiveValue(child, ids)]))
}

type ExportRecord = {
  content: SiteArchiveContent
  objects: { media_id: string; kind: string; object_key: string; sha256: string }[]
}
export async function exportSiteArchiveInTransaction(
  client: Queryable,
  siteId: string,
  media: MediaStore,
): Promise<SiteArchive> {
  const result = (
    await client.query<{ archive: ExportRecord }>('SELECT app.export_site_content($1) AS archive', [siteId])
  ).rows[0]!.archive
  const objects: SiteArchive['objects'] = []
  let byteCount = Buffer.byteLength(JSON.stringify(result.content))
  for (const object of result.objects) {
    const bytes = await media.get(object.object_key)
    if (!bytes || sha256(bytes) !== object.sha256)
      invalid('A media object is missing or does not match its stored checksum. Recover it before exporting.')
    byteCount += Math.ceil(bytes.byteLength / 3) * 4 + 200
    if (byteCount > MAX_SITE_ARCHIVE_BYTES)
      invalid('This site exceeds the 64 MB content archive limit. Use the operator backup command for this site.')
    objects.push({
      media_id: object.media_id,
      kind: object.kind as SiteArchive['objects'][number]['kind'],
      sha256: object.sha256,
      base64: Buffer.from(bytes).toString('base64'),
    })
  }
  const archive = parseSiteArchive({
    format: SITE_ARCHIVE_FORMAT,
    version: SITE_ARCHIVE_VERSION,
    exported_at: new Date().toISOString(),
    content: result.content,
    objects,
  })
  await inspectArchiveObjects(archive)
  return archive
}
export async function exportSiteArchive(userId: string, siteId: string, media: MediaStore): Promise<SiteArchive> {
  return asUser(
    { userId },
    async client => {
      // One coherent archive even if another editor saves while objects are read.
      return exportSiteArchiveInTransaction(client, siteId, media)
    },
    { isolation: 'repeatable read' },
  )
}

type InspectedObject = {
  mediaId: string
  kind: SiteArchive['objects'][number]['kind']
  bytes: Uint8Array
  mimeType: string
  hash: string
}
export async function inspectArchiveObjects(archive: SiteArchive): Promise<InspectedObject[]> {
  const expected = new Map<
    string,
    {
      width: number
      height: number
      bytes: number
      mime_type: string
      content_hash: string
      fileKind?: 'script' | 'stylesheet' | 'image' | 'font' | 'data'
      name?: string
      assetKind?: 'document' | 'font'
      font_key?: SiteFontKey | null
    }
  >()
  for (const row of archive.content.site_files ?? [])
    expected.set(`${row.id}:site-file`, {
      width: 0,
      height: 0,
      bytes: row.bytes,
      mime_type: '',
      content_hash: row.sha256,
      fileKind: row.kind,
      name: row.name,
    })
  for (const row of archive.content.site_assets ?? [])
    expected.set(`${row.id}:asset`, { ...row, width: 0, height: 0, assetKind: row.kind })
  for (const row of archive.content.media) expected.set(`${row.id}:original`, row)
  for (const row of archive.content.media_variants) expected.set(`${row.media_id}:${row.kind}`, row)
  if (expected.size !== archive.objects.length)
    invalid('The archive media object list is incomplete or has duplicates.')
  const totalPixels = [...expected.values()].reduce((sum, row) => sum + row.width * row.height, 0)
  if (totalPixels > 200_000_000) invalid('This archive exceeds the 200 million decoded image pixel limit.')
  const seen = new Set<string>(),
    inspected: InspectedObject[] = []
  for (const object of archive.objects) {
    const key = `${object.media_id}:${object.kind}`,
      metadata = expected.get(key)
    if (!metadata || seen.has(key)) invalid('The archive includes an unexpected or duplicate media object.')
    seen.add(key)
    const bytes = Buffer.from(object.base64, 'base64')
    if (
      bytes.toString('base64') !== object.base64 ||
      bytes.length !== metadata.bytes ||
      sha256(bytes) !== object.sha256 ||
      object.sha256 !== metadata.content_hash
    )
      invalid('An archive media checksum, byte count, or encoding is invalid.')
    if (object.kind === 'site-file') {
      let result: ReturnType<typeof inspectReviewedSiteFile>
      try {
        result = inspectReviewedSiteFile(bytes, metadata.fileKind!, metadata.name!)
      } catch {
        invalid('An archive site file is not a complete supported file.')
      }
      inspected.push({
        mediaId: object.media_id,
        kind: object.kind,
        bytes,
        mimeType: result.mimeType,
        hash: object.sha256,
      })
      continue
    }
    if (object.kind === 'asset') {
      try {
        const result = inspectSiteAsset(bytes, metadata.assetKind!, metadata.font_key ?? null)
        if (result.mimeType !== metadata.mime_type || result.contentHash !== metadata.content_hash)
          invalid('Asset type and checksum disagree.')
      } catch {
        invalid('The archive document or font is not an accepted asset.')
      }
      inspected.push({
        mediaId: object.media_id,
        kind: object.kind,
        bytes,
        mimeType: metadata.mime_type,
        hash: object.sha256,
      })
      continue
    }
    try {
      const input = sharp(bytes, { failOn: 'error', limitInputPixels: 100_000_000, animated: false })
      const info = await input.metadata()
      if (
        `image/${info.format === 'jpeg' ? 'jpeg' : info.format}` !== metadata.mime_type ||
        info.width !== metadata.width ||
        info.height !== metadata.height ||
        (info.pages ?? 1) !== 1 ||
        info.exif ||
        info.xmp ||
        info.iptc
      )
        invalid('Archive images must be inspected, single-frame JPEG, PNG, or WebP files without active metadata.')
      // metadata() alone accepts truncated pixel data; force bounded decoding.
      await input.raw().toBuffer()
    } catch (error) {
      if (error instanceof DomainError) throw error
      invalid('An archive image cannot be decoded safely.')
    }
    inspected.push({
      mediaId: object.media_id,
      kind: object.kind,
      bytes,
      mimeType: metadata.mime_type,
      hash: object.sha256,
    })
  }
  return inspected
}

export async function prepareSiteArchive(requestId: string, destination: SiteArchiveDestination, input: unknown) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
    invalid('Reload the import form before trying again.')
  const target = SiteArchiveDestination.parse(destination)
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_SITE_ARCHIVE_BYTES)
    invalid('Content archives must be 64 MB or smaller.')
  const archive = parseSiteArchive(input)
  const inspected = await inspectArchiveObjects(archive)
  const ids = new Map<string, string>()
  for (const list of Object.values(archive.content))
    if (Array.isArray(list)) {
      for (const row of list) if ('id' in row) ids.set(row.id, importedId(requestId, row.id))
    }
  const content = remapArchiveValue(archive.content, ids) as SiteArchiveContent
  // Immutable script/CSS bytes may still use the source site's checksum paths.
  // Only exact files in the same historical bundle receive a local alias.
  for (const [index, row] of (content.site_file_versions ?? []).entries()) {
    const source = archive.content.site_file_versions![index]!,
      paths = structuredClone(source.bundle.paths ?? []).map(path => ({ ...path, fileId: ids.get(path.fileId)! }))
    for (const fileId of source.bundle.files) {
      const file = archive.content.site_files!.find(file => file.id === fileId)!,
        path = siteFileAddress(file)
      if (!paths.some(item => item.path === path)) paths.push({ path, fileId: ids.get(fileId)! })
    }
    row.bundle.paths = paths
    // Authored DOM identities are literal attributes, even when they happen to
    // equal a CMS UUID. Remap only the closed CMS pins and page identities.
    if (source.bundle.original)
      row.bundle.original = {
        ...structuredClone(source.bundle.original),
        definitions: source.bundle.original.definitions.map(pin => ({
          ...pin,
          section_def_id: ids.get(pin.section_def_id)!,
        })),
        pages: source.bundle.original.pages.map(page => ({ ...structuredClone(page), pageId: ids.get(page.pageId)! })),
      }
    const native: SiteNativeAlias[] = (source.bundle.native ?? []).map(alias =>
      alias.kind === 'asset'
        ? { ...alias, assetId: ids.get(alias.assetId)! }
        : { ...alias, mediaId: ids.get(alias.mediaId)! },
    )
    const hasNative = (kind: string, id: string) =>
      native.some(alias => alias.kind === kind && alias.sourceId.toLowerCase() === id.toLowerCase())
    // An opaque file does not grant access to every ready image in its site.
    // Keep explicit dependency limits and infer only identities present in the
    // selected, verified JS/CSS/JSON bytes (including constructed native URLs).
    const referenced = new Set<string>()
    for (const file of archive.content.site_files ?? [])
      if (source.bundle.files.includes(file.id) && ['script', 'stylesheet', 'data'].includes(file.kind)) {
        const bytes = inspected.find(object => object.kind === 'site-file' && object.mediaId === file.id)!.bytes
        for (const match of Buffer.from(bytes)
          .toString('utf8')
          .matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi))
          referenced.add(match[0].toLowerCase())
      }
    for (const asset of archive.content.site_assets ?? [])
      if (
        !hasNative('asset', asset.id) &&
        (referenced.has(asset.id.toLowerCase()) ||
          source.bundle.native?.some(alias => alias.kind === 'asset' && alias.assetId === asset.id))
      )
        native.push({ kind: 'asset', sourceId: asset.id, assetId: ids.get(asset.id)! })
    for (const image of archive.content.media)
      if (image.status === 'ready' && !hasNative('media', image.id)) {
        const explicit =
          source.bundle.native?.flatMap(alias =>
            alias.kind === 'media' && alias.mediaId === image.id ? alias.variants : [],
          ) ?? []
        if (!explicit.length && !referenced.has(image.id.toLowerCase())) continue
        const variants = explicit.length
          ? [...new Set(explicit)]
          : ([
              'original',
              ...archive.content.media_variants
                .filter(variant => variant.media_id === image.id && variant.kind !== 'original')
                .map(variant => variant.kind),
            ] as ('original' | 'thumbnail' | 'card' | 'wide')[])
        native.push({ kind: 'media', sourceId: image.id, mediaId: ids.get(image.id)!, variants })
      }
    if (native.length || source.bundle.native) row.bundle.native = native
    if (!SiteFileBundle.safeParse(row.bundle).success)
      invalid(
        'The imported site needs more resource addresses than one reviewed version supports. Use an operator backup for this site.',
      )
  }
  content.site = { ...content.site, ...target }
  // Scope names are private to this import and cannot collide with an installed
  // global definition or change another site's library. Source remains authored.
  for (const row of content.section_defs) {
    row.slug = `import-${row.id}`
    row.scope = 'site'
  }
  const definitions = new Map(content.section_defs.map(row => [row.id, row]))
  const compiledVersions = content.section_def_versions.map(row => {
    const definition = definitions.get(row.section_def_id)!
    const compiled = compileDefinitionDraft({
      slug: definition.slug,
      name: definition.name,
      category: definition.category,
      sourceHtml: row.source_html,
      sourceCss: row.source_css,
      slots: row.slots,
      definitionKind: row.definition_kind,
      structuredDoc: row.structured_doc,
      scope: 'site',
      siteId: requestId,
      changelog: row.changelog,
      placement: definition.placement ?? 'page',
    })
    if (compiled.blocking.length)
      invalid(`Section “${definition.name}” cannot be imported: ${compiled.blocking.join(' ')}`)
    if (definition.placement && definition.placement !== 'page' && compiled.carriesTrustedCode) {
      invalid(`The ${definition.placement} component “${definition.name}” cannot carry trusted code.`)
    }
    return {
      ...row,
      compiled_ast: compiled.ast,
      compiled_css: compiled.css,
      render_hash: compiled.renderHash,
      sanitizer_policy_version: compiled.ast.policyVersion,
      css_policy_version: compiled.ast.cssPolicyVersion,
      carries_trusted_code: compiled.carriesTrustedCode,
    }
  })
  const objects = inspected.map(object => {
    const mediaId = ids.get(object.mediaId)!
    const ext =
      object.kind === 'asset' || object.kind === 'site-file'
        ? 'bin'
        : object.mimeType === 'image/jpeg'
          ? 'jpg'
          : object.mimeType.slice(6)
    return {
      ...object,
      mediaId,
      objectKey:
        object.kind === 'site-file'
          ? `site-files/${requestId}/${mediaId}/${object.hash}`
          : `site-imports/${requestId}/${mediaId}/${object.kind}/${object.hash}.${ext}`,
    }
  })
  const byObject = new Map(objects.map(object => [`${object.mediaId}:${object.kind}`, object.objectKey]))
  const bundle = {
    ...content,
    section_def_versions: compiledVersions,
    ...(content.site_files === undefined
      ? {}
      : {
          site_files: content.site_files.map(row => ({
            ...row,
            object_key: byObject.get(`${row.id}:site-file`)!,
            mime_type: objects.find(object => object.mediaId === row.id && object.kind === 'site-file')!.mimeType,
          })),
        }),
    ...(content.site_assets === undefined
      ? {}
      : { site_assets: content.site_assets.map(row => ({ ...row, object_key: byObject.get(`${row.id}:asset`)! })) }),
    media: content.media.map(row => ({ ...row, object_key: byObject.get(`${row.id}:original`)! })),
    media_variants: content.media_variants.map(row => ({
      ...row,
      object_key: byObject.get(`${row.media_id}:${row.kind}`)!,
    })),
  }
  const sourceHeads = Object.fromEntries(
    ['pages', 'themes', 'navigations', 'global_elements', 'site_settings', 'collections', 'collection_entries'].map(
      table => [
        table,
        (archive.content[table as keyof SiteArchiveContent] as { id: string }[]).map(row => ({ ...row })),
      ],
    ),
  )
  return { bundle, objects, sourceHeads }
}

export async function importSiteArchiveInTransaction(
  client: Queryable,
  requestId: string,
  destination: SiteArchiveDestination,
  archive: unknown,
  media: MediaStore,
  reviewedSiteFiles = false,
): Promise<string> {
  // Reauthorize before decoding or writing any supplied object. The SQL commit
  // command independently repeats this check, rather than trusting its caller.
  const allowed = (await client.query<{ allowed: boolean }>('SELECT app.is_super_admin() AS allowed')).rows[0]?.allowed
  if (!allowed) throw new DomainError('not_authorized', 'Only a super admin can import a site.')
  const validated = parseSiteArchive(archive)
  if (requiresSiteFileReview(validated.content) && !reviewedSiteFiles)
    invalid('Review every site file, its size and source before importing it.')
  for (const file of validated.content.site_files ?? [])
    if (/[\u0000-\u001f\u007f]|:\/\/[^/]*@/.test(file.source))
      invalid('Site file sources must not contain credentials or control characters.')
  const prepared = await prepareSiteArchive(requestId, destination, validated)
  // Objects are immutable and request-namespaced. Failed transactions can leave
  // unreferenced objects; never delete them during a retry that may have committed.
  for (const object of prepared.objects) {
    await media.put(object.objectKey, object.bytes, object.mimeType)
    if (object.kind === 'site-file') {
      const stored = await media.get(object.objectKey)
      if (!stored || stored.length !== object.bytes.length || sha256(stored) !== object.hash)
        invalid('Stored site file bytes differ from the reviewed archive.')
    }
  }
  const siteId = (
    await client.query<{ site_id: string }>('SELECT app.import_site_content($1,$2,$3) AS site_id', [
      requestId,
      JSON.stringify({
        ...prepared.bundle,
        ...(requiresSiteFileReview(validated.content) ? { site_file_reviewed: true } : {}),
      }),
      JSON.stringify(prepared.sourceHeads),
    ])
  ).rows[0]!.site_id
  // The same private preview address a wizard-made site gets, in the same
  // transaction. Without a staging domain (some hosted setups) the site waits
  // for a connected domain instead.
  const hostname = stagingHostnameFor(prepared.bundle.site.slug)
  if (hostname) await client.query('SELECT app.assign_imported_site_address($1,$2)', [siteId, hostname])
  return siteId
}
export async function importSiteArchive(
  userId: string,
  requestId: string,
  destination: SiteArchiveDestination,
  archive: unknown,
  media: MediaStore,
  reviewedSiteFiles = false,
): Promise<string> {
  return asUser({ userId, requestId }, client =>
    importSiteArchiveInTransaction(client, requestId, destination, archive, media, reviewedSiteFiles),
  )
}
