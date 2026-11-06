// `pnpm demo` — the whole CMS on this machine, led by SAWSO, then Echelon chapters and Better Together 2027,
// with the Human Needs Index and Echelon Symposium also available
// in it and published to
// their preview addresses (demo/README.md says where each came from).
//
//   pnpm demo            start everything (builds the apps the first time)
//   pnpm demo --build    rebuild the apps first, after changing code
//   pnpm demo --reset    start again from the committed site archives
//
// It uses its own database (cms_demo) on the local Postgres that `pnpm db:up`
// runs, so development data in cms_dev is never touched, and keeps its media
// beside that database, outside the repository (~/.local/share/cms-v2 unless
// CMS_DATA_HOME says otherwise). Ctrl+C stops the admin, the public site and
// the worker.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { demoNeedsBuild } from './demo-build.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const flags = new Set(process.argv.slice(2))
const ADMIN_PORT = 3000,
  SITE_PORT = 3001
const postgresPort = process.env['CMS_PG_PORT'] ?? '54329'
if (!/^\d{1,5}$/.test(postgresPort) || Number(postgresPort) < 1 || Number(postgresPort) > 65535) {
  console.error('CMS_PG_PORT must be a TCP port from 1 to 65535.')
  process.exit(1)
}
const dataHome = process.env['CMS_DATA_HOME'] ?? join(homedir(), '.local', 'share', 'cms-v2')
const database = (user, password) => `postgres://${user}:${password}@127.0.0.1:${postgresPort}/cms_demo`
const env = {
  ...process.env,
  DATABASE_URL: database('cms', 'cms'),
  DATABASE_URL_AUTHENTICATED: database('cms_admin_app', 'devpassword'),
  DATABASE_URL_PUBLIC: database('cms_site_app', 'devpassword'),
  DATABASE_URL_WORKER: database('cms_worker_app', 'devpassword'),
  // Email-only sign-in for people listed in the demo data. Loopback only: the
  // admin refuses this mode on any other address.
  AUTH_PROVIDER: 'local',
  AUTH_SECRET: process.env['AUTH_SECRET'] ?? 'local-demo-only-never-hosted',
  CMS_LOCAL_TEST_MODE: 'true',
  ADMIN_ORIGIN: `http://localhost:${ADMIN_PORT}`,
  PUBLIC_SITE_PORT: String(SITE_PORT),
  MAILER_PROVIDER: 'recording',
  TRUST_PROXY_HEADERS: 'false',
  // The demo's worker runs beside the apps and reports its heartbeat, which is
  // all the monitoring a single machine has; hosted setups decide separately.
  SCHEDULING_ENABLED: 'true',
  SCHEDULING_MONITORING_READY: 'true',
  MEDIA_PROVIDER: 'filesystem',
  MEDIA_ROOT: join(dataHome, 'demo-media'),
  pnpm_config_verify_deps_before_run: 'false',
}

function step(label, command, args, options = {}) {
  console.log(`\n▸ ${label}`)
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', ...options })
  if (result.status !== 0) {
    console.error(`\n${label} failed. Nothing else was started.`)
    process.exit(result.status ?? 1)
  }
}

if (!existsSync(join(root, 'node_modules'))) {
  console.error('Install the dependencies first:  pnpm install')
  process.exit(1)
}
step('Checking Node', process.execPath, ['scripts/check-node.mjs'])
step('Starting Postgres', 'sh', ['scripts/local-db.sh'])
if (flags.has('--reset')) {
  rmSync(env.MEDIA_ROOT, { recursive: true, force: true })
  step('Removing the previous demo database', 'pnpm', ['--filter', '@cms/schema', 'db:bootstrap', '--', '--drop-only'])
}
step('Preparing the demo database', 'pnpm', ['--filter', '@cms/schema', 'db:bootstrap'])
step('Loading the demo sites (the first time takes a couple of minutes)', 'pnpm', [
  '--filter',
  'admin',
  'exec',
  'node',
  '--conditions=react-server',
  '--experimental-strip-types',
  '--no-warnings',
  'scripts/demo-data.ts',
])
if (flags.has('--build') || demoNeedsBuild(root))
  step('Building the current admin and public site', 'pnpm', ['--filter', 'admin', '--filter', 'site', 'build'])

const children = []
function start(name, cwd, command, args) {
  const child = spawn(command, args, { cwd: join(root, cwd), env, stdio: ['ignore', 'pipe', 'pipe'] })
  const prefix = `[${name}] `
  const forward = (stream, out) =>
    stream.on('data', chunk => {
      for (const line of String(chunk).split('\n')) if (line.trim()) out.write(prefix + line + '\n')
    })
  forward(child.stdout, process.stdout)
  forward(child.stderr, process.stderr)
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`${prefix}stopped unexpectedly (${signal ?? code}); stopping the demo.`)
      stop(1)
    }
  })
  children.push(child)
}
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 500)
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

start('admin', 'apps/admin', 'node_modules/.bin/next', [
  'start',
  '--port',
  String(ADMIN_PORT),
  '--hostname',
  '127.0.0.1',
])
start('site', 'apps/site', 'node_modules/.bin/next', ['start', '--port', String(SITE_PORT), '--hostname', '127.0.0.1'])
start('worker', 'apps/worker', process.execPath, ['--experimental-strip-types', '--no-warnings', 'src/main.ts'])

console.log(`
The CMS demo is running. Press Ctrl+C to stop it.

  Admin              http://localhost:${ADMIN_PORT}
                     sign in as admin@example.test (everything), editor@example.test
                     (edits and publishes pages) or contributor@example.test (suggests changes)
  SAWSO              http://sawso.staging.localhost:${SITE_PORT}   (approved national look, sectors, Stories and Newsroom)
  Echelon chapters   http://echelon-chapters.staging.localhost:${SITE_PORT}
  Better Together    http://bt2027-r8.staging.localhost:${SITE_PORT}   (original local design, editable speakers, sponsors and workshops)
  Human Needs Index  http://hni.staging.localhost:${SITE_PORT}
  Echelon Symposium  http://echelon.staging.localhost:${SITE_PORT}

These are independent local examples. No Salvation Army production website is connected.
`)
