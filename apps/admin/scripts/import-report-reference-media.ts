/** Explicit local operation using an approved manifest and normal Media commands. No URL reads. */
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { closePools, poolFor } from '@cms/platform'
import { importReferenceMedia, type ReferenceImage, type ImportedReferenceImage } from '../src/lib/reference-media.ts'
async function main() {
  if (process.env['MEDIA_PROVIDER'] !== 'filesystem' || !process.env['MEDIA_ROOT']?.startsWith('/'))
    throw new Error('Use an explicit local Media folder.')
  if (process.env['CMS_LOCAL_TEST_MODE'] !== 'true') throw new Error('This reference import is local only.')
  for (const key of ['DATABASE_URL', 'DATABASE_URL_AUTHENTICATED', 'DATABASE_URL_WORKER']) {
    const url = new URL(process.env[key] ?? '')
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !['/cms_demo', '/cms_e2e'].includes(url.pathname))
      throw new Error('Use only the local demo or isolated check database.')
  }
  const [source, inputManifest, dump, manifest, year] = process.argv.slice(2)
  if (!source || !inputManifest || !dump || !manifest || !year || !/^20[0-9]{2}$/.test(year))
    throw new Error('Give assets folder,source manifest,existing dump,import record and report year.')
  if ((await stat(dump)).size === 0) throw new Error('Keep a database dump before importing.')
  const actor = (
    await poolFor('migration').query(
      "SELECT u.id FROM app_users u JOIN global_roles r ON r.user_id=u.id WHERE u.email=$1 AND r.role='super_admin'",
      [process.env['CMS_REFERENCE_ACTOR_EMAIL'] ?? 'admin@example.test'],
    )
  ).rows[0]?.id
  const site = (
    await poolFor('migration').query('SELECT id FROM sites WHERE slug=$1', [
      process.env['CMS_REFERENCE_SITE_SLUG'] ?? 'sawso',
    ])
  ).rows[0]?.id
  if (!actor || !site) throw new Error('The local administrator or site was not found.')
  const images = JSON.parse(await readFile(inputManifest, 'utf8')) as ReferenceImage[]
  if (!Array.isArray(images) || !images.length || images.length > 100)
    throw new Error('Check the report photo manifest.')
  let previous: ImportedReferenceImage[] = []
  try {
    previous = JSON.parse(await readFile(manifest, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const rows = await importReferenceMedia({
    userId: actor,
    siteId: site,
    profile: {
      folder: 'Annual Report ' + year,
      tags: ['annual report', year],
      attribution: 'Owner-supplied annual report image — review rights before hosting.',
      replacementAttribution: 'Replace this report photo before publication.',
    },
    images,
    readSource: file => readFile(resolve(source, file)),
    previous,
    onItem: async rows => {
      await mkdir(dirname(resolve(manifest)), { recursive: true })
      const merged = new Map([...previous, ...rows].map(row => [row.key, row]))
      const saved = images.flatMap(image => (merged.has(image.key) ? [merged.get(image.key)!] : []))
      await writeFile(manifest + '.tmp', JSON.stringify(saved, null, 2) + '\n')
      await rename(manifest + '.tmp', manifest)
      process.stdout.write('Ready ' + rows.length + '/' + images.length + '\n')
    },
  })
  process.stdout.write('Verified ' + rows.length + ' report Media records.\n')
}
try {
  await main()
} finally {
  await closePools()
}
