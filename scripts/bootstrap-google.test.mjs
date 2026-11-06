import { readFileSync } from 'node:fs'
import { sqlMachineArgs } from './google-bootstrap/common.mjs'
import { installationManifests } from './google-bootstrap/deployment.mjs'
import { createHash } from 'node:crypto'
import { validateLocalInputs } from './google-bootstrap/files.mjs'
import { localAssets } from './google-bootstrap/verification.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrapPlan, containsReviewed } from './bootstrap-google.mjs'
import { assertActiveScope, scopedArgs } from './google-bootstrap/scope.mjs'
import { reviewPendingJobs } from './google-bootstrap/database.mjs'
import { monitoringPolicies } from './google-bootstrap/monitoring.mjs'
const config = {
  projectId: 'cms-example',
  operatorAccount: 'owner@example.test',
  projectNumber: '123456789012',
  region: 'us-central1',
  servicePrefix: 'cms-test',
  sqlInstance: 'cms-database',
  database: 'cms_content',
  sqlTier: 'db-f1-micro',
  publicInvocation: 'allUsers',
  revision: 'a'.repeat(40),
  notificationChannels: ['projects/cms-example/notificationChannels/123'],
  ownerEmail: 'owner@example.test',
  supabaseUrl: 'https://example.supabase.co',
  authPublishableKey: 'sb_publishable_test',
  proxyPort: 54332,
  firebaseSitePrefix: 'c123456789012',
  expectedPublicPages: 75,
  cleanedDumpSha256: 'a'.repeat(64),
  privateDirectory: '/private/cms',
  cleanedDump: '/private/cms/content.dump',
  cleanedFingerprints: '/private/cms/fingerprints.json',
  mediaDirectory: '/private/cms/media',
  mediaInventory: '/private/cms/media.json',
  publicAssetOracle: '/private/cms/oracle.json',
}

test('offline dry run names the full deployment path and explicitly scopes every planned cloud command', () => {
  const plan = bootstrapPlan(config, { project: config.projectId, account: config.operatorAccount })
  assert.equal(plan.dryRun, true)
  assert.deepEqual(
    plan.phases.map(p => p.phase),
    ['infrastructure', 'database', 'media', 'build', 'deploy', 'hosting', 'operations', 'verify'],
  )
  for (const phase of plan.phases)
    for (const command of phase.commands ?? []) {
      assert(command.includes('--project=cms-example'))
      assert(command.includes('--account=owner@example.test'))
      assert(!command.includes('delete'))
      assert(!command.includes('remove'))
    }
  assert(plan.administratorPrerequisites.some(x => x.includes('preserve the existing personal Supabase')))
  assert(plan.phases[1].notes.some(x => x.includes('empty database')))
})

test('wrong, omitted and injected project/account scope is refused before a cloud request', () => {
  for (const target of [
    { project: 'other-project', account: config.operatorAccount },
    { project: config.projectId, account: 'other@example.test' },
    { project: undefined, account: config.operatorAccount },
    { project: config.projectId, account: undefined },
  ])
    assert.throws(() => bootstrapPlan(config, target), /Explicit/)
  assert.throws(() => scopedArgs(config, ['run', 'services', 'list', '--project=other-project']), /supplies scope/)
  assert.throws(() => scopedArgs(config, ['sql', 'instances', 'delete', 'cms-database']), /deletion/)
  assert.throws(
    () =>
      bootstrapPlan(
        { ...config, publicInvocation: undefined },
        { project: config.projectId, account: config.operatorAccount },
      ),
    /IT must choose/,
  )
})

test('ambient configuration mismatches and credential impersonation cannot be masked by explicit flags', () => {
  const root = mkdtempSync(join(tmpdir(), 'cms-bootstrap-scope-'))
  try {
    mkdirSync(join(root, 'configurations'))
    writeFileSync(join(root, 'active_config'), 'test')
    writeFileSync(
      join(root, 'configurations/config_test'),
      '[core]\naccount = owner@example.test\nproject = other-project\n',
    )
    assert.throws(() => assertActiveScope(config, { CLOUDSDK_CONFIG: root }), /STOP/)
    writeFileSync(
      join(root, 'configurations/config_test'),
      '[core]\naccount = owner@example.test\nproject = cms-example\n',
    )
    assert.doesNotThrow(() => assertActiveScope(config, { CLOUDSDK_CONFIG: root }))
    assert.throws(
      () => assertActiveScope(config, { CLOUDSDK_CONFIG: root, CLOUDSDK_CORE_PROJECT: 'other-project' }),
      /STOP/,
    )
    assert.throws(
      () =>
        assertActiveScope(config, {
          CLOUDSDK_CONFIG: root,
          CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT: 'other@example.test',
        }),
      /impersonation/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('alerts stay within target service names and a target-project notification channel', () => {
  const policies = monitoringPolicies(config, 'cms-test-worker', 'cms-test-admin', 'cms-test-site')
  assert.equal(policies.length, 4)
  for (const p of policies) assert.deepEqual(p.notificationChannels, config.notificationChannels)
  assert.match(policies[1].conditions[0].conditionAbsent.filter, /cms-test-worker/)
  assert.match(policies[2].conditions[0].conditionThreshold.filter, /cms-test-site/)
  assert.throws(
    () =>
      monitoringPolicies(
        { ...config, notificationChannels: ['projects/wrong-project/notificationChannels/123'] },
        'worker',
        'admin',
        'site',
      ),
    /target-project/,
  )
})

test('resume accepts matching reviewed settings and refuses changed targets or grants', () => {
  const expected = {
    schedule: '* * * * *',
    httpTarget: { uri: 'https://worker.example.test/run', oidcToken: { audience: 'https://worker.example.test' } },
  }
  assert(containsReviewed({ ...expected, state: 'ENABLED', createTime: 'provider-metadata' }, expected))
  assert(
    !containsReviewed(
      { ...expected, httpTarget: { ...expected.httpTarget, uri: 'https://wrong.example.test/run' } },
      expected,
    ),
  )
  assert(
    !containsReviewed(
      { notificationChannels: ['projects/wrong/notificationChannels/1'] },
      { notificationChannels: config.notificationChannels },
    ),
  )
  for (const policy of monitoringPolicies(config, 'worker', 'admin', 'site'))
    for (const condition of policy.conditions) {
      if (condition.conditionAbsent) assert(Number(condition.conditionAbsent.duration.slice(0, -1)) <= 84600)
    }
})

test('bootstrap refuses replayable work and permits only reviewed archived-site cache invalidations', () => {
  assert.deepEqual(reviewPendingJobs([{ event_type: 'site_shell.published', status: 'pending', archived: true }], 0), {
    archivedSiteCacheInvalidations: 1,
  })
  for (const event of [
    { event_type: 'user.invited', status: 'pending', archived: true },
    { event_type: 'domain.sync', status: 'pending', archived: true },
    { event_type: 'site_shell.published', status: 'running', archived: true },
    { event_type: 'site_shell.published', status: 'pending', archived: false },
  ])
    assert.throws(() => reviewPendingJobs([event], 0), /pending jobs/)
  assert.throws(() => reviewPendingJobs([], 1), /pending jobs/)
})

test('public verification inspects owned image/script/style resources without fetching external sites', () => {
  assert.deepEqual(
    localAssets(
      '<html><head><link rel="stylesheet" href="/theme.css"><style>.x{background:url(/back.png)}</style></head><body><img src="/image.jpg" srcset="/large.jpg 2x"><img src="https://outside.example.test/photo"><script src="/site.js"></script><a href="/another-page">Page</a></body></html>',
      'https://native.web.app/page',
    ),
    [
      'https://native.web.app/back.png',
      'https://native.web.app/image.jpg',
      'https://native.web.app/large.jpg',
      'https://native.web.app/site.js',
      'https://native.web.app/theme.css',
    ],
  )
})

test('deployment pins commit health/heartbeat, preserves compiled Next identity and never exposes the worker', () => {
  const c = {
    ...config,
    supabaseUrl: 'https://example.supabase.co',
    authPublishableKey: 'sb_publishable_test',
    firebaseSitePrefix: 'c123456789012',
    licensedBrandFontsApproved: true,
  }
  const images = {
    revision: c.revision,
    runtime: `us-central1-docker.pkg.dev/cms-example/cms-v2/app@sha256:${'b'.repeat(64)}`,
    recovery: `us-central1-docker.pkg.dev/cms-example/cms-v2/app-recovery@sha256:${'c'.repeat(64)}`,
  }
  const refs = Object.fromEntries(
    ['adminDatabase', 'publicDatabase', 'workerDatabase', 'migrationDatabase', 'backupKey'].map(k => [
      k,
      { name: k, version: '1' },
    ]),
  )
  for (const invocation of ['allUsers', 'disable-invoker-check']) {
    const m = installationManifests({ ...c, publicInvocation: invocation }, images, refs)
    for (const role of ['admin', 'site', 'worker']) {
      const env = m[role].spec.template.spec.containers[0].env
      assert.equal(env.find(x => x.name === 'APP_VERSION').value, 'aaaaaaa')
      assert.equal(env.find(x => x.name === 'DATABASE_POOL_MAX').value, '2')
      assert(!env.some(x => x.name === 'NEXT_DEPLOYMENT_ID' || x.name === 'CMS_LOCAL_TEST_MODE'))
      assert.equal(m[role].metadata.name, 'cms-test-' + role)
    }
    assert.equal(m.worker.metadata.annotations['run.googleapis.com/invoker-iam-disabled'], 'false')
    assert.equal(m.admin.spec.template.spec.containers[0].env.find(x => x.name === 'AUTH_PROVIDER').value, 'supabase')
    assert.equal(
      m.admin.spec.template.spec.containers[0].env.find(x => x.name === 'INVITATION_EMAIL_ENABLED').value,
      'false',
    )
    assert.equal(
      m.worker.spec.template.spec.containers[0].env.find(x => x.name === 'FIREBASE_PUBLIC_SERVICE').value,
      'cms-test-site',
    )
  }
  assert.throws(() => installationManifests(c, { ...images, revision: 'd'.repeat(40) }, refs), /freeze/)
})

test('local preflight refuses changed archives, missing fingerprints and altered media before provisioning', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cms-bootstrap-inputs-'))
  try {
    mkdirSync(join(root, 'media'))
    const archive = Buffer.from('reviewed database archive'),
      media = Buffer.from('reviewed image'),
      hash = x => createHash('sha256').update(x).digest('hex')
    const c = {
      ...config,
      cleanedDump: join(root, 'source.dump'),
      cleanedFingerprints: join(root, 'tables.json'),
      mediaDirectory: join(root, 'media'),
      mediaInventory: join(root, 'media.json'),
      publicAssetOracle: join(root, 'assets.json'),
      cleanedDumpSha256: hash(archive),
    }
    writeFileSync(c.cleanedDump, archive)
    writeFileSync(c.cleanedFingerprints, JSON.stringify({ app_users: 'hash', pages: 'hash', cms_migrations: 'hash' }))
    writeFileSync(join(c.mediaDirectory, 'image.png'), media)
    writeFileSync(c.mediaInventory, JSON.stringify({ 'image.png': { bytes: media.length, sha256: hash(media) } }))
    writeFileSync(c.publicAssetOracle, JSON.stringify([{ site: 'sawso', path: '/image.png', sha256: hash(media) }]))
    assert.deepEqual(await validateLocalInputs(c), {
      archiveBytes: archive.length,
      tables: 3,
      mediaObjects: 1,
      publicAssets: 1,
    })
    writeFileSync(c.cleanedDump, 'altered')
    await assert.rejects(validateLocalInputs(c), /dump checksum/)
    writeFileSync(c.cleanedDump, archive)
    writeFileSync(c.cleanedFingerprints, '{}')
    await assert.rejects(validateLocalInputs(c), /all-table/)
    writeFileSync(c.cleanedFingerprints, JSON.stringify({ app_users: 'hash', pages: 'hash', cms_migrations: 'hash' }))
    writeFileSync(join(c.mediaDirectory, 'image.png'), 'altered')
    await assert.rejects(validateLocalInputs(c), /media checksum/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Friday default stays within the agreed micro budget and dedicated upgrade uses current CLI flags', () => {
  const example = JSON.parse(readFileSync(new URL('../deploy/google/bootstrap.example.json', import.meta.url), 'utf8'))
  assert.equal(example.sqlTier, 'db-f1-micro')
  const plan = bootstrapPlan(config, { project: config.projectId, account: config.operatorAccount })
  const sql = plan.phases[0].commands.find(c => c.includes('instances') && c.includes('create'))
  assert(sql.includes('--tier=db-f1-micro'))
  assert.deepEqual(sqlMachineArgs('db-custom-1-3840'), ['--cpu=1', '--memory=3840MiB'])
  assert.throws(() => sqlMachineArgs('db-custom-64-245760'), /bounded SQL/)
})
