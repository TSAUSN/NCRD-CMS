// Reads the JSON format emitted by V1's backup-firestore.mjs. No Firebase SDK,
// source-module evaluation, automatic newest-backup selection, or network I/O.
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }
export const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Canonical JSON: Firestore field ordering never changes an identity. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  const result = JSON.stringify(value)
  if (result === undefined) throw new Error('only JSON values can be hashed')
  return result
}
export const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

export type InputFile = { path: string; sha256: string; bytes: number }
type BackupRecord = { path: string; sha256: string; payload: JsonObject | null }
export type V1Backup = {
  format: 'v1-backup-firestore-json'
  takenAt: string
  files: InputFile[]
  documents: number
  placeholders: number
  records: BackupRecord[]
}

/** Resolve symlinks as well as .. before allowing any source file read. */
export function containedFile(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..' || part === '')) {
    throw new Error('source file path must stay inside its named root')
  }
  const base = realpathSync(root)
  const resolved = realpathSync(path.join(base, relative))
  if (!resolved.startsWith(`${base}${path.sep}`) || !statSync(resolved).isFile()) {
    throw new Error('source file must be a regular file inside its named root')
  }
  return resolved
}

export function readV1Backup(root: string): V1Backup {
  const files: InputFile[] = []
  const read = (relative: string): unknown => {
    const file = containedFile(root, relative)
    if (statSync(file).size > 64 * 1024 * 1024) throw new Error('backup input exceeds 64 MiB per file')
    const bytes = readFileSync(file)
    files.push({ path: `backup/${relative}`, sha256: digest(bytes), bytes: bytes.length })
    return JSON.parse(bytes.toString('utf8')) as unknown
  }
  const manifest = read('manifest.json')
  if (
    !isObject(manifest) ||
    typeof manifest.takenAt !== 'string' ||
    !Number.isFinite(Date.parse(manifest.takenAt)) ||
    !isObject(manifest.totals) ||
    !Array.isArray(manifest.collections)
  ) {
    throw new Error('expected the manifest emitted by V1 backup-firestore.mjs')
  }
  const seenCollections = new Set<string>()
  const seenFiles = new Set<string>()
  const seenPaths = new Set<string>()
  const records: BackupRecord[] = []
  let documents = 0
  let placeholders = 0
  for (const entry of manifest.collections) {
    if (
      !isObject(entry) ||
      typeof entry.collection !== 'string' ||
      !/^[A-Za-z][\w-]*$/.test(entry.collection) ||
      typeof entry.file !== 'string' ||
      !/^[A-Za-z][\w.-]*\.json$/.test(entry.file) ||
      !Number.isSafeInteger(entry.documents) ||
      Number(entry.documents) < 0 ||
      seenCollections.has(entry.collection) ||
      seenFiles.has(entry.file)
    ) {
      throw new Error('backup manifest has an invalid or duplicate collection')
    }
    seenCollections.add(entry.collection)
    seenFiles.add(entry.file)
    const collection = read(entry.file)
    if (!isObject(collection)) throw new Error('backup collection must map document paths to JSON objects or null')
    let count = 0
    for (const [documentPath, payload] of Object.entries(collection)) {
      const segments = documentPath.split('/')
      if (
        segments.length % 2 !== 0 ||
        segments.some(s => !s || s === '.' || s === '..') ||
        segments[0] !== entry.collection ||
        seenPaths.has(documentPath) ||
        (payload !== null && !isObject(payload))
      )
        throw new Error('invalid or duplicate backup document path/payload')
      seenPaths.add(documentPath)
      records.push({ path: documentPath, sha256: digest(canonical(payload)), payload })
      if (payload === null) placeholders += 1
      else {
        documents += 1
        count += 1
      }
    }
    if (count !== entry.documents) throw new Error(`backup document count does not reconcile for ${entry.collection}`)
  }
  if (documents !== manifest.totals.documents || placeholders !== manifest.totals.placeholders) {
    throw new Error('backup total document/placeholder counts do not reconcile')
  }
  const collectionPaths = new Set(
    records.flatMap(record => {
      const parts = record.path.split('/')
      return parts.filter((_, i) => i % 2 === 0).map((_, i) => parts.slice(0, i * 2 + 1).join('/'))
    }),
  )
  // Empty root collections still belong to the manifest, as V1 counts them.
  for (const name of seenCollections) collectionPaths.add(name)
  if (collectionPaths.size !== manifest.totals.collections)
    throw new Error('backup collection count does not reconcile')
  records.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  return { format: 'v1-backup-firestore-json', takenAt: manifest.takenAt, files, documents, placeholders, records }
}
