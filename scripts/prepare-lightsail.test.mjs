import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lightsailFiles } from './prepare-lightsail.mjs'

const config = {
  adminHost: 'cms.example.test',
  stagingBaseDomain: 'preview.example.test',
  certificateEmail: 'owner@example.test',
  imageId: `sha256:${'a'.repeat(64)}`,
  caddyImage: `docker.io/library/caddy@sha256:${'b'.repeat(64)}`,
}

test('the single-server profile retains isolated hosted roles and a continuous worker', () => {
  const files = lightsailFiles(config),
    compose = JSON.parse(files['compose.yaml'])
  for (const role of ['admin', 'site', 'worker']) {
    const service = compose.services[role]
    assert.equal(service.image, config.imageId)
    assert.equal(service.pull_policy, 'never')
    assert.deepEqual(service.command, [role])
    assert.deepEqual(service.env_file, [`/etc/cms-v2/${role}.env`])
    assert.equal(service.environment.SCHEDULING_ENABLED, 'false')
    assert.equal(service.environment.SCHEDULING_MONITORING_READY, 'false')
    assert.equal(service.environment.CMS_LOCAL_TEST_MODE, undefined)
    assert.equal(service.environment.DATABASE_URL, undefined)
    assert.equal(service.user, '1000:1000')
    assert.equal(service.read_only, true)
    assert.equal(service.environment.MEDIA_PROVIDER, 'filesystem')
    assert.equal(service.environment.MEDIA_ROOT, '/data/media')
  }
  assert.equal(compose.services.admin.environment.AUTH_PROVIDER, 'supabase')
  assert.equal(compose.services.worker.environment.DOMAIN_PROVIDER, 'origin')
  assert.equal(compose.services.admin.ports, undefined)
  assert.equal(compose.services.site.ports, undefined)
  assert.equal(compose.services.site.volumes.includes('media:/data/media:ro'), true)
  assert.equal(compose.services.admin.volumes.includes('media:/data/media'), true)
  assert.equal(compose.services.admin.volumes.includes('admin-cache:/app/apps/admin/.next/cache'), true)
  assert.equal(compose.volumes['admin-cache'].name, `cms-v2-staging-admin-cache-${'a'.repeat(12)}`)
  assert.equal(
    compose.services.admin.tmpfs.some(path => path.includes('.next/cache')),
    false,
  )
  assert.deepEqual(compose.services.worker.ports, ['127.0.0.1:3002:3002'])
  assert.equal(compose.services.worker.healthcheck.test.at(-1).includes('/ready'), true)
})
test('the edge gates new certificates, hides the internal gate, and replaces forwarded host headers', () => {
  const caddy = lightsailFiles(config).Caddyfile
  assert.match(caddy, /ask http:\/\/site:3001\/internal\/tls/)
  assert.equal(caddy.match(/respond @internal 404/g)?.length, 2)
  assert.equal(caddy.match(/header_up X-Forwarded-Host \{http.request.host\}/g)?.length, 2)
  assert.match(caddy, /reverse_proxy admin:3000/)
  assert.match(caddy, /reverse_proxy site:3001/)
})
test('configuration cannot inject an edge directive or select a mutable image', () => {
  for (const adminHost of [
    'localhost',
    'cms.example.test\nrespond 200',
    '*.example.test',
    'CMS.example.test',
    'cms.preview.example.test',
  ]) {
    assert.throws(() => lightsailFiles({ ...config, adminHost }), /hostnames/)
  }
  assert.throws(() => lightsailFiles({ ...config, certificateEmail: 'owner@example.test\nadmin on' }), /email/)
  assert.throws(() => lightsailFiles({ ...config, imageId: 'cms-v2:latest' }), /image ID/)
  assert.throws(() => lightsailFiles({ ...config, caddyImage: 'caddy:latest' }), /official Caddy/)
})
