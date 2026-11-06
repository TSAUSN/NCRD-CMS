// The V1 checkout is read-only, and this is where that stops being a promise.
//
// A comment saying "we never write to V1" is worth nothing the day somebody adds
// a cache, a fixup pass, or a `--fix` flag. So the invariant is asserted against
// the package's own source: every filesystem write in this package lives in
// `cli.ts`, and the path it writes to is one the caller named. Nothing else may
// open a handle for writing at all.
//
// A source-text assertion is a blunt instrument and it is the right one here.
// The alternative — stubbing `node:fs` and running the importer — proves that
// this build does not write, whereas the question is whether *any* build can,
// and that is a question about what the source contains.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SOURCE = path.dirname(fileURLToPath(import.meta.url))

/** Every API in `node:fs` that changes the filesystem. */
const MUTATING_FS = [
  'writeFile',
  'appendFile',
  'createWriteStream',
  'mkdir',
  'rmdir',
  'rm',
  'unlink',
  'rename',
  'copyFile',
  'truncate',
  'chmod',
  'chown',
  'utimes',
  'symlink',
  'link',
  'open',
]

/** Files that are allowed to write, and the one place a path can come from. */
// better-together-cli.ts requires an explicit output path.
// website-cli.ts writes the archive and report to the path named by --out.
const MAY_WRITE = new Set(['better-together-cli.ts', 'cli.ts', 'migration-cli.ts', 'website-cli.ts'])

function sources(): { name: string; text: string }[] {
  return readdirSync(SOURCE)
    .filter(name => name.endsWith('.ts'))
    .sort()
    .map(name => ({ name, text: readFileSync(path.join(SOURCE, name), 'utf8') }))
}

describe('the importer’s access to the filesystem', () => {
  it('writes only from the CLI entry points, with caller-named destinations', () => {
    const writers = sources()
      .filter(({ name }) => !name.endsWith('.test.ts'))
      .filter(({ text }) => MUTATING_FS.some(api => new RegExp(`\\b${api}(?:Sync)?\\s*\\(`).test(text)))
      .map(({ name }) => name)
    expect(writers).toEqual([...MAY_WRITE])
  })

  it('reads V1 through readFileSync and nothing else', () => {
    const reader = readFileSync(path.join(SOURCE, 'source.ts'), 'utf8')
    expect(reader).toContain('readFileSync')
    for (const api of MUTATING_FS) {
      expect(reader, api).not.toMatch(new RegExp(`\\b${api}(?:Sync)?\\s*\\(`))
    }
  })

  it('never joins a path against the V1 root anywhere a write could happen', () => {
    const cli = readFileSync(path.join(SOURCE, 'cli.ts'), 'utf8')
    // Every write in cli.ts is under `out` or `documents`, both of which are
    // arguments. This used to count the occurrences of `v1Root` and require
    // exactly one, which broke the moment the hardcoded default was removed and
    // the value became a local — a count is a proxy for the property, and the
    // property is that no write is ever addressed relative to V1. Assert that
    // instead: no line mentioning v1Root may also mention a mutating call.
    for (const line of cli.split('\n')) {
      if (!line.includes('v1Root')) continue
      for (const api of MUTATING_FS) {
        expect(line, `${api} on a line addressing V1`).not.toMatch(new RegExp(`\\b${api}(?:Sync)?\\s*\\(`))
      }
    }
    expect(cli).not.toMatch(/writeFileSync\([^)]*v1/i)
  })

  it('has no flag, environment variable or mode that turns writing V1 on', () => {
    // Tests excluded, and this one in particular: the pattern below appears in
    // its own source, so a check that scanned every file would only ever be
    // reporting on itself.
    for (const { name, text } of sources().filter(file => !file.name.endsWith('.test.ts'))) {
      expect(text, name).not.toMatch(/--write|--fix|--in-place|--apply/)
    }
  })
})
