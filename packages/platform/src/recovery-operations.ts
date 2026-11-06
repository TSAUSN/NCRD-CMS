import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { Client } from 'pg'
import { MIGRATIONS_DIR, listMigrations } from '@cms/schema/migrate'
import { renderPage, type RenderManifest, type SiteShell } from '@cms/renderer'
import type { MediaStore } from './ports.ts'
import { createFilesystemMediaStore, isSafeObjectKey } from './local/index.ts'
import {
  assertIsolatedRestore,
  databaseIdentity,
  decryptRecoveryFile,
  encryptRecoveryStream,
  postgresEnvironment,
  readRecoveryManifest,
  type RecoveryManifest,
} from './recovery.ts'
import { assertBackupVersion, assertRestoreVersion, installedPostgresMajor, postgresMajor } from './postgres-version.ts'

type InventoryObject = { object_key: string; mime_type: string }
const inventorySql = `SELECT object_key,mime_type FROM public.media WHERE status IN ('ready','deleted') AND purged_at IS NULL
  UNION SELECT v.object_key,v.mime_type FROM public.media_variants v JOIN public.media m ON m.id=v.media_id WHERE m.status IN ('ready','deleted') AND m.purged_at IS NULL
  UNION SELECT object_key,mime_type FROM public.site_assets
  UNION SELECT object_key,mime_type FROM public.site_files
  UNION SELECT thumbnail_path,'image/png' FROM public.section_def_versions WHERE thumbnail_path IS NOT NULL
  UNION SELECT upload_object_key,received_content_type FROM app.media_upload_intents WHERE status='uploaded' ORDER BY object_key`

function postgresTool(name: string): string {
  const bin = process.env['CMS_PG_BIN']
  if (bin && !bin.startsWith('/')) throw new Error('CMS_PG_BIN must be an absolute directory.')
  return bin ? join(bin, name) : name
}
function command(name: string, args: string[], connection: string) {
  const child = spawn(postgresTool(name), args, {
    env: postgresEnvironment(connection),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Never echo provider stderr, which can contain connection details or private rows.
  let diagnostic = ''
  child.stderr.on('data', chunk => {
    if (diagnostic.length < 65536) diagnostic += String(chunk).slice(0, 65536 - diagnostic.length)
  })
  const done = new Promise<void>((accept, reject) => {
    child.once('error', () =>
      reject(new Error(`${name} could not start. Check CMS_PG_BIN and PostgreSQL client installation.`)),
    )
    child.once('close', async code => {
      if (code === 0) {
        accept()
        return
      }
      const path = process.env['CMS_RECOVERY_DIAGNOSTICS']
      if (path?.startsWith('/')) await writeFile(path, diagnostic, { mode: 0o600 }).catch(() => {})
      reject(new Error(`${name} failed (exit ${code}); the recovery operation is incomplete.`))
    })
  })
  return { child, done }
}
export async function createRecoveryBackup(input: {
  connection: string
  media: MediaStore
  directory: string
  key: Buffer
  appVersion: string
}): Promise<RecoveryManifest> {
  const directory = resolve(input.directory),
    temporary = `${directory}.partial-${randomUUID()}`
  await mkdir(temporary, { recursive: false, mode: 0o700 })
  const client = new Client({ connectionString: input.connection })
  try {
    await client.connect()
    const serverMajor = postgresMajor(
      (await client.query<{ server_version: string }>('SHOW server_version')).rows[0]!.server_version,
    )
    const dumpMajor = await installedPostgresMajor('pg_dump')
    assertBackupVersion(serverMajor, dumpMajor)
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const snapshot = (await client.query<{ id: string }>('SELECT pg_export_snapshot() AS id')).rows[0]!.id
    const migrations = (
      await client.query<{ name: string; checksum: string }>(
        'SELECT name,checksum FROM public.cms_migrations ORDER BY name',
      )
    ).rows
    if (!migrations.length) throw new Error('The source is not a migrated CMS database.')
    const objects = (await client.query<InventoryObject>(inventorySql)).rows
    const dump = command(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--schema=public',
        '--schema=app',
        '--schema=public_api',
        `--snapshot=${snapshot}`,
      ],
      input.connection,
    )
    let database
    try {
      const results = await Promise.all([
        encryptRecoveryStream(dump.child.stdout, join(temporary, 'database.enc'), input.key),
        dump.done,
      ])
      database = results[0]
    } catch (error) {
      dump.child.kill()
      await dump.done.catch(() => {})
      throw error
    }
    const manifest: RecoveryManifest = {
      format: 'cms-recovery',
      version: 1,
      createdAt: new Date().toISOString(),
      appVersion: input.appVersion,
      sourceIdentity: databaseIdentity(input.connection),
      migrations,
      database,
      objects: [],
      postgres: { serverMajor, dumpMajor },
    }
    for (const object of objects) {
      if (!isSafeObjectKey(object.object_key)) throw new Error('The media inventory contains an unsafe object key.')
      const body = await input.media.get(object.object_key)
      if (!body) throw new Error('A referenced media object is missing. The backup was not completed.')
      if (body.byteLength > 100_000_000) throw new Error('A referenced media object exceeds the recovery size limit.')
      const file = `object-${String(manifest.objects.length).padStart(8, '0')}.enc`
      manifest.objects.push({
        ...(await encryptRecoveryStream(Readable.from([body]), join(temporary, file), input.key)),
        objectKey: object.object_key,
        contentType: object.mime_type,
      })
    }
    await encryptRecoveryStream(Readable.from(JSON.stringify(manifest)), join(temporary, 'manifest.enc'), input.key)
    await client.query('COMMIT')
    // Refuse overwriting an existing backup, including an empty directory.
    await mkdir(directory, { mode: 0o700 })
    await rename(temporary, join(directory, 'archive'))
    await writeFile(
      join(directory, 'status.json'),
      JSON.stringify({
        status: 'complete',
        createdAt: manifest.createdAt,
        appVersion: manifest.appVersion,
        objects: manifest.objects.length,
      }) + '\n',
      { mode: 0o600 },
    )
    return manifest
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end().catch(() => {})
    await rm(temporary, { recursive: true, force: true })
  }
}

async function authenticateArchive(directory: string, key: Buffer, temporary: string): Promise<RecoveryManifest> {
  const archive = join(resolve(directory), 'archive')
  const manifest = await readRecoveryManifest(archive, key, temporary)
  // Authenticate every file before any database or object-store mutation.
  for (const descriptor of [manifest.database, ...manifest.objects]) {
    await decryptRecoveryFile(
      join(archive, descriptor.file),
      join(temporary, descriptor.file + '.plain'),
      key,
      descriptor,
    )
  }
  return manifest
}
export async function verifyRecoveryBackup(directory: string, key: Buffer): Promise<RecoveryManifest> {
  const temporary = await mkdtemp(join(tmpdir(), 'cms-backup-verify-'))
  try {
    return await authenticateArchive(directory, key, temporary)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function restoreRecoveryBackup(input: {
  directory: string
  key: Buffer
  connection: string
  mediaDirectory: string
  isolated: boolean
}) {
  const temporary = await mkdtemp(join(tmpdir(), 'cms-backup-restore-'))
  const client = new Client({ connectionString: input.connection })
  let mediaCreated = false
  try {
    const manifest = await authenticateArchive(input.directory, input.key, temporary)
    assertIsolatedRestore(manifest.sourceIdentity, input.connection, input.isolated)
    const disk = new Map(
      await Promise.all(
        (await listMigrations()).map(
          async name =>
            [
              name,
              createHash('sha256')
                .update(await readFile(join(MIGRATIONS_DIR, name)))
                .digest('hex')
                .slice(0, 16),
            ] as const,
        ),
      ),
    )
    for (const migration of manifest.migrations)
      if (disk.get(migration.name) !== migration.checksum)
        throw new Error('Use the matching application revision: backup migration checksums differ from this checkout.')
    await client.connect()
    if (manifest.postgres) {
      const targetMajor = postgresMajor(
        (await client.query<{ server_version: string }>('SHOW server_version')).rows[0]!.server_version,
      )
      assertRestoreVersion(
        manifest.postgres.serverMajor,
        manifest.postgres.dumpMajor,
        targetMajor,
        await installedPostgresMajor('pg_restore'),
      )
    }
    const schemas = (
      await client.query<{ nspname: string }>(
        "SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('information_schema','public')",
      )
    ).rows
    const objects = (
      await client.query(
        "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' LIMIT 1",
      )
    ).rows
    const functions = (
      await client.query(
        "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LIMIT 1",
      )
    ).rows
    const connections = (
      await client.query('SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()')
    ).rows
    if (schemas.length || objects.length || functions.length || connections.length)
      throw new Error('Restore requires an empty, disconnected database; no existing application data may be replaced.')
    // Existing parent allowed; the media destination itself must be new.
    await mkdir(resolve(input.mediaDirectory), { mode: 0o700 })
    mediaCreated = true
    const roles = (await readFile(join(MIGRATIONS_DIR, '0000_roles.sql'), 'utf8')).split('-- `app` holds')[0]!
    await client.query(roles)
    await client.query(
      `GRANT CREATE ON DATABASE "${new URL(input.connection).pathname.slice(1)}" TO cms_migration_owner`,
    )
    await client.query('DROP SCHEMA public')
    await client.end()
    const restore = command(
      'pg_restore',
      [
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--role=cms_migration_owner',
        '--dbname=' + new URL(input.connection).pathname.slice(1),
        join(temporary, 'database.enc.plain'),
      ],
      input.connection,
    )
    restore.child.stdout.resume()
    await restore.done
    const media = createFilesystemMediaStore(resolve(input.mediaDirectory))
    for (const object of manifest.objects)
      await media.put(
        object.objectKey,
        new Uint8Array(await readFile(join(temporary, object.file + '.plain'))),
        object.contentType,
      )
    return {
      manifest,
      mediaDirectory: resolve(input.mediaDirectory),
      status: 'restored-awaiting-verification' as const,
    }
  } catch (error) {
    // The isolated database is deliberately retained for diagnosis; never drop a
    // database automatically. Incomplete restored media is equally diagnosable.
    if (mediaCreated)
      await writeFile(
        join(input.mediaDirectory, 'RECOVERY_INCOMPLETE.txt'),
        'Restore did not finish. Do not attach application processes. Recreate isolated destinations before retrying.\n',
        { mode: 0o600 },
      )
    throw error
  } finally {
    await client.end().catch(() => {})
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function verifyRestoredDatabase(connection: string, media: MediaStore) {
  assertIsolatedRestore('', connection, true)
  const client = new Client({ connectionString: connection })
  await client.connect()
  try {
    const pending = (
      await client.query<{
        statement: string
      }>(`SELECT format('ALTER TABLE %I.%I VALIDATE CONSTRAINT %I',n.nspname,t.relname,c.conname) AS statement
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname IN ('public','app') AND NOT c.convalidated`)
    ).rows
    for (const constraint of pending) await client.query(constraint.statement)
    const objects = (await client.query<InventoryObject>(inventorySql)).rows
    for (const object of objects)
      if (!(await media.get(object.object_key))) throw new Error('Restored media inventory is incomplete.')
    const inventory = (
      await client.query<{ hostname: string; path: string }>(
        `SELECT s.staging_hostname AS hostname,r.path FROM public.sites s JOIN public.published_routes r ON r.site_id=s.id WHERE s.status<>'archived' ORDER BY s.id,r.path`,
      )
    ).rows
    await client.query('BEGIN READ ONLY')
    await client.query('SET LOCAL ROLE cms_public_renderer')
    let rendered = 0
    for (const item of inventory) {
      const route = (
        await client.query<{ render_manifest: RenderManifest; shell_payload: SiteShell; is_staging: boolean }>(
          'SELECT * FROM public_api.resolve_route($1,$2)',
          [item.hostname, item.path],
        )
      ).rows[0]
      if (!route) throw new Error('A restored published route cannot be resolved as the public role.')
      const paths = (
        await client.query<{ page_id: string; path: string }>('SELECT * FROM public_api.site_routes($1)', [
          item.hostname,
        ])
      ).rows
      const result = renderPage({
        manifest: route.render_manifest,
        shell: route.shell_payload,
        isStaging: route.is_staging,
        navigationPaths: Object.fromEntries(paths.map(row => [row.page_id, row.path])),
      })
      if (!result.html.includes('<html') || !result.html.includes('<body'))
        throw new Error('A restored page did not render a complete document.')
      rendered++
    }
    await client.query('ROLLBACK')
    return { status: 'verified' as const, publishedPages: rendered, objects: objects.length }
  } finally {
    await client.end()
  }
}

/** Lists only completion markers; retention is an explicit operator decision. */
export async function recoveryInventory(root: string) {
  const output = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const status = JSON.parse(await readFile(join(root, entry.name, 'status.json'), 'utf8'))
      if (status.status === 'complete') output.push({ directory: entry.name, ...status })
    } catch {
      /* Partial/unrelated directories never count as backups. */
    }
  }
  return output.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
