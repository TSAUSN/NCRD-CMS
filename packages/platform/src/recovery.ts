/** Offline recovery primitives. Runtime web processes never import this module.
 * Backups are authenticated/encrypted; restoration authenticates the complete
 * file before any plaintext is handed to PostgreSQL or an object store. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Transform, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isSafeObjectKey } from './local/index.ts'

const MAGIC = Buffer.from('CMSBK1')
const HEADER_BYTES = MAGIC.length + 12
export type RecoveryFile = { file: string; sha256: string; bytes: number }
export type RecoveryObject = RecoveryFile & { objectKey: string; contentType: string }
export type RecoveryManifest = {
  format: 'cms-recovery'
  version: 1
  createdAt: string
  appVersion: string
  sourceIdentity: string
  migrations: { name: string; checksum: string }[]
  database: RecoveryFile
  objects: RecoveryObject[]
  postgres?: { serverMajor: number; dumpMajor: number }
}
export function recoveryKey(encoded: string | undefined): Buffer {
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded))
    throw new Error('CMS_BACKUP_KEY must contain a base64-encoded 32-byte key from the secret store.')
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('CMS_BACKUP_KEY is invalid.')
  return key
}
// A Cloud Run service reaches Cloud SQL through the socket named in `host`.
const CLOUD_SQL_SOCKET = /^\/cloudsql\/[a-z][a-z0-9-]{4,28}[a-z0-9]:[a-z]+-[a-z]+\d+:[a-z][a-z0-9-]{0,96}$/
function socketHost(url: URL): string | null {
  if (url.searchParams.getAll('host').length > 1) throw new Error('Only one Cloud SQL socket host may be supplied.')
  const host = url.searchParams.get('host')
  if (host === null) return null
  if (!CLOUD_SQL_SOCKET.test(host)) throw new Error('Only a Cloud SQL socket path may replace the PostgreSQL host.')
  return host
}
export function databaseIdentity(connection: string): string {
  const url = new URL(connection)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1))
    throw new Error('A PostgreSQL database URL is required.')
  const database = decodeURIComponent(url.pathname.slice(1))
  const socket = socketHost(url)
  return socket ? `${socket}/${database}` : `${url.hostname.toLowerCase()}:${url.port || '5432'}/${database}`
}
export function postgresEnvironment(connection: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  databaseIdentity(connection)
  const url = new URL(connection)
  const allowed = new Set([
    'host',
    'sslmode',
    'sslrootcert',
    'sslcert',
    'sslkey',
    'connect_timeout',
    'application_name',
  ])
  for (const key of url.searchParams.keys())
    if (!allowed.has(key)) throw new Error(`Unsupported PostgreSQL recovery option: ${key}`)
  const env: NodeJS.ProcessEnv = {
    ...base,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: '15',
    PGAPPNAME: 'cms-recovery',
  }
  const mapping: Record<string, string> = {
    host: 'PGHOST',
    sslmode: 'PGSSLMODE',
    sslrootcert: 'PGSSLROOTCERT',
    sslcert: 'PGSSLCERT',
    sslkey: 'PGSSLKEY',
    connect_timeout: 'PGCONNECT_TIMEOUT',
    application_name: 'PGAPPNAME',
  }
  for (const [key, value] of url.searchParams) env[mapping[key]!] = value
  return env
}
export function assertIsolatedRestore(sourceIdentity: string, target: string, confirmed: boolean): void {
  if (!confirmed)
    throw new Error(
      'Set CMS_RESTORE_ISOLATED=true only for a separate, empty recovery database with no web or worker attached.',
    )
  const identity = databaseIdentity(target)
  if (identity === sourceIdentity) throw new Error('Restoration into the source database is forbidden.')
  const name = decodeURIComponent(new URL(target).pathname.slice(1))
  if (!/^cms_restore_[a-z0-9_]{1,48}$/.test(name))
    throw new Error('A restore target must use a separate cms_restore_… database name.')
}
export function validateRecoveryManifest(value: unknown): RecoveryManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid recovery manifest.')
  const item = value as RecoveryManifest
  if (
    item.format !== 'cms-recovery' ||
    item.version !== 1 ||
    !Number.isFinite(Date.parse(item.createdAt)) ||
    typeof item.appVersion !== 'string' ||
    typeof item.sourceIdentity !== 'string' ||
    !Array.isArray(item.migrations) ||
    !item.migrations.length ||
    !Array.isArray(item.objects) ||
    item.objects.length > 100_000
  )
    throw new Error('Unsupported or incomplete recovery manifest.')
  const files = new Set<string>(),
    keys = new Set<string>()
  for (const file of [item.database, ...item.objects]) {
    if (
      !file ||
      !/^(database|object-[0-9]{8})\.enc$/.test(file.file) ||
      files.has(file.file) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0
    )
      throw new Error('Invalid or duplicate backup file descriptor.')
    files.add(file.file)
  }
  if (item.database.file !== 'database.enc') throw new Error('Database archive is missing.')
  for (const object of item.objects) {
    if (
      !isSafeObjectKey(object.objectKey) ||
      keys.has(object.objectKey) ||
      object.bytes > 100_000_000 ||
      typeof object.contentType !== 'string' ||
      object.contentType.length > 120 ||
      /[\r\n]/.test(object.contentType)
    )
      throw new Error('Invalid or duplicate media object descriptor.')
    keys.add(object.objectKey)
  }
  for (const migration of item.migrations)
    if (!/^[0-9]{4}_[a-z0-9_]+\.sql$/.test(migration.name) || !/^[a-f0-9]{16}$/.test(migration.checksum))
      throw new Error('Invalid migration inventory.')
  if (
    item.postgres !== undefined &&
    (!item.postgres ||
      !Number.isSafeInteger(item.postgres.serverMajor) ||
      !Number.isSafeInteger(item.postgres.dumpMajor) ||
      item.postgres.serverMajor < 10 ||
      item.postgres.dumpMajor < item.postgres.serverMajor ||
      item.postgres.dumpMajor > 99)
  )
    throw new Error('Invalid PostgreSQL version inventory.')
  return item
}

export async function encryptRecoveryStream(input: Readable, destination: string, key: Buffer): Promise<RecoveryFile> {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, nonce),
    hash = createHash('sha256')
  const header = Buffer.concat([MAGIC, nonce])
  cipher.setAAD(header)
  let bytes = 0
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  const handle = await open(destination, 'wx', 0o600)
  const output = handle.createWriteStream()
  output.write(header)
  try {
    await pipeline(input, tap, cipher, output)
    await appendFile(destination, cipher.getAuthTag())
    return { file: destination.split('/').at(-1)!, sha256: hash.digest('hex'), bytes }
  } catch (error) {
    await rm(destination, { force: true })
    throw error
  }
}

/** A private temporary file is removed on authentication/hash failure. Callers
 * may consume it only after this promise resolves successfully. */
export async function decryptRecoveryFile(
  source: string,
  destination: string,
  key: Buffer,
  expected?: Pick<RecoveryFile, 'sha256' | 'bytes'>,
): Promise<void> {
  const size = (await stat(source)).size
  if (size < HEADER_BYTES + 16) throw new Error('Backup file is truncated.')
  const handle = await open(source, 'r')
  const header = Buffer.alloc(HEADER_BYTES),
    tag = Buffer.alloc(16)
  try {
    await handle.read(header, 0, header.length, 0)
    await handle.read(tag, 0, 16, size - 16)
  } finally {
    await handle.close()
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Unsupported backup encryption format.')
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length))
  decipher.setAAD(header)
  decipher.setAuthTag(tag)
  const hash = createHash('sha256')
  let bytes = 0
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  const output = await open(destination, 'wx', 0o600)
  try {
    const input =
      size === HEADER_BYTES + 16 ? Readable.from([]) : createReadStream(source, { start: HEADER_BYTES, end: size - 17 })
    await pipeline(input, decipher, tap, output.createWriteStream())
    const sum = hash.digest('hex')
    if (expected && (bytes !== expected.bytes || sum !== expected.sha256))
      throw new Error('Backup plaintext does not match its manifest.')
  } catch {
    await rm(destination, { force: true })
    throw new Error('Backup authentication or integrity verification failed.')
  }
}

export async function readRecoveryManifest(
  directory: string,
  key: Buffer,
  temporary: string,
): Promise<RecoveryManifest> {
  if ((await stat(resolve(directory, 'manifest.enc'))).size > 50_000_000)
    throw new Error('Recovery manifest is too large.')
  const file = resolve(temporary, 'manifest.json')
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  try {
    await decryptRecoveryFile(resolve(directory, 'manifest.enc'), file, key)
    return validateRecoveryManifest(JSON.parse(await readFile(file, 'utf8')))
  } finally {
    await rm(file, { force: true })
  }
}
