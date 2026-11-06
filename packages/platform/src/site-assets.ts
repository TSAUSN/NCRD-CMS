import { createHash } from 'node:crypto'
import { SITE_FONT_REGISTRY, SiteAssetProvenance, type SiteFontKey } from '@cms/schema'
import type { Queryable } from './publication.ts'
import type { MediaStore } from './ports.ts'

export const SITE_ASSET_LIMIT = 25 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
export function inspectSiteAsset(bytes: Uint8Array, kind: 'document' | 'font', fontKey: SiteFontKey | null) {
  if ((kind !== 'document' && kind !== 'font') || !bytes.length || bytes.length > SITE_ASSET_LIMIT)
    throw new Error('Documents and fonts must be 25 MB or smaller.')
  const contentHash = hash(bytes)
  if (kind === 'font') {
    const font = fontKey && SITE_FONT_REGISTRY[fontKey]
    if (!font || font.sha256 !== contentHash) throw new Error('This font is not an exact registered migration font.')
    return { mimeType: font.mimeType, contentHash }
  }
  // PDFs are downloads, never inline application documents or rendered HTML.
  const buffer = Buffer.from(bytes)
  if (
    fontKey !== null ||
    !buffer
      .subarray(0, 8)
      .toString('ascii')
      .match(/^%PDF-(1\.[0-9]|2\.0)/) ||
    !buffer.subarray(-2048).includes(Buffer.from('%%EOF'))
  )
    throw new Error('The document is not a complete PDF file.')
  return { mimeType: 'application/pdf' as const, contentHash }
}

/** Caller owns the transaction; no reads of arbitrary filesystem paths or URLs. */
export async function importFrozenSiteAsset(input: {
  client: Queryable
  store: MediaStore
  siteId: string
  bytes: Uint8Array
  kind: 'document' | 'font'
  fontKey?: SiteFontKey
  originalName: string
  provenance: { path: string; sha256: string; manifest_sha256: string }
}) {
  const allowed = (await input.client.query<{ allowed: boolean }>('SELECT app.is_super_admin() AS allowed')).rows[0]
    ?.allowed
  if (!allowed) throw new Error('Only a super admin can import frozen site assets.')
  if (!UUID.test(input.siteId)) throw new Error('Invalid destination site.')
  const provenance = SiteAssetProvenance.parse(input.provenance)
  const inspected = inspectSiteAsset(input.bytes, input.kind, input.fontKey ?? null)
  if (provenance.sha256 !== inspected.contentHash)
    throw new Error('The asset does not match its frozen source checksum.')
  const identity = hash(
    `cms-site-asset:1:${input.siteId}:${inspected.contentHash}:${input.fontKey ?? 'document'}:${provenance.path}:${provenance.manifest_sha256}`,
  )
  const assetId = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-4${identity.slice(13, 16)}-a${identity.slice(17, 20)}-${identity.slice(20, 32)}`
  const objectKey = `site-assets/${input.siteId}/${assetId}/${inspected.contentHash}`
  await input.store.put(objectKey, input.bytes, inspected.mimeType)
  const stored = await input.store.get(objectKey)
  if (!stored || hash(stored) !== inspected.contentHash) throw new Error('Stored asset checksum verification failed.')
  await input.client.query('SELECT app.import_site_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
    input.siteId,
    assetId,
    input.kind,
    objectKey,
    inspected.mimeType,
    input.bytes.byteLength,
    inspected.contentHash,
    input.originalName,
    input.fontKey ?? null,
    JSON.stringify(provenance),
  ])
  return { assetId, url: `/assets/${assetId}`, fontKey: input.fontKey ?? null }
}

/** PDF filenames are kept verbatim in immutable receipts and download headers. */
export function isSiteDocumentName(name: string): boolean {
  return (
    name.length >= 5 &&
    name.length <= 255 &&
    name === name.trim() &&
    !/[\u0000-\u001f\u007f/\\]/.test(name) &&
    /\.pdf$/i.test(name)
  )
}

export type UploadedSiteDocument = { id: string; originalName: string; bytes: number; url: string }

/**
 * Caller owns the user-scoped transaction. The authorization command locks the
 * active site before storage; registration rechecks the same permission. A
 * repeat of the same site, PDF bytes and name has exactly the same identity.
 */
export async function uploadSiteDocument(input: {
  client: Queryable
  store: MediaStore
  siteId: string
  bytes: Uint8Array
  originalName: string
}): Promise<UploadedSiteDocument> {
  if (!UUID.test(input.siteId)) throw new Error('Invalid destination site.')
  await input.client.query('SELECT app.authorize_site_document_upload($1)', [input.siteId])
  if (!isSiteDocumentName(input.originalName)) throw new Error('Choose a PDF with a usable file name.')
  const inspected = inspectSiteAsset(input.bytes, 'document', null)
  const identity = hash(
    `cms-site-document:1:${input.siteId.toLowerCase()}:${inspected.contentHash}:${input.originalName}`,
  )
  const id = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-4${identity.slice(13, 16)}-a${identity.slice(17, 20)}-${identity.slice(20, 32)}`
  const objectKey = `site-assets/${input.siteId.toLowerCase()}/${id}/${inspected.contentHash}`
  await input.store.put(objectKey, input.bytes, inspected.mimeType)
  const stored = await input.store.get(objectKey)
  if (!stored || stored.length !== input.bytes.length || hash(stored) !== inspected.contentHash) {
    throw new Error('Stored document checksum verification failed.')
  }
  const row = (
    await input.client.query<{ id: string }>('SELECT app.upload_site_document($1,$2,$3,$4,$5) AS id', [
      input.siteId,
      id,
      input.bytes.byteLength,
      inspected.contentHash,
      input.originalName,
    ])
  ).rows[0]
  if (row?.id !== id) throw new Error('Document registration did not return its immutable identity.')
  return { id, originalName: input.originalName, bytes: input.bytes.byteLength, url: `/assets/${id}` }
}

export type ResolvedSiteAsset = {
  id: string
  kind: 'document' | 'font'
  object_key: string
  mime_type: string
  bytes: string | number
  content_hash: string
  original_name: string
  font_key: SiteFontKey | null
}
/** Identity and access come from the resolver. The route never accepts a storage key. */
export async function deliverSiteAsset(input: {
  assetId: string
  resolve: () => Promise<ResolvedSiteAsset | null>
  store: MediaStore
  visibility: 'admin' | 'public'
}): Promise<Response> {
  const hidden = () =>
    new Response(null, { status: 404, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
  if (!UUID.test(input.assetId)) return hidden()
  const asset = await input.resolve()
  if (
    !asset ||
    asset.id !== input.assetId ||
    !Number.isSafeInteger(Number(asset.bytes)) ||
    Number(asset.bytes) < 1 ||
    Number(asset.bytes) > SITE_ASSET_LIMIT
  )
    return hidden()
  const bytes = await input.store.get(asset.object_key)
  if (!bytes || bytes.length !== Number(asset.bytes)) return hidden()
  try {
    const inspected = inspectSiteAsset(bytes, asset.kind, asset.font_key)
    if (inspected.contentHash !== asset.content_hash || inspected.mimeType !== asset.mime_type) return hidden()
  } catch {
    return hidden()
  }
  return new Response(bytes as unknown as ConstructorParameters<typeof Response>[0], {
    headers: {
      'content-type': asset.mime_type,
      'content-length': String(bytes.length),
      // Recheck publication/membership; immutable bytes do not imply permanent access.
      'cache-control': input.visibility === 'admin' ? 'private, no-store' : 'public, max-age=0, must-revalidate',
      etag: `"sha256-${asset.content_hash}"`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
      'content-disposition':
        asset.kind === 'document'
          ? `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(asset.original_name).replace(/'/g, '%27')}`
          : 'inline',
    },
  })
}
