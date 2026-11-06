import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hostedCopyTarget } from './prepare-hosted-copy.mjs'
test('cleanup accepts only the named isolated local copy and refuses retained/test/cloud targets', () => {
  assert.equal(
    hostedCopyTarget('postgres://cms:cms@127.0.0.1:54329/cms_hosting_20261104').pathname,
    '/cms_hosting_20261104',
  )
  for (const url of [
    'postgres://cms:cms@127.0.0.1:54329/cms_demo',
    'postgres://cms:cms@127.0.0.1:54329/cms_e2e',
    'postgres://cms:cms@remote.test:54329/cms_hosting_copy',
    'postgres://cms:cms@127.0.0.1:5432/cms_hosting_copy',
    'postgres://cms:cms@127.0.0.1:54329/cms_hosting_copy?host=remote.test',
  ])
    assert.throws(() => hostedCopyTarget(url))
})
