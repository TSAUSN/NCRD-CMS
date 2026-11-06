import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { referenceFiles, staleReference, withoutFunctionBodies } from './current-sql.mjs'
test('reference rejects non-test databases and remote connections before reading', async () => {
  for (const url of [
    'https://cms:cms@127.0.0.1:54329/cms_e2e_refactor',
    'postgres://cms:cms@remote.example.test:54329/cms_e2e_refactor',
    'postgres://cms:cms@127.0.0.1:54331/cms_e2e_refactor',
    'postgres://cms:cms@127.0.0.1:54329/cms_dev',
  ])
    await assert.rejects(referenceFiles(url), /disposable local/)
})
test('catalog removes duplicate function bodies while retaining table/RLS/grant entries', () => {
  const toc =
    '1; 1255 20 FUNCTION app save_page(uuid) cms_migration_owner\n2; 0 0 ACL app FUNCTION save_page(uuid) cms_migration_owner\n3; 1259 21 TABLE public pages cms_migration_owner\n4; 0 0 POLICY public pages pages_scope cms_migration_owner'
  const result = withoutFunctionBodies(toc)
  assert(!result.includes('1255 20 FUNCTION'))
  assert(result.includes('ACL app FUNCTION'))
  assert(result.includes('TABLE public pages'))
  assert(result.includes('POLICY public pages'))
})
test('stale check detects changed SQL and extra or missing reference files', () => {
  const root = mkdtempSync(join(tmpdir(), 'cms-reference-check-')),
    files = new Map([['command.sql', 'exact SQL\n']])
  try {
    assert.deepEqual(staleReference(files, root), ['command.sql'])
    writeFileSync(join(root, 'command.sql'), 'exact SQL\n')
    assert.deepEqual(staleReference(files, root), [])
    writeFileSync(join(root, 'command.sql'), 'exact SQL \n')
    writeFileSync(join(root, 'obsolete.sql'), 'old')
    assert.deepEqual(staleReference(files, root), ['command.sql', 'obsolete.sql'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
