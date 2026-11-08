import { readdir, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { google, assertActiveScope, cloud } from './scope.mjs'

async function mediaFiles(root, prefix = '') {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error('Media inventory cannot contain symlinks.')
    const relative = prefix + entry.name
    if (entry.isDirectory()) result.push(...(await mediaFiles(root + '/' + entry.name, relative + '/')))
    else if (entry.isFile())
      result.push({ key: relative, path: root + '/' + entry.name, bytes: (await stat(root + '/' + entry.name)).size })
  }
  return result.sort((a, b) => a.key.localeCompare(b.key))
}

/** Create-only object delivery. Matching content is reused; a collision is a
 * hard error rather than an overwrite or a deletion. */
export async function uploadMedia(config) {
  const inventory = JSON.parse(await readFile(config.mediaInventory, 'utf8'))
  const files = await mediaFiles(config.mediaDirectory)
  if (files.length !== Object.keys(inventory).length) throw Error('Media file count differs from reviewed inventory.')
  for (const file of files) {
    const bytes = await readFile(file.path)
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (inventory[file.key]?.sha256 !== hash || inventory[file.key]?.bytes !== bytes.length)
      throw Error('Media bytes differ from reviewed inventory: ' + file.key)
  }
  const bucket = config.projectId + '-media'
  const remote = new Map()
  let pageToken
  do {
    const data = await google(
      config,
      'storage',
      `storage/v1/b/${bucket}/o?maxResults=1000${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`,
    )
    for (const item of data.items ?? []) remote.set(item.name, item)
    pageToken = data.nextPageToken
  } while (pageToken)
  const mime = key =>
    ({
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      woff2: 'font/woff2',
      css: 'text/css',
      js: 'text/javascript',
    })[key.split('.').pop().toLowerCase()] ?? 'application/octet-stream'
  for (const file of files) {
    assertActiveScope(config)
    const bytes = await readFile(file.path)
    const md5 = createHash('md5').update(bytes).digest('base64')
    const existing = remote.get(file.key)
    if (existing) {
      if (existing.md5Hash !== md5 || Number(existing.size) !== bytes.length)
        throw Error('Existing media object differs; refusing overwrite: ' + file.key)
      continue
    }
    const token = cloud(config, ['auth', 'print-access-token'])
    const response = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(file.key)}`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'X-Goog-User-Project': config.projectId,
          'Content-Type': mime(file.key),
        },
        body: bytes,
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
      },
    )
    if (!response.ok) throw Error('Create-only media upload failed: HTTP ' + response.status)
    const saved = await response.json()
    if (saved.md5Hash !== md5 || Number(saved.size) !== bytes.length) throw Error('Uploaded media checksum differs.')
  }
  return { objects: files.length, noOverwrites: true }
}

export async function validateLocalInputs(config) {
  const archive = await readFile(config.cleanedDump)
  if (createHash('sha256').update(archive).digest('hex') !== config.cleanedDumpSha256)
    throw Error('Cleaned dump checksum differs; no cloud command is allowed.')
  const fingerprints = JSON.parse(await readFile(config.cleanedFingerprints, 'utf8'))
  if (!fingerprints.app_users || !fingerprints.pages || !fingerprints.cms_migrations)
    throw Error('Missing all-table source fingerprints.')
  const inventory = JSON.parse(await readFile(config.mediaInventory, 'utf8'))
  const files = await mediaFiles(config.mediaDirectory)
  if (files.length !== Object.keys(inventory).length) throw Error('Local media count differs from reviewed inventory.')
  for (const file of files) {
    const bytes = await readFile(file.path)
    if (
      inventory[file.key]?.bytes !== bytes.length ||
      inventory[file.key]?.sha256 !== createHash('sha256').update(bytes).digest('hex')
    )
      throw Error('Local media checksum differs: ' + file.key)
  }
  const assets = JSON.parse(await readFile(config.publicAssetOracle, 'utf8'))
  if (
    !Array.isArray(assets) ||
    !assets.length ||
    assets.some(
      x =>
        !['sawso', 'echelon-chapters', 'echelon'].includes(x.site) ||
        !x.path?.startsWith('/') ||
        !/^([a-f0-9]{64})$/.test(x.sha256 ?? ''),
    )
  )
    throw Error('Invalid reviewed public-asset oracle.')
  return {
    archiveBytes: archive.length,
    tables: Object.keys(fingerprints).length,
    mediaObjects: files.length,
    publicAssets: assets.length,
  }
}
