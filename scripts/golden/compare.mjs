import { readFileSync } from 'node:fs'
import { join } from 'node:path'
/** Hashes locate a difference; Buffer equality is the final byte-level check. */
export function compareSnapshots(before, after) {
  const a = JSON.parse(readFileSync(join(before, 'render-manifest.json'), 'utf8'))
  const b = JSON.parse(readFileSync(join(after, 'render-manifest.json'), 'utf8'))
  const changed = []
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (!a[key] || !b[key] || !readFileSync(join(before, a[key].file)).equals(readFileSync(join(after, b[key].file))))
      changed.push(key)
  }
  for (const file of ['schema.sql', 'functions.json'])
    if (!readFileSync(join(before, file)).equals(readFileSync(join(after, file)))) changed.push(file)
  return { compared: Object.keys(a).length + 2, changed, byteIdentical: changed.length === 0 }
}
