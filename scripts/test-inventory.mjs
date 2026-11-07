import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const checkout = resolve(process.env.CMS_TEST_CHECKOUT ?? resolve(import.meta.dirname, '..'))

function pnpm(args, env = {}) {
  const result = spawnSync('pnpm', args, {
    cwd: checkout,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.status !== 0) throw Error('Test inventory command failed: pnpm ' + args.join(' ') + '\n' + result.stderr)
  return JSON.parse(result.stdout)
}

function inventory() {
  if (process.env.E2E_ALLOW_STALE_BUILD === '1') throw Error('Build the current checkout; stale builds are forbidden.')
  const tests = []
  for (const project of pnpm(['-r', 'list', '--depth=-1', '--json'])) {
    const scripts = JSON.parse(readFileSync(join(project.path, 'package.json'), 'utf8')).scripts ?? {}
    for (const key of ['test', 'test:db']) {
      const script = scripts[key]
      if (!script?.startsWith('vitest run')) continue
      const config = script.match(/--config (\S+)/)?.[1]
      const args = ['--filter', project.name, 'exec', 'vitest', 'list', '--json', '--maxWorkers=2']
      if (config) args.push('--config', config)
      for (const test of pnpm(args)) tests.push([project.name, key, test.name])
    }
  }
  for (const config of ['playwright.config.ts', 'playwright.no-mail.config.ts']) {
    const args = ['--filter', 'e2e', 'exec', 'playwright', 'test', '--list', '--reporter=json', '--config', config]
    args.push('--project=chromium')
    if (config === 'playwright.config.ts') args.push('--project=webkit')
    const report = pnpm(args, { RELEASE_BROWSERS: '1' })
    function visit(suite, parents = []) {
      for (const spec of suite.specs ?? [])
        for (const test of spec.tests) tests.push([config, test.projectName, ...parents, spec.title])
      for (const child of suite.suites ?? []) visit(child, [...parents, child.title])
    }
    // A file can move or be renamed. Its describe blocks and every test title must survive.
    for (const file of report.suites) visit(file)
  }
  return tests.map(entry => JSON.stringify(entry)).sort()
}

function missingTitles(before, after) {
  const counts = new Map()
  for (const title of after) counts.set(title, (counts.get(title) ?? 0) + 1)
  return before.filter(title => {
    const count = counts.get(title) ?? 0
    if (count === 0) return true
    counts.set(title, count - 1)
    return false
  })
}

const [mode, file] = process.argv.slice(2)
if (!['capture', 'check'].includes(mode) || !file)
  throw Error('Usage: node scripts/test-inventory.mjs capture|check INVENTORY.json')

const current = inventory()
if (mode === 'capture') writeFileSync(file, JSON.stringify(current, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
else {
  const before = JSON.parse(readFileSync(file, 'utf8'))
  const missing = missingTitles(before, current)
  if (missing.length) {
    console.error('Missing test titles (duplicates also count):\n' + missing.join('\n'))
    process.exitCode = 1
  }
}
console.log('Discovered ' + current.length + ' test titles.')
