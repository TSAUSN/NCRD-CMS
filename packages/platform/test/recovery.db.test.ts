import { execFile } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Client } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { ScratchDatabase } from './database.ts'
import { createFilesystemMediaStore } from '../src/local/index.ts'
import { registerReviewedSiteFile } from '../src/site-files.ts'
import {
  createRecoveryBackup,
  recoveryInventory,
  restoreRecoveryBackup,
  verifyRecoveryBackup,
  verifyRestoredDatabase,
} from '../src/recovery-operations.ts'

let source: ScratchDatabase, temporary: string, targetUrl: string, targetName: string
const key = randomBytes(32)
beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'cms-recovery-db-'))
  source = await ScratchDatabase.create('recovery')
  await promisify(execFile)(process.execPath, ['--experimental-strip-types', '../seeds/src/seed-database.ts'], {
    env: { ...process.env, DATABASE_URL: source.url },
    maxBuffer: 1_000_000,
  })
  targetName = `cms_restore_${randomUUID().replaceAll('-', '')}`
  const url = new URL(process.env['TEST_DATABASE_URL']!)
  url.pathname = '/' + targetName
  targetUrl = url.toString()
  const admin = new Client({ connectionString: process.env['TEST_DATABASE_URL']! })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE ${targetName}`)
  } finally {
    await admin.end()
  }
}, 60_000)
afterAll(async () => {
  await source?.close()
  if (targetName) {
    const admin = new Client({ connectionString: process.env['TEST_DATABASE_URL']! })
    await admin.connect()
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${targetName} WITH (FORCE)`)
    } finally {
      await admin.end()
    }
  }
  if (temporary) await rm(temporary, { recursive: true, force: true })
})

it('backs up one database snapshot and media, refuses tampering before restore, and renders recovered pages as the public role', async () => {
  const media = createFilesystemMediaStore(join(temporary, 'source-media'))
  const body = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
    'base64',
  )
  await media.put('recovery/test-image.png', body, 'image/png')
  const pool = source.pool()
  await pool.query(
    "INSERT INTO media(object_key,content_hash,mime_type,status,decorative,bytes,width,height) VALUES('recovery/test-image.png',$1,'image/png','ready',true,$2,1,1)",
    [createHash('sha256').update(body).digest('hex'), body.length],
  )
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n')
  const asset = randomUUID(),
    assetHash = createHash('sha256').update(pdf).digest('hex')
  const site = (await pool.query('SELECT id FROM sites LIMIT 1')).rows[0].id
  const actor = (await pool.query('SELECT id FROM app_users LIMIT 1')).rows[0].id
  const assetKey = `site-assets/${site}/${asset}/${assetHash}`
  await media.put(assetKey, pdf, 'application/pdf')
  await pool.query(
    `INSERT INTO site_assets(id,site_id,kind,object_key,mime_type,bytes,content_hash,original_name,provenance,created_by)
    VALUES($1,$2,'document',$3,'application/pdf',$4,$5,'report.pdf',$6,$7)`,
    [
      asset,
      site,
      assetKey,
      pdf.length,
      assetHash,
      JSON.stringify({ path: 'frozen/report.pdf', sha256: assetHash, manifest_sha256: 'a'.repeat(64) }),
      actor,
    ],
  )
  // Both the current choice and a historical reviewed script must recover.
  const files: Awaited<ReturnType<typeof registerReviewedSiteFile>>[] = [],
    client = await pool.connect()
  try {
    await client.query('BEGIN')
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    for (let version = 1; version <= 2; version++) {
      const file = await registerReviewedSiteFile({
        client,
        store: media,
        siteId: site,
        kind: 'script',
        name: 'recovery.js',
        source: 'local:recovery/version-' + version + '.js',
        bytes: Buffer.from('window.recoveryVersion=' + version + ';'),
      })
      files.push(file)
      await client.query('SELECT app.save_site_file_bundle($1,$2,$3)', [
        site,
        version - 1,
        JSON.stringify({
          version: 1,
          files: [file.id],
          scripts: [{ fileId: file.id, position: 'body-end', loading: 'normal', pages: [] }],
          styles: [],
        }),
      ])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  const backup = join(temporary, 'backup')
  const manifest = await createRecoveryBackup({
    connection: source.url,
    media,
    directory: backup,
    key,
    appVersion: 'recovery-test',
  })
  expect(manifest.objects).toHaveLength(4)
  expect((await verifyRecoveryBackup(backup, key)).migrations).toEqual(manifest.migrations)
  expect(await recoveryInventory(temporary)).toMatchObject([{ directory: 'backup', status: 'complete' }])
  await expect(verifyRecoveryBackup(backup, randomBytes(32))).rejects.toThrow(/authentication/)
  const file = join(backup, 'archive', 'database.enc'),
    original = await readFile(file),
    changed = Buffer.from(original)
  changed[30] = changed[30]! ^ 1
  await writeFile(file, changed)
  const restore = {
    directory: backup,
    key,
    connection: targetUrl,
    mediaDirectory: join(temporary, 'restored-media'),
    isolated: true,
  }
  await expect(restoreRecoveryBackup(restore)).rejects.toThrow(/authentication/)
  const target = new Client({ connectionString: targetUrl })
  await target.connect()
  expect((await target.query("SELECT to_regclass('public.sites') AS sites")).rows[0]!.sites).toBeNull()
  await target.end()
  await writeFile(file, original)
  await expect(restoreRecoveryBackup({ ...restore, connection: source.url })).rejects.toThrow(/source/)
  const result = await restoreRecoveryBackup(restore)
  expect(result.status).toBe('restored-awaiting-verification')
  const evidence = await verifyRestoredDatabase(targetUrl, createFilesystemMediaStore(restore.mediaDirectory))
  expect(evidence.publishedPages).toBeGreaterThan(0)
  expect(evidence.objects).toBe(4)
  const recovered = new Client({ connectionString: targetUrl })
  await recovered.connect()
  try {
    expect(
      (await recovered.query('SELECT version FROM site_file_versions WHERE site_id=$1 ORDER BY version', [site])).rows,
    ).toEqual([{ version: '1' }, { version: '2' }])
  } finally {
    await recovered.end()
  }
  for (const [index, file] of files.entries())
    expect(
      await createFilesystemMediaStore(restore.mediaDirectory).get(`site-files/${site}/${file.id}/${file.sha256}`),
    ).toEqual(new Uint8Array(Buffer.from('window.recoveryVersion=' + (index + 1) + ';')))
  expect(await createFilesystemMediaStore(restore.mediaDirectory).get(assetKey)).toEqual(new Uint8Array(pdf))
  await expect(restoreRecoveryBackup({ ...restore, mediaDirectory: join(temporary, 'other-media') })).rejects.toThrow(
    /empty/,
  )
}, 60_000)
