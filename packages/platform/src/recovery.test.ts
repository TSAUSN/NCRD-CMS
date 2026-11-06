import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, expect, it } from 'vitest'
import {
  assertIsolatedRestore,
  databaseIdentity,
  decryptRecoveryFile,
  encryptRecoveryStream,
  postgresEnvironment,
  recoveryKey,
  validateRecoveryManifest,
} from './recovery.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'cms-recovery-test-'))
  dirs.push(dir)
  return dir
}
it('encrypts and authenticates binary files before exposing them to a restore consumer', async () => {
  const dir = await directory(),
    key = randomBytes(32),
    body = randomBytes(4096)
  const encrypted = join(dir, 'database.enc'),
    plain = join(dir, 'database.dump')
  const descriptor = await encryptRecoveryStream(Readable.from(body), encrypted, key)
  expect((await readFile(encrypted)).includes(body)).toBe(false)
  await decryptRecoveryFile(encrypted, plain, key, descriptor)
  expect(await readFile(plain)).toEqual(body)
})
it('refuses a wrong key, tampering, truncation and mismatched manifest hashes', async () => {
  const dir = await directory(),
    key = randomBytes(32),
    file = join(dir, 'database.enc'),
    output = join(dir, 'plain')
  const descriptor = await encryptRecoveryStream(Readable.from('private site content'), file, key)
  await expect(decryptRecoveryFile(file, output, randomBytes(32), descriptor)).rejects.toThrow(/authentication/)
  await expect(access(output)).rejects.toThrow()
  await expect(decryptRecoveryFile(file, output, key, { ...descriptor, sha256: '0'.repeat(64) })).rejects.toThrow(
    /integrity/,
  )
  const bytes = await readFile(file)
  bytes[20] = bytes[20]! ^ 1
  await writeFile(file, bytes)
  await expect(decryptRecoveryFile(file, output, key, descriptor)).rejects.toThrow(/authentication/)
  await writeFile(file, Buffer.from('short'))
  await expect(decryptRecoveryFile(file, output, key)).rejects.toThrow(/truncated/)
})
it('does not put database credentials in identity reports or child-process arguments', () => {
  const connection = 'postgres://operator:private%20value@DB.example:5432/cms?sslmode=verify-full'
  expect(databaseIdentity(connection)).toBe('db.example:5432/cms')
  expect(postgresEnvironment(connection, {})).toMatchObject({
    PGHOST: 'DB.example',
    PGPASSWORD: 'private value',
    PGSSLMODE: 'verify-full',
  })
  expect(() => postgresEnvironment(`${connection}&options=unsafe`, {})).toThrow(/Unsupported/)
})
it('backs up through a Cloud SQL socket and rejects any other host override', () => {
  const connection = 'postgresql://operator:private%20value@localhost/cms?host=/cloudsql/cms-example:us-east1:cms-db'
  expect(databaseIdentity(connection)).toBe('/cloudsql/cms-example:us-east1:cms-db/cms')
  expect(postgresEnvironment(connection, {})).toMatchObject({
    PGHOST: '/cloudsql/cms-example:us-east1:cms-db',
    PGDATABASE: 'cms',
    PGPASSWORD: 'private value',
  })
  expect(() => databaseIdentity('postgresql://operator:x@localhost/cms?host=/tmp')).toThrow(/Cloud SQL socket/)
  expect(() => postgresEnvironment(`${connection}&host=/tmp`, {})).toThrow(/Cloud SQL socket/)
  expect(databaseIdentity(connection.replace('us-east1', 'europe-west12'))).toContain('europe-west12')
})
it('round trips an empty file and never removes a pre-existing destination', async () => {
  const dir = await directory(),
    key = randomBytes(32),
    file = join(dir, 'empty.enc'),
    plain = join(dir, 'plain')
  const descriptor = await encryptRecoveryStream(Readable.from([]), file, key)
  await decryptRecoveryFile(file, plain, key, descriptor)
  expect(await readFile(plain, 'utf8')).toBe('')
  await writeFile(plain, 'keep me')
  await expect(decryptRecoveryFile(file, plain, key, descriptor)).rejects.toThrow()
  expect(await readFile(plain, 'utf8')).toBe('keep me')
  const before = await readFile(file)
  await expect(encryptRecoveryStream(Readable.from('overwrite'), file, key)).rejects.toThrow()
  expect(await readFile(file)).toEqual(before)
})
it('requires explicit isolation and a distinct, recovery-named target', () => {
  expect(() => assertIsolatedRestore('db:5432/cms', 'postgres://u:p@db/cms', true)).toThrow(/source/)
  expect(() => assertIsolatedRestore('db:5432/cms', 'postgres://u:p@db/production', true)).toThrow(/cms_restore/)
  expect(() => assertIsolatedRestore('db:5432/cms', 'postgres://u:p@db/cms_restore_drill', false)).toThrow(/ISOLATED/)
  expect(() => assertIsolatedRestore('db:5432/cms', 'postgres://u:p@db/cms_restore_drill', true)).not.toThrow()
  expect(() => recoveryKey('not-a-key')).toThrow()
  expect(recoveryKey(randomBytes(32).toString('base64'))).toHaveLength(32)
})
it('rejects unsupported manifests and path traversal before any object writes', () => {
  expect(() => validateRecoveryManifest({ format: 'cms-recovery', version: 2 })).toThrow()
  const base = {
    format: 'cms-recovery',
    version: 1,
    createdAt: new Date().toISOString(),
    appVersion: 'test',
    sourceIdentity: 'host:5432/source',
    migrations: [{ name: '0000_roles.sql', checksum: '0'.repeat(16) }],
    database: { file: 'database.enc', sha256: '0'.repeat(64), bytes: 5 },
    objects: [],
  }
  expect(validateRecoveryManifest(base)).toEqual(base)
  expect(() => validateRecoveryManifest({ ...base, database: { ...base.database, file: '../database.enc' } })).toThrow(
    /descriptor/,
  )
  expect(() =>
    validateRecoveryManifest({
      ...base,
      objects: [{ ...base.database, file: 'object-00000000.enc', objectKey: '../secret', contentType: 'image/png' }],
    }),
  ).toThrow(/descriptor/)
})
