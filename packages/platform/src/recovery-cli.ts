import { configuredMediaStore } from './storage.ts'
import { createFilesystemMediaStore } from './local/index.ts'
import { recoveryKey } from './recovery.ts'
import {
  createRecoveryBackup,
  recoveryInventory,
  restoreRecoveryBackup,
  verifyRecoveryBackup,
  verifyRestoredDatabase,
} from './recovery-operations.ts'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required.`)
  return value
}
try {
  const [operation, directory] = process.argv.slice(2)
  if (!directory || !['backup', 'verify', 'restore', 'inventory', 'verify-restored'].includes(operation ?? ''))
    throw new Error('Usage: recovery <backup|verify|restore|inventory|verify-restored> <directory>')
  if (operation === 'inventory') console.log(JSON.stringify(await recoveryInventory(directory)))
  else if (operation === 'verify-restored')
    console.log(
      JSON.stringify(
        await verifyRestoredDatabase(required('CMS_RESTORE_DATABASE_URL'), createFilesystemMediaStore(directory)),
      ),
    )
  else {
    const key = recoveryKey(process.env['CMS_BACKUP_KEY'])
    if (operation === 'backup') {
      const manifest = await createRecoveryBackup({
        connection: required('DATABASE_URL'),
        media: configuredMediaStore(),
        directory,
        key,
        appVersion: required('APP_VERSION'),
      })
      console.log(
        JSON.stringify({ status: 'complete', createdAt: manifest.createdAt, objects: manifest.objects.length }),
      )
    } else if (operation === 'verify') {
      const manifest = await verifyRecoveryBackup(directory, key)
      console.log(
        JSON.stringify({ status: 'authenticated', createdAt: manifest.createdAt, objects: manifest.objects.length }),
      )
    } else {
      const result = await restoreRecoveryBackup({
        directory,
        key,
        connection: required('CMS_RESTORE_DATABASE_URL'),
        mediaDirectory: required('CMS_RESTORE_MEDIA_ROOT'),
        isolated: process.env['CMS_RESTORE_ISOLATED'] === 'true',
      })
      console.log(JSON.stringify({ status: result.status, objects: result.manifest.objects.length }))
    }
  }
} catch (error) {
  console.error(
    JSON.stringify({ status: 'failed', message: error instanceof Error ? error.message : 'Recovery failed.' }),
  )
  process.exitCode = 1
}
