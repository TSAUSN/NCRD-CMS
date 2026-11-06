import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { target } from './local.mjs'
import { compareSnapshots } from './compare.mjs'

test('golden capture refuses remote, retained and ordinary databases before connecting', () => {
  for (const url of [
    'postgres://cms:cms@remote.example.test:54329/cms_e2e_refactor',
    'postgres://cms:cms@127.0.0.1:54331/cms_e2e_refactor',
    'postgres://cms:cms@127.0.0.1:54329/cms_dev',
    'postgres://cms:cms@127.0.0.1:54329/cms_e2e',
    'postgres://cms:cms@127.0.0.1:54329/cms_e2e_refactor?x=1',
  ])
    assert.throws(() => target({ GOLDEN_DATABASE_URL: url }), /Golden capture/)
  assert.equal(
    target({
      GOLDEN_DATABASE_URL: 'postgres://cms:cms@127.0.0.1:54329/cms_e2e_refactor_golden',
      E2E_ADMIN_PORT: '3300',
      E2E_SITE_PORT: '3301',
    }).database,
    'cms_e2e_refactor_golden',
  )
})
test('oracle catches every HTML/CSS, preview and schema byte even with stale equal hashes', () => {
  const root = mkdtempSync(join(tmpdir(), 'cms-golden-proof-')),
    before = join(root, 'before'),
    after = join(root, 'after')
  try {
    for (const d of [before, after]) {
      mkdirSync(d)
      for (const f of ['public.html', 'preview.html', 'schema.sql', 'functions.json'])
        writeFileSync(join(d, f), 'exact bytes\n')
      writeFileSync(
        join(d, 'render-manifest.json'),
        JSON.stringify({
          public: { file: 'public.html', sha256: 'same' },
          preview: { file: 'preview.html', sha256: 'same' },
        }),
      )
    }
    assert.equal(compareSnapshots(before, after).byteIdentical, true)
    for (const [file, key] of [
      ['public.html', 'public'],
      ['preview.html', 'preview'],
      ['schema.sql', 'schema.sql'],
      ['functions.json', 'functions.json'],
    ]) {
      writeFileSync(join(after, file), 'exact bytes \n')
      assert.deepEqual(compareSnapshots(before, after).changed, [key])
      writeFileSync(join(after, file), 'exact bytes\n')
    }
    writeFileSync(
      join(after, 'render-manifest.json'),
      JSON.stringify({ public: { file: 'public.html', sha256: 'same' } }),
    )
    assert.deepEqual(compareSnapshots(before, after).changed, ['preview'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
