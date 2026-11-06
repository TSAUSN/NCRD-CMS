import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { demoNeedsBuild } from './demo-build.mjs'

test('rebuilds a stale demo for app or shared source, without reacting to docs or tests', () => {
  const root = mkdtempSync(join(tmpdir(), 'cms-demo-build-'))
  const write = (file, seconds) => {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'fixture')
    utimesSync(path, seconds, seconds)
  }
  try {
    assert.equal(demoNeedsBuild(root), true)
    for (const app of ['admin', 'site']) write(`apps/${app}/.next/BUILD_ID`, 200)
    write('apps/admin/src/page.tsx', 100)
    write('packages/renderer/src/render.ts', 100)
    write('docs/guide.md', 300)
    write('apps/admin/src/page.test.tsx', 300)
    assert.equal(demoNeedsBuild(root), false)
    write('apps/admin/src/page.tsx', 300)
    assert.equal(demoNeedsBuild(root), true)
    write('apps/admin/src/page.tsx', 100)
    write('packages/renderer/src/render.ts', 300)
    assert.equal(demoNeedsBuild(root), true)
    write('packages/renderer/src/render.ts', 100)
    write('pnpm-lock.yaml', 300)
    assert.equal(demoNeedsBuild(root), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
