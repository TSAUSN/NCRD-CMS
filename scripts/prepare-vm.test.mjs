import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const script = fileURLToPath(new URL('./prepare-vm.mjs', import.meta.url))
const config = {
  adminHost: 'cms.example.test',
  stagingBaseDomain: 'preview.example.test',
  certificateEmail: 'owner@example.test',
  imageId: `sha256:${'a'.repeat(64)}`,
  caddyImage: `docker.io/library/caddy@sha256:${'b'.repeat(64)}`,
}

test('the portable CLI writes a private release without contacting a provider', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cms-vm-release-'))
  try {
    const input = join(directory, 'config.json'),
      output = join(directory, 'release')
    writeFileSync(input, JSON.stringify(config), { mode: 0o600 })
    const run = spawnSync(process.execPath, [script, input, output], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(JSON.parse(run.stdout).deployed, false)
    assert.equal(statSync(output).mode & 0o777, 0o700)
    for (const name of ['compose.yaml', 'Caddyfile']) {
      assert.equal(statSync(join(output, name)).mode & 0o777, 0o600)
    }
    const compose = JSON.parse(readFileSync(join(output, 'compose.yaml'), 'utf8'))
    assert.equal(compose.services.worker.environment.SCHEDULING_ENABLED, 'false')
    assert.equal(compose.services.admin.environment.AUTH_PROVIDER, 'supabase')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a second preparation cannot replace an existing release', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cms-vm-release-'))
  try {
    const input = join(directory, 'config.json'),
      output = join(directory, 'release')
    writeFileSync(input, JSON.stringify(config), { mode: 0o600 })
    assert.equal(spawnSync(process.execPath, [script, input, output]).status, 0)
    const before = readFileSync(join(output, 'compose.yaml'), 'utf8')
    writeFileSync(input, JSON.stringify({ ...config, adminHost: 'other.example.test' }))
    assert.notEqual(spawnSync(process.execPath, [script, input, output]).status, 0)
    assert.equal(readFileSync(join(output, 'compose.yaml'), 'utf8'), before)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
