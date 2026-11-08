import 'server-only'
import { createHash } from 'node:crypto'
import { loadavg } from 'node:os'
import { asUser, configuredMediaStore, poolFor } from '@cms/platform'
import { processMediaUpload } from '../../../worker/src/media.ts'
import { createPostgresMediaProcessingRepository } from '../../../worker/src/media-repository.ts'
import { createPostgresAdminMediaDeliveryRepository } from './media-delivery-repository.ts'
import { getSite } from './queries.ts'
import { createBeginMediaUploadHandler, createReceiveMediaUploadHandler } from './media-upload-handler.ts'
import {
  createPostgresAdminMediaUploadRepository,
  createPostgresMediaUploadStatusRepository,
} from './media-upload-repository.ts'
export type ReferenceImage = {
  key: string
  file: string
  name?: string
  source: string
  altText: string
  sourceSha256: string
  focal: { x: number; y: number }
  needsReplacement: boolean
}
export type ImportedReferenceImage = {
  key: string
  file: string
  source: string
  sourceSha256: string
  mediaId: string
  contentHash: string
  needsReplacement: boolean
}
/** Explicit local import through the same receipt/processor commands as the picker. No source fetch. */
export type ReferenceMediaProfile = {
  folder: string
  tags: string[]
  attribution: string
  replacementAttribution: string
}
export async function importReferenceMedia(input: {
  profile: ReferenceMediaProfile
  userId: string
  siteId: string
  images: readonly ReferenceImage[]
  readSource: (file: string) => Promise<Uint8Array>
  previous?: readonly ImportedReferenceImage[]
  onItem?: (rows: ImportedReferenceImage[]) => Promise<void>
  /** Default to the real operator machine; deterministic callers can supply a sampler. */
  machineLoad?: () => number
}) {
  const site = await getSite(input.userId, input.siteId)
  if (!site || site.original_design) throw new Error('Choose an available native site for these reference photos.')
  if (
    new Set(input.images.map(row => row.key)).size !== input.images.length ||
    new Set(input.images.map(row => row.source)).size !== input.images.length
  )
    throw new Error('The reference list has duplicate images.')
  const files = new Map<string, Uint8Array>()
  for (const image of input.images) {
    if (!/^[^/\\]+\.(?:png|jpe?g|webp)$/i.test(image.file) || !image.altText.trim())
      throw new Error('The reference image details are incomplete.')
    const bytes = await input.readSource(image.file)
    if (createHash('sha256').update(bytes).digest('hex') !== image.sourceSha256)
      throw new Error('The local reference file changed: ' + image.file)
    files.set(image.key, bytes)
  }
  const media = configuredMediaStore()
  const repository = createPostgresAdminMediaUploadRepository()
  const begin = createBeginMediaUploadHandler({
    currentSession: async () => ({ userId: input.userId }),
    repository,
    media,
  })
  const receive = createReceiveMediaUploadHandler({ repository, media })
  const status = createPostgresMediaUploadStatusRepository()
  const processor = createPostgresMediaProcessingRepository(poolFor('worker'), 'local-reference-import')
  const delivery = createPostgresAdminMediaDeliveryRepository()
  const origin = process.env['ADMIN_ORIGIN'] ?? 'http://localhost:3000'
  const rows: ImportedReferenceImage[] = []
  for (const image of input.images) {
    if ((input.machineLoad?.() ?? loadavg()[0]!) > 12)
      throw new Error('Machine load is above 12. Import paused before the next image.')
    const existing = await asUser(
      { userId: input.userId },
      async client =>
        (
          await client.query<{ id: string; status: string }>(
            'SELECT id,status FROM media WHERE site_id=$1 AND source=$2 AND deleted_at IS NULL',
            [input.siteId, image.source],
          )
        ).rows,
    )
    if (!existing.length && input.previous?.some(row => row.key === image.key))
      throw new Error(
        'The recorded reference image changed or was removed. Review it before importing again: ' + image.file,
      )
    if (existing.length) {
      const old = input.previous?.find(row => row.key === image.key)
      const asset = existing[0]!
      const original = await delivery.resolve(input.userId, asset.id, 'original')
      if (
        existing.length !== 1 ||
        !old ||
        old.mediaId !== asset.id ||
        old.sourceSha256 !== image.sourceSha256 ||
        !original ||
        old.contentHash !== original.contentHash ||
        asset.status !== 'ready'
      )
        throw new Error('Review the existing reference image before importing again: ' + image.file)
      const stored = await media.get(original!.objectKey)
      if (!stored || createHash('sha256').update(stored).digest('hex') !== original!.contentHash)
        throw new Error('The stored reference image needs attention: ' + image.file)
      rows.push(old)
      await input.onItem?.([...rows])
      continue
    }
    const bytes = files.get(image.key)!
    const mime = /\.png$/i.test(image.file) ? 'image/png' : /\.webp$/i.test(image.file) ? 'image/webp' : 'image/jpeg'
    const body = JSON.stringify({
      originalName: image.name ?? image.file,
      contentType: mime,
      bytes: bytes.length,
      altText: image.altText,
      decorative: false,
      focal: image.focal,
      folder: input.profile.folder,
      attribution: image.needsReplacement ? input.profile.replacementAttribution : input.profile.attribution,
      source: image.source,
      tags: [...input.profile.tags, ...(image.needsReplacement ? ['needs replacement'] : [])],
    })
    const started = await begin(
      new Request(origin + '/api/sites/' + input.siteId + '/media/uploads', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
        body,
      }),
      input.siteId,
    )
    const intent = (await started.json()) as {
      intentId: string
      upload: { url: string; headers: Record<string, string> }
      error?: { message: string }
    }
    if (started.status !== 201) throw new Error(intent.error?.message ?? 'The reference upload could not start.')
    const received = await receive(
      new Request(new URL(intent.upload.url, origin), {
        method: 'PUT',
        headers: { ...intent.upload.headers, origin, 'content-type': mime, 'content-length': String(bytes.length) },
        body: new Uint8Array(bytes).buffer,
      }),
      intent.intentId,
    )
    if (received.status !== 202) throw new Error('The reference upload was refused: ' + image.file)
    await processMediaUpload(intent.intentId, { media, repository: processor })
    const ready = await status.read(input.userId, intent.intentId)
    if (ready?.status !== 'ready' || !ready.asset || ready.asset.siteId !== input.siteId)
      throw new Error('The reference image did not finish processing: ' + image.file)
    const original = await delivery.resolve(input.userId, ready.asset.id, 'original')
    if (!original) throw new Error('The ready reference image could not be read.')
    rows.push({
      key: image.key,
      file: image.file,
      source: image.source,
      sourceSha256: image.sourceSha256,
      mediaId: ready.asset.id,
      contentHash: original.contentHash,
      needsReplacement: image.needsReplacement,
    })
    await input.onItem?.([...rows])
  }
  return rows
}
