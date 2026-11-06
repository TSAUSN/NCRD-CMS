/** Explicit local operation; never part of startup and never fetches a URL. */
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { closePools, poolFor } from '@cms/platform'
import { ECHELON_REFERENCE_MEDIA } from '../../../packages/seeds/src/echelon-reference-media.ts'
import { importEchelonReferenceMedia, type EchelonImportedImage } from '../src/lib/echelon-reference-media.ts'
async function main() {
  if (process.env['MEDIA_PROVIDER'] !== 'filesystem' || !process.env['MEDIA_ROOT']?.startsWith('/'))
    throw new Error('Use an explicit local Media folder for this import.')
  if (process.env['CMS_LOCAL_TEST_MODE'] !== 'true') throw new Error('This reference import is local only.')
  for (const key of ['DATABASE_URL', 'DATABASE_URL_AUTHENTICATED', 'DATABASE_URL_WORKER']) {
    const url = new URL(process.env[key] ?? '')
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !['/cms_demo', '/cms_e2e'].includes(url.pathname))
      throw new Error('Use only the local demo or isolated check database.')
  }
  const source = process.argv[2],
    dump = process.argv[3],
    manifest = process.argv[4]
  if (!source || !dump || !manifest)
    throw new Error('Give the local assets folder,existing dump,and import record path.')
  if ((await stat(dump)).size === 0) throw new Error('Keep a database dump before importing.')
  const actor = (
      await poolFor('migration').query('SELECT id FROM app_users WHERE email=$1', [
        process.env['CMS_REFERENCE_ACTOR_EMAIL'] ?? 'admin@example.test',
      ])
    ).rows[0]?.id,
    site = (
      await poolFor('migration').query('SELECT id FROM sites WHERE slug=$1', [
        process.env['CMS_REFERENCE_SITE_SLUG'] ?? 'echelon-chapters',
      ])
    ).rows[0]?.id
  if (!actor || !site) throw new Error('The local account or Echelon site was not found.')
  let previous: EchelonImportedImage[] = []
  try {
    previous = JSON.parse(await readFile(manifest, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const rows = await importEchelonReferenceMedia({
    userId: actor,
    siteId: site,
    images: ECHELON_REFERENCE_MEDIA,
    readSource: file => readFile(resolve(source, file)),
    previous,
    onItem: async rows => {
      await mkdir(dirname(resolve(manifest)), { recursive: true })
      const merged = new Map([...previous, ...rows].map(row => [row.key, row])),
        saved = ECHELON_REFERENCE_MEDIA.flatMap(image => (merged.has(image.key) ? [merged.get(image.key)!] : []))
      await writeFile(manifest + '.tmp', JSON.stringify(saved, null, 2) + '\n')
      await rename(manifest + '.tmp', manifest)
      process.stdout.write('Ready ' + rows.length + '/' + ECHELON_REFERENCE_MEDIA.length + '\n')
    },
  })
  process.stdout.write('Verified ' + rows.length + ' Echelon Media records.\n')
}
try {
  await main()
} finally {
  await closePools()
}
