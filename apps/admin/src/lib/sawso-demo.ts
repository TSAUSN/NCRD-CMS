import { randomUUID, createHash } from 'node:crypto'
import { asUser, type MediaStore } from '@cms/platform'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { ensureSawsoSite } from './sawso-site.ts'
import { ensureSawsoCorePages, ensureSawsoPublicPages, sawsoMediaPhoto, type SawsoMediaMap } from './sawso-pages.ts'
import { ensureSawsoFrame } from './sawso-frame.ts'
import { ensureSawsoRedirects } from './redirects.ts'
import {
  createPostgresAdminMediaUploadRepository,
  createPostgresMediaUploadStatusRepository,
} from './media-upload-repository.ts'
export type DemoPhoto = {
  source: string
  original_name: string
  alt_text: string
  focal: { x: number; y: number }
  attribution: string
  tags: string[]
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp'
  content_hash: string
  base64: string
}
/** Existing released sites and all their drafts are left untouched. Initial
 * setup uses the same native builders, Media receipts and guarded processor. */
export async function ensureSawsoDemo(
  userId: string,
  photos: DemoPhoto[],
  media: MediaStore,
  processUpload: (id: string) => Promise<void>,
) {
  const site = await asUser({ userId }, async c => {
    await installCoreLibrary(c)
    const site = await ensureSawsoSite(c, randomUUID())
    const head = (await c.query('SELECT initial_release_required FROM sites WHERE id=$1', [site.siteId])).rows[0]!
    return { ...site, initial: head.initial_release_required }
  })
  if (!site.initial) return { id: site.siteId, created: false }
  const uploads = createPostgresAdminMediaUploadRepository()
  const statuses = createPostgresMediaUploadStatusRepository()
  const local: SawsoMediaMap = {}
  for (const photo of photos) {
    const found = await asUser(
      { userId },
      async c =>
        (
          await c.query(
            "SELECT id,alt_text,focal FROM media WHERE site_id=$1 AND source=$2 AND status='ready' AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
            [site.siteId, photo.source],
          )
        ).rows[0],
    )
    if (found) {
      local[photo.source] = found
      continue
    }
    const bytes = Buffer.from(photo.base64, 'base64')
    if (
      bytes.toString('base64') !== photo.base64 ||
      createHash('sha256').update(bytes).digest('hex') !== photo.content_hash
    )
      throw new Error('The local demo photo checksum changed.')
    const upload = await uploads.begin(userId, {
      siteId: site.siteId,
      originalName: photo.original_name,
      declaredMime: photo.mime_type,
      declaredBytes: bytes.length,
      altText: photo.alt_text,
      decorative: false,
      focal: photo.focal,
      folder: 'SAWSO photos',
      attribution: photo.attribution,
      source: photo.source,
      tags: photo.tags,
    })
    const receipt = await uploads.claimReceipt(upload.intentId, upload.uploadToken)
    if (!receipt) throw new Error('The photo upload receipt is unavailable.')
    await media.put(receipt.uploadObjectKey, bytes, photo.mime_type)
    await uploads.markReceived(receipt, photo.mime_type, bytes.length)
    await processUpload(upload.intentId)
    const state = await statuses.read(userId, upload.intentId)
    if (state?.status !== 'ready' || !state.asset)
      throw new Error('Normal Media processing did not finish the demo photo.')
    local[photo.source] = { id: state.asset.id, alt_text: state.asset.altText, focal: state.asset.focal ?? photo.focal }
  }
  await asUser({ userId }, async c => {
    await ensureSawsoCorePages(c, site.siteId)
    await ensureSawsoPublicPages(c, site.siteId, local)
    await ensureSawsoFrame(c, site.siteId)
    await ensureSawsoRedirects(c, site.siteId)
    const collection = (
      await c.query("SELECT id,entry_revision FROM collections WHERE site_id=$1 AND reader_key='stories'", [
        site.siteId,
      ])
    ).rows[0]!
    const entries = (
      await c.query(
        'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.id',
        [collection.id],
      )
    ).rows
    const rows = entries.map(e => {
      const p = sawsoMediaPhoto(local, e.values.image_url)
      return {
        id: e.id,
        stableKey: e.stable_key,
        values: {
          ...e.values,
          photo: { src: p.src, alt: p.alt, decorative: false },
          photo_is_sample: false,
          photo_note: '',
        },
      }
    })
    await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      collection.id,
      collection.entry_revision,
      JSON.stringify(rows),
    ])
  })
  return { id: site.siteId, created: true }
}
