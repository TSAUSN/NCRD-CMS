import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { closePools, asUser } from '../../packages/platform/src/index.ts'
import { createPostgresAdminMediaDeliveryRepository } from '../../apps/admin/src/lib/media-delivery-repository.ts'
import {
  importEchelonReferenceMedia,
  type EchelonImportedImage,
} from '../../apps/admin/src/lib/echelon-reference-media.ts'
const [actor, site, foreign] = process.argv.slice(2)
try {
  assert(actor && site && foreign)
  const file = 'r8-landscape.png',
    bytes = await readFile(resolve('apps/admin/public/cms-samples', file)),
    hash = createHash('sha256').update(bytes).digest('hex'),
    image = {
      key: 'reference',
      file,
      name: '[Reference photo].png',
      source: 'https://example.test/echelon/reference.png',
      sourceSha256: hash,
      altText: '[Reference photo description]',
      focal: { x: 0.3, y: 0.4 },
      needsReplacement: true,
    },
    count = async () =>
      (
        await asUser({ userId: actor }, client =>
          client.query('SELECT count(*)::int n FROM media WHERE site_id=$1', [site]),
        )
      ).rows[0]!.n,
    before = await count(),
    checkpoints: EchelonImportedImage[][] = []
  const transfer = { userId: actor, siteId: site, images: [image], readSource: async () => bytes }
  // The operator guard remains active. Exercise its refusal and use a fixed idle
  // machine for the upload behavior, so unrelated processes cannot break the fixture.
  await assert.rejects(importEchelonReferenceMedia({ ...transfer, machineLoad: () => 13 }), /Machine load is above 12/)
  assert.equal(await count(), before)
  const imported = await importEchelonReferenceMedia({
    ...transfer,
    machineLoad: () => 1,
    onItem: async rows => {
      checkpoints.push(rows)
    },
  })
  assert.equal(imported.length, 1)
  assert.equal(await count(), before + 1)
  assert.equal(checkpoints.length, 1)
  const repeated = await importEchelonReferenceMedia({
    ...transfer,
    machineLoad: () => 1,
    previous: imported,
  })
  assert.deepEqual(repeated, imported)
  assert.equal(await count(), before + 1)
  await assert.rejects(
    importEchelonReferenceMedia({
      userId: actor,
      siteId: site,
      images: [{ ...image, sourceSha256: '0'.repeat(64) }],
      readSource: async () => bytes,
      previous: imported,
    }),
    /local reference file changed/,
  )
  await assert.rejects(
    importEchelonReferenceMedia({ userId: actor, siteId: foreign, images: [image], readSource: async () => bytes }),
    /native Echelon chapters site/,
  )
  const row = (
    await asUser({ userId: actor }, client =>
      client.query('SELECT original_name,alt_text,focal,tags,status FROM media WHERE id=$1', [imported[0]!.mediaId]),
    )
  ).rows[0]!
  assert.equal(row.original_name, '[Reference photo].png')
  assert.equal(row.alt_text, image.altText)
  assert.deepEqual(row.focal, image.focal)
  assert(row.tags.includes('needs replacement'))
  assert.equal(row.status, 'ready')
  assert.equal(await count(), before + 1)
  const delivery = createPostgresAdminMediaDeliveryRepository(),
    objects = []
  for (const variant of ['original', 'thumbnail', 'card', 'wide'] as const) {
    const asset = await delivery.resolve(actor, imported[0]!.mediaId, variant)
    assert(asset)
    objects.push({ object_key: asset.objectKey })
  }
  assert.equal(objects.length, 4)
  console.log(
    JSON.stringify({
      mediaId: imported[0]!.mediaId,
      verifiedRepeat: true,
      changedSourceRefused: true,
      foreignSiteRefused: true,
      readyVariants: 3,
      sourceChecks: (
        await asUser({ userId: actor }, client => client.query('SELECT count(*)::int n FROM story_source_checks'))
      ).rows[0]!.n,
      objects: objects.map(row => row.object_key),
    }),
  )
} finally {
  await closePools()
}
