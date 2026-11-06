// Write one site's V1 library into V2 as that site's own definitions
// (SPEC §6.14, LIB-01). Everything goes through product commands as the
// operator: `app.upsert_section_def_version` for each definition and
// `app.import_v1_inspected_media` for a picture the site has not imported yet,
// from the same frozen V1 run, so its bytes are checked against the manifest.
// A definition that already exists for the site is left exactly as it is, so a
// rerun never replaces anything an editor has changed. With `refresh`, one whose
// latest version is still exactly what this import wrote gets a new version
// when the mapping has improved since; pages keep the version they use until
// an editor updates them, and a definition anyone has edited is never touched.
import { readFileSync } from 'node:fs'
import { processMediaBytes, sniffImageFormat } from '../../../apps/worker/src/media.ts'
import type { MediaStore } from '../../platform/src/ports.ts'
import { containedFile, digest } from './backup.ts'
import {
  catalogueLibraryFor,
  librarySlug,
  mapLibrarySection,
  LIBRARY_SITES,
  type LibrarySite,
} from './catalogue-library.ts'
import type { ImportClient } from './database.ts'
import { attribute, parseHtml, type HtmlNode } from './html.ts'
import { migrationMediaId, remapReferenceUrls, type ImportedAsset } from './media-transfer.ts'
import type { V1Catalogue } from './source.ts'

const REPOSITORIES: Record<LibrarySite, string> = {
  humanneedsindex: 'tsa-humanneedsindex',
  echelonsymposium: 'tsa-echelonsymposium',
}

export type LibraryImportReport = {
  site: LibrarySite
  offered: number
  created: { sourceId: string; slug: string; disposition: 'fields' | 'static' }[]
  existing: string[]
  /** Re-mapped as a new version (`refresh`). */
  refreshed: { sourceId: string; slug: string; version: number }[]
  /** Left alone by `refresh` because someone changed it after the import. */
  edited: string[]
  refused: { sourceId: string; reason: string }[]
  importedImages: string[]
  unresolved: { sourceId: string; urls: string[] }[]
}

/** Caller owns a transaction with a super-admin actor (as the migration CLI does). */
export async function importCatalogueLibrary(
  client: ImportClient,
  input: {
    runId: string
    siteId: string
    site: LibrarySite
    catalogue: V1Catalogue
    sourceRoot: string
    store: MediaStore
    /** The site's own V1 stylesheet, for the brand variables its sections read. */
    siteCss: string
    /** Give an unedited imported definition a new version when its mapping has changed. */
    refresh?: boolean
  },
): Promise<LibraryImportReport> {
  const { runId, siteId, site } = input
  if (!(await client.query('SELECT app.is_super_admin() AS allowed')).rows[0]?.allowed)
    throw new Error('only a super admin can import the V1 library')
  if (
    !(
      await client.query('SELECT 1 FROM public.v1_import_targets WHERE run_id=$1 AND site_id=$2 LIMIT 1', [
        runId,
        siteId,
      ])
    ).rows.length
  ) {
    throw new Error('the destination site was not created by this V1 import run')
  }
  const files = new Map(
    (
      await client.query(
        `SELECT f->>'path' AS path, f->>'sha256' AS sha256, (f->>'bytes')::bigint AS bytes
    FROM public.v1_import_runs r, jsonb_array_elements(r.bundle->'files') f WHERE r.id=$1`,
        [runId],
      )
    ).rows.map(row => [String(row.path), { sha256: String(row.sha256), bytes: Number(row.bytes) }]),
  )
  const assets = new Map<string, ImportedAsset>()
  for (const row of (
    await client.query('SELECT source_path, media_id FROM public.v1_import_media WHERE run_id=$1 AND site_id=$2', [
      runId,
      siteId,
    ])
  ).rows) {
    const local = /^asset\/[^/]+\/public(\/.+)$/.exec(String(row.source_path))?.[1]
    if (local && !assets.has(local))
      assets.set(local, { url: `/media/${row.media_id}/original`, mediaId: String(row.media_id) })
  }
  // V1 links between a site's own pages, as V2 addresses of that site's pages.
  const links = new Map<string, string>([
    ['/index.html', '/'],
    ['/', '/'],
  ])
  for (const row of (
    await client.query('SELECT slug FROM public.pages WHERE site_id=$1 AND archived_at IS NULL', [siteId])
  ).rows) {
    const slug = String(row.slug)
    if (slug && !slug.startsWith('source-')) links.set(`/${slug}.html`, `/${slug}`)
  }
  const existing = new Map(
    (
      await client.query(
        `SELECT d.slug, v.changelog, v.render_hash, v.slots FROM public.section_defs d
    LEFT JOIN LATERAL (SELECT changelog, render_hash, slots FROM public.section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1) v ON true
    WHERE d.site_id=$1`,
        [siteId],
      )
    ).rows.map(row => [
      String(row.slug),
      {
        changelog: String(row.changelog ?? ''),
        renderHash: String(row.render_hash ?? ''),
        slots: row.slots as unknown,
      },
    ]),
  )

  const report: LibraryImportReport = {
    site,
    offered: 0,
    created: [],
    existing: [],
    refreshed: [],
    edited: [],
    refused: [],
    importedImages: [],
    unresolved: [],
  }
  const entries = catalogueLibraryFor(input.catalogue, site, input.siteCss)
  report.offered = entries.length
  for (const entry of entries) {
    const slug = librarySlug(site, entry.sourceId)
    if (entry.disposition === 'refused') {
      report.refused.push({ sourceId: entry.sourceId, reason: entry.reason ?? 'refused' })
      continue
    }
    const prior = existing.get(slug)
    if (prior && !input.refresh) {
      report.existing.push(entry.sourceId)
      continue
    }
    if (prior && !prior.changelog.startsWith(`${IMPORTED} ${entry.sourceId} `)) {
      report.edited.push(entry.sourceId)
      continue
    }
    for (const [url, alt] of imagesIn(entry.html)) {
      if (assets.has(url)) continue
      const imported = await importImage(client, {
        runId,
        siteId,
        site,
        url,
        alt,
        files,
        sourceRoot: input.sourceRoot,
        store: input.store,
      })
      if (imported) {
        assets.set(url, imported)
        report.importedImages.push(url)
      }
    }
    const remapped = remapReferenceUrls(entry.html, entry.css, assets, links)
    if (remapped.unresolved.length) report.unresolved.push({ sourceId: entry.sourceId, urls: remapped.unresolved })
    const faithful = mapLibrarySection(entry.sourceId, slug, remapped.html, remapped.css, entry.labels)
    if (faithful.disposition === 'refused') {
      report.refused.push({ sourceId: entry.sourceId, reason: faithful.reason })
      continue
    }
    const { mapped, slots } = faithful
    if (prior && prior.renderHash === mapped.compiled.renderHash && canonical(prior.slots) === canonical(slots)) {
      report.existing.push(entry.sourceId)
      continue
    }
    const saved = await client.query(
      'SELECT section_def_id,version FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
      [
        slug,
        entry.name.slice(0, 200),
        entry.category || 'V1 library',
        mapped.sourceHtml,
        remapped.css,
        mapped.compiled.css,
        JSON.stringify(mapped.compiled.ast),
        JSON.stringify(slots),
        mapped.compiled.renderHash,
        mapped.compiled.ast.policyVersion,
        mapped.compiled.ast.cssPolicyVersion,
        `${IMPORTED} ${entry.sourceId}${entry.variant ? ` (${LIBRARY_SITES[site]} variant)` : ''} from catalogue run ${input.catalogue.runId}, V1 import run ${runId}; brand from ${REPOSITORIES[site]}/src/style.css ${digest(input.siteCss).slice(0, 12)}.`,
        mapped.compiled.carriesTrustedCode,
        'legacy',
        null,
        null,
        'site',
        siteId,
      ],
    )
    if (prior) report.refreshed.push({ sourceId: entry.sourceId, slug, version: Number(saved.rows[0]!.version) })
    else report.created.push({ sourceId: entry.sourceId, slug, disposition: entry.disposition })
  }
  return report
}

/** Every version this import writes says so first; `refresh` touches nothing else. */
const IMPORTED = 'V1 library section'

/** JSON with object keys in one order, as Postgres returns jsonb in its own. */
function canonical(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, inner]) => [key, sort(inner)]),
          )
        : item
  return JSON.stringify(sort(value))
}

/** Local image addresses an entry shows, with the alt text its source gives each. */
function imagesIn(html: string): Map<string, string> {
  const found = new Map<string, string>()
  const parsed = parseHtml(html)
  if (!parsed.ok) return found
  const walk = (nodes: HtmlNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'text') continue
      const src = node.tag === 'img' ? attribute(node, 'src') : undefined
      if (src && /^\/images\/[^?#]+\.(?:png|jpe?g|webp)$/i.test(src) && !found.has(src))
        found.set(src, attribute(node, 'alt') ?? '')
      walk(node.children)
    }
  }
  walk(parsed.nodes)
  return found
}

/** Import one picture from the frozen run: the site's own copy first, else the other V1 site's. */
async function importImage(
  client: ImportClient,
  input: {
    runId: string
    siteId: string
    site: LibrarySite
    url: string
    alt: string
    files: Map<string, { sha256: string; bytes: number }>
    sourceRoot: string
    store: MediaStore
  },
): Promise<ImportedAsset | null> {
  const candidates = [
    REPOSITORIES[input.site],
    ...Object.values(REPOSITORIES).filter(repo => repo !== REPOSITORIES[input.site]),
  ].map(repo => `asset/${repo}/public${input.url}`)
  const path = candidates.find(candidate => input.files.has(candidate))
  if (!path) return null
  const file = input.files.get(path)!
  const bytes = readFileSync(containedFile(input.sourceRoot, path.slice('asset/'.length)))
  if (bytes.length !== file.bytes || digest(bytes) !== file.sha256)
    throw new Error('source media changed after inventory; regenerate the migration package')
  const format = sniffImageFormat(bytes)
  if (!format) return null
  const id = migrationMediaId(input.runId, input.siteId, path)
  const processed = await processMediaBytes(
    {
      intentId: id,
      siteId: input.siteId,
      uploadObjectKey: path,
      finalKeyPrefix: `v1-imports/${input.runId}/${input.siteId}/${id}/`,
      declaredMime: `image/${format}`,
      declaredBytes: bytes.length,
    },
    bytes,
  )
  for (const object of [processed.original, ...processed.variants]) {
    await input.store.put(object.objectKey, object.data, object.mimeType)
    const stored = await input.store.get(object.objectKey)
    if (!stored || digest(Buffer.from(stored)) !== object.sha256)
      throw new Error('stored library image failed its checksum verification')
  }
  const { data: _original, ...originalMetadata } = processed.original
  const variants = processed.variants.map(({ data: _data, ...variant }) => variant)
  await client.query('SELECT app.import_v1_inspected_media($1,$2,$3,$4,$5,$6,$7)', [
    input.runId,
    input.siteId,
    path,
    file.sha256,
    id,
    JSON.stringify({ ...originalMetadata, altText: input.alt, decorative: input.alt === '' }),
    JSON.stringify(variants),
  ])
  return { url: `/media/${id}/original`, mediaId: id }
}
