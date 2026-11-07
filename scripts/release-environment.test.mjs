import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('check-release-environment.sh', import.meta.url))
const staging = '10101'
const production = '20202'
const check = (target, selected, expectedProduction = production, expectedStaging = staging, branch = {}) =>
  spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      CMS_RELEASE_TARGET: target,
      GITHUB_REF: branch.ref ?? (target === 'production' ? 'refs/heads/main' : 'refs/heads/staging'),
      CMS_STAGING_BRANCH: branch.staging ?? '',
      CMS_DEPLOY_PROJECT_NUMBER: selected,
      CMS_RELEASE_STAGING_PROJECT_NUMBER: expectedStaging,
      CMS_RELEASE_PRODUCTION_PROJECT_NUMBER: expectedProduction,
    },
  })

test('staging can ship before production exists; production requires its own project', () => {
  assert.equal(check('staging', staging, '').status, 0)
  assert.equal(check('production', production).status, 0)
  assert.match(check('production', production, '').stderr, /Set the production project number/)
})

test('misconfigured or swapped environments are refused before credentials are requested', () => {
  for (const result of [
    check('staging', production),
    check('production', staging),
    check('production', staging, staging),
    check('staging', staging, staging),
    check('staging', staging, production, ''),
    check('other', staging),
  ]) {
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Release stopped:/)
  }
})

test('a staging branch in a namespace is checked exactly and cannot use main', () => {
  const selected = { staging: 'staging/cms-release', ref: 'refs/heads/staging/cms-release' }
  assert.equal(check('staging', staging, '', staging, selected).status, 0)
  assert.match(
    check('staging', staging, '', staging, { ...selected, ref: 'refs/heads/staging/other' }).stderr,
    /configured branch/,
  )
  assert.match(
    check('staging', staging, '', staging, { ...selected, ref: 'refs/heads/Staging/cms-release' }).stderr,
    /configured branch/,
  )
  assert.match(
    check('staging', staging, '', staging, { staging: 'main', ref: 'refs/heads/main' }).stderr,
    /valid branch/,
  )
  assert.match(check('production', production, production, staging, selected).stderr, /configured branch/)
})
