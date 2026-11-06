import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { uploadRecoveryArchive } from './google-backup.ts'
import { createFilesystemMediaStore } from './local/index.ts'

it('publishes completion last and leaves no completion marker after corrupt or incomplete uploads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cms-backup-upload-'))
  try {
    await mkdir(join(directory, 'archive'))
    await writeFile(join(directory, 'archive', 'database.enc'), 'encrypted database')
    await writeFile(join(directory, 'archive', 'manifest.enc'), 'encrypted manifest')
    await writeFile(join(directory, 'status.json'), '{"status":"complete"}')
    const store = createFilesystemMediaStore(join(directory, 'destination'))
    const put = vi.spyOn(store, 'put')
    await uploadRecoveryArchive(directory, store, 'backups/verified')
    expect(put.mock.calls.at(-1)![0]).toBe('backups/verified/status.json')
    const corrupted = {
      ...createFilesystemMediaStore(join(directory, 'corrupted')),
      get: async () => new Uint8Array([0]),
    }
    const badPut = vi.spyOn(corrupted, 'put')
    await expect(uploadRecoveryArchive(directory, corrupted, 'backups/corrupted')).rejects.toThrow('checksum')
    expect(badPut.mock.calls.some(([key]) => key.endsWith('/status.json'))).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
