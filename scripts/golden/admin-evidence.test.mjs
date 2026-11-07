import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareScreens } from './admin-evidence.mjs'
import { root } from './local.mjs'

const { PNG } = createRequire(join(root, 'e2e/package.json'))('playwright-core/lib/utilsBundle')

test('a single pixel, a computed style change, and a missing screen each fail the visual comparison', () => {
  const temp = mkdtempSync(join(tmpdir(), 'cms-screen-evidence-'))
  try {
    const before = join(temp, 'before')
    const after = join(temp, 'after')
    mkdirSync(before)
    mkdirSync(after)
    const row = { pattern: '/', width: 900, file: 'screen.png', computedStyleHash: 'before', stylesheets: [] }
    const image = new PNG({ width: 2, height: 2 })
    image.data.fill(255)
    const write = folder => writeFileSync(join(folder, row.file), PNG.sync.write(image))
    const compare = captures => compareScreens(before, { captures: [row] }, after, captures).differences
    write(before)
    write(after)
    assert.deepEqual(compare([row]), [])
    image.data[0]--
    write(after)
    assert.deepEqual(compare([row]), [{ pattern: '/', width: 900, pixels: 1, stylesChanged: false }])
    image.data[0]++
    write(after)
    assert.deepEqual(compare([{ ...row, computedStyleHash: 'after' }]), [
      { pattern: '/', width: 900, pixels: 0, stylesChanged: true },
    ])
    assert.deepEqual(compare([]), [{ pattern: '/', width: 900, reason: 'Missing capture' }])
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
