import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configuredMediaStore } from './storage.ts'
import { createGoogleCloudMediaStore } from './google-storage.ts'
import { createRecoveryBackup, verifyRecoveryBackup } from './recovery-operations.ts'
import { recoveryKey } from './recovery.ts'
import { uploadRecoveryArchive } from './google-backup.ts'

const temporary = await mkdtemp(join(tmpdir(), 'cms-cloud-backup-'))
try {
  const connection = process.env['DATABASE_URL']
  const version = process.env['APP_VERSION']
  if (!connection || !version)
    throw new Error('Backup requires the operator database connection and application version')
  const key = recoveryKey(process.env['CMS_BACKUP_KEY'])
  const directory = join(temporary, 'snapshot')
  const manifest = await createRecoveryBackup({
    connection,
    media: configuredMediaStore(),
    directory,
    key,
    appVersion: version,
  })
  await verifyRecoveryBackup(directory, key)
  const prefix = `backups/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  await uploadRecoveryArchive(
    directory,
    createGoogleCloudMediaStore({ bucket: process.env['BACKUP_BUCKET'] ?? '' }),
    prefix,
  )
  console.log(
    JSON.stringify({
      event: 'backup.complete',
      createdAt: manifest.createdAt,
      objects: manifest.objects.length,
      prefix,
    }),
  )
} catch (error) {
  console.error(JSON.stringify({ event: 'backup.failed', message: (error as Error).message }))
  process.exitCode = 1
} finally {
  await rm(temporary, { recursive: true, force: true })
}
