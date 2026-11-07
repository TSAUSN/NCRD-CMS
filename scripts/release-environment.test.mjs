import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('check-release-environment.sh', import.meta.url))
const staging = '10101'
const production = '20202'
const accountIn = project => `cms-release@${project}.iam.gserviceaccount.com`
const check = (
  target,
  selected,
  expectedProduction = production,
  expectedStaging = staging,
  branch = {},
  environment = {},
  args = [],
) =>
  spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      CMS_RELEASE_TARGET: target,
      GITHUB_REF: branch.ref ?? (target === 'production' ? 'refs/heads/main' : 'refs/heads/staging'),
      CMS_STAGING_BRANCH: branch.staging ?? '',
      CMS_DEPLOY_PROJECT_NUMBER: selected,
      CMS_DEPLOY_PROJECT: 'cms-example-project',
      CMS_DEPLOY_IDENTITY_PROVIDER: `projects/${selected}/locations/global/workloadIdentityPools/github/providers/cms`,
      CMS_DEPLOY_SERVICE_ACCOUNT: accountIn('cms-example-project'),
      CMS_RELEASE_STAGING_PROJECT_NUMBER: expectedStaging,
      CMS_RELEASE_PRODUCTION_PROJECT_NUMBER: expectedProduction,
      ...environment,
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

test('a release cannot use an absent or other project’s federated identity', () => {
  const stage = environment => check('staging', staging, '', staging, {}, environment)
  assert.match(stage({ CMS_DEPLOY_IDENTITY_PROVIDER: '' }).stderr, /federated identity provider/)
  assert.match(
    stage({
      CMS_DEPLOY_IDENTITY_PROVIDER: `projects/${production}/locations/global/workloadIdentityPools/github/providers/cms`,
    }).stderr,
    /federated identity provider/,
  )
  assert.match(stage({ CMS_DEPLOY_SERVICE_ACCOUNT: accountIn('another-project') }).stderr, /deployment service account/)
})

test('the runner gets only single-line deployment settings after the target checks pass', () => {
  const folder = mkdtempSync(join(tmpdir(), 'cms-release-vars-'))
  const output = join(folder, 'runner.env')
  try {
    const stage = environment =>
      check('staging', staging, '', staging, {}, { GITHUB_ENV: output, ...environment }, ['--github-env'])
    assert.match(stage({ CMS_DEPLOY_REGION: 'us-central1\nINJECTED=true' }).stderr, /single-line/)
    assert.throws(() => readFileSync(output, 'utf8'), { code: 'ENOENT' })
    assert.equal(stage({ CMS_DEPLOY_REGION: 'us-central1' }).status, 0)
    const values = readFileSync(output, 'utf8')
    assert.match(values, /^CMS_DEPLOY_REGION=us-central1$/m)
    assert.match(values, /^CMS_DEPLOY_PROJECT_NUMBER=10101$/m)
    assert.doesNotMatch(values, /INJECTED|IDENTITY_PROVIDER|SERVICE_ACCOUNT/)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
