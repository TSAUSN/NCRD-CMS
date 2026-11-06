import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaStore } from './ports.ts'

/** Upload authenticated ciphertext first. The completion marker is published
 * only after every remote object has passed a read-back checksum check. */
export async function uploadRecoveryArchive(directory: string, destination: MediaStore, prefix: string): Promise<void> {
  if (!/^backups\/[a-zA-Z0-9_-]{1,100}$/.test(prefix)) throw new Error('Invalid backup destination prefix')
  const files = await readdir(join(directory, 'archive'))
  if (
    !files.includes('database.enc') ||
    !files.includes('manifest.enc') ||
    files.some(file => !/^(database|manifest|object-[0-9]{8})\.enc$/.test(file))
  )
    throw new Error('Incomplete recovery archive')
  for (const file of files.sort()) {
    const key = `${prefix}/archive/${file}`
    const bytes = await readFile(join(directory, 'archive', file))
    await destination.put(key, bytes, 'application/octet-stream')
    const stored = await destination.get(key)
    if (
      !stored ||
      createHash('sha256').update(stored).digest('hex') !== createHash('sha256').update(bytes).digest('hex')
    ) {
      throw new Error('Remote backup checksum verification failed')
    }
  }
  const status = await readFile(join(directory, 'status.json'))
  await destination.put(`${prefix}/status.json`, status, 'application/json')
}
