import { storedObjectNotModified } from './stored-object-response.ts'
import { createHash } from 'node:crypto'
import { siteFileAddress, SiteFileName, SiteFilePath, type SiteFileKind, type SiteFileView } from '@cms/schema'
import type { Queryable } from './publication.ts'
import type { MediaStore } from './ports.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
export const siteFileUrl = siteFileAddress

/** Files are reviewed executable artifacts, never section values. Validate
 * their transport type without evaluating JavaScript or trusting its filename. */
export function inspectReviewedSiteFile(
  bytes: Uint8Array,
  kind: SiteFileKind,
  name: string,
): { mimeType: string; sha256: string } {
  SiteFileName.parse(name)
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('Choose a file between 1 byte and 25 MB.')
  const buffer = Buffer.from(bytes)
  let mimeType: string | undefined
  if (['script', 'stylesheet', 'data'].includes(kind)) {
    if (bytes.length > 5 * 1024 * 1024) throw new Error('Scripts, stylesheets and data must be 5 MB or smaller.')
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (value.includes('\0')) throw new Error('Text files cannot contain null bytes.')
    if (kind === 'script' && /\.js$/i.test(name) && !/^\s*(?:<!doctype|<html|<script)\b/i.test(value))
      mimeType = 'text/javascript'
    if (
      kind === 'stylesheet' &&
      /\.css$/i.test(name) &&
      !/@import\b|expression\s*\(|javascript\s*:|<\/?(?:style|script)\b/i.test(value)
    )
      mimeType = 'text/css'
    if (kind === 'data' && /\.json$/i.test(name)) {
      JSON.parse(value)
      mimeType = 'application/json'
    }
  } else if (kind === 'font') {
    const magic = buffer.subarray(0, 4).toString('ascii')
    mimeType =
      magic === 'wOF2'
        ? 'font/woff2'
        : magic === 'wOFF'
          ? 'font/woff'
          : magic === 'OTTO'
            ? 'font/otf'
            : buffer.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0]))
              ? 'font/ttf'
              : undefined
  } else if (kind === 'image') {
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mimeType = 'image/png'
    else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) mimeType = 'image/jpeg'
    else if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) mimeType = 'image/gif'
    else if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP')
      mimeType = 'image/webp'
    else if (/\.svg$/i.test(name)) {
      const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (/<svg\b/i.test(value) && !/<(?:script|foreignObject)\b|\bon[a-z]+\s*=|<!ENTITY|javascript\s*:/i.test(value))
        mimeType = 'image/svg+xml'
    }
  }
  if (!mimeType) throw new Error('The file content does not match a supported site file type.')
  return { mimeType, sha256: digest(bytes) }
}

/** Register only after exact object readback. The normal user transaction
 * owns the metadata; deterministic create-only storage safely survives retries. */
export async function registerReviewedSiteFile(input: {
  client: Queryable
  store: MediaStore
  siteId: string
  kind: SiteFileKind
  name: string
  source: string
  bytes: Uint8Array
}): Promise<SiteFileView> {
  if (!uuid.test(input.siteId)) throw new Error('Choose a valid site.')
  const access = (
    await input.client.query<{ allowed: boolean; available: boolean }>(
      "SELECT app.is_super_admin() AS allowed,EXISTS(SELECT 1 FROM sites WHERE id=$1 AND status<>'archived') AS available",
      [input.siteId],
    )
  ).rows[0]
  if (!access?.allowed) throw new Error('Only a Super Admin can add site files.')
  if (!access.available) throw new Error('This site is unavailable.')
  if (!input.source.trim() || input.source.length > 2000 || /[\u0000-\u001f\u007f]|:\/\/[^/]*@/.test(input.source))
    throw new Error('Add the original public source or local source path, without credentials.')
  const inspected = inspectReviewedSiteFile(input.bytes, input.kind, input.name)
  const identity = digest(
    `cms-site-file:1:${input.siteId.toLowerCase()}:${input.kind}:${input.name}:${input.source}:${inspected.sha256}`,
  )
  const id = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-4${identity.slice(13, 16)}-a${identity.slice(17, 20)}-${identity.slice(20, 32)}`
  const key = `site-files/${input.siteId.toLowerCase()}/${id}/${inspected.sha256}`
  await input.store.put(key, input.bytes, inspected.mimeType)
  const stored = await input.store.get(key)
  if (!stored || stored.length !== input.bytes.length || digest(stored) !== inspected.sha256)
    throw new Error('Stored bytes differ from the reviewed file.')
  await input.client.query('SELECT app.register_site_file($1,$2,$3,$4,$5,$6,$7,$8)', [
    input.siteId,
    id,
    input.kind,
    input.name,
    input.source,
    inspected.mimeType,
    input.bytes.length,
    inspected.sha256,
  ])
  return {
    id,
    kind: input.kind,
    name: input.name,
    source: input.source,
    bytes: input.bytes.length,
    sha256: inspected.sha256,
  }
}
export type ResolvedSiteFile = {
  id: string
  site_id: string
  kind: SiteFileKind
  name: string
  source: string
  object_key: string
  mime_type: string
  bytes: string | number
  sha256: string
}
const FILE_TYPES: Record<SiteFileKind, readonly string[]> = {
  script: ['text/javascript'],
  stylesheet: ['text/css'],
  data: ['application/json'],
  font: ['font/woff2', 'font/woff', 'font/otf', 'font/ttf'],
  image: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'],
}

function isValidCacheReceipt(file: ResolvedSiteFile) {
  const bytes = Number(file.bytes)
  const limit = file.kind === 'image' || file.kind === 'font' ? 25 : 5
  return (
    Number.isSafeInteger(bytes) &&
    bytes > 0 &&
    bytes <= limit * 1024 * 1024 &&
    FILE_TYPES[file.kind]?.includes(file.mime_type)
  )
}

/** The resolver supplies a published, host-bound receipt. Never accept a
 * storage key, guessed content type, or a caller-provided approval flag. */
export async function deliverReviewedSiteFile(input: {
  fileId: string
  sha256: string
  name: string
  store: MediaStore
  resolve: () => Promise<ResolvedSiteFile | null>
  visibility: 'public' | 'admin'
  request?: Request
}): Promise<Response> {
  const hidden = () =>
    new Response(null, { status: 404, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
  if (!uuid.test(input.fileId) || !/^[a-f0-9]{64}$/.test(input.sha256) || !SiteFileName.safeParse(input.name).success)
    return hidden()
  const file = await input.resolve()
  if (
    !file ||
    file.id !== input.fileId ||
    file.sha256 !== input.sha256 ||
    file.name !== input.name ||
    file.object_key !== `site-files/${file.site_id}/${file.id}/${file.sha256}`
  )
    return hidden()
  const headers = {
    'content-type': file.mime_type,
    'content-length': String(Number(file.bytes)),
    'x-content-type-options': 'nosniff',
    'cache-control': input.visibility === 'public' ? 'public, max-age=0, must-revalidate' : 'private, no-store',
    etag: `"${file.sha256}"`,
    'content-security-policy': "default-src 'none'; sandbox",
    'referrer-policy': 'no-referrer',
  }
  if (input.visibility === 'public' && isValidCacheReceipt(file)) {
    const unchanged = storedObjectNotModified(input.request, headers)
    if (unchanged) return unchanged
  }
  const bytes = await input.store.get(file.object_key)
  if (!bytes || bytes.length !== Number(file.bytes) || digest(bytes) !== file.sha256) return hidden()
  let inspected: { mimeType: string; sha256: string }
  try {
    inspected = inspectReviewedSiteFile(bytes, file.kind, file.name)
  } catch {
    return hidden()
  }
  if (inspected.mimeType !== file.mime_type) return hidden()
  return new Response(new Uint8Array(bytes), { headers })
}

/** An exact approved original address resolves to an authoritative receipt.
 * Reuse the same byte/type verification as canonical immutable addresses. */
export async function deliverReviewedSiteFileAtPath(input: {
  path: string
  store: MediaStore
  resolve: (path: string) => Promise<ResolvedSiteFile | null>
  visibility: 'public' | 'admin'
  request?: Request
}): Promise<Response> {
  const hidden = () =>
    new Response(null, { status: 404, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
  if (!SiteFilePath.safeParse(input.path).success) return hidden()
  const file = await input.resolve(input.path)
  if (!file) return hidden()
  return deliverReviewedSiteFile({
    fileId: file.id,
    sha256: file.sha256,
    name: file.name,
    store: input.store,
    resolve: async () => file,
    visibility: input.visibility,
    request: input.request,
  })
}
