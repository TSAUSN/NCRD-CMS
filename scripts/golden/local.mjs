import { createServer } from 'node:net'
import { demoNeedsBuild } from '../demo-build.mjs'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { openSync, closeSync, writeFileSync, readFileSync, mkdirSync, statSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHmac } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { e2ePorts } from '../../e2e/test-ports.ts'
export const root = resolve(process.env.CMS_GOLDEN_CHECKOUT ?? resolve(import.meta.dirname, '../..'))
export const { Client } = createRequire(join(root, 'packages/schema/package.json'))('pg')
export const AUTH_SECRET = 'isolated-golden-local-only-not-a-hosted-credential'
export function target(env = process.env) {
  const value = new URL(env.GOLDEN_DATABASE_URL ?? '')
  if (
    !['postgres:', 'postgresql:'].includes(value.protocol) ||
    !['localhost', '127.0.0.1'].includes(value.hostname) ||
    value.port !== '54329' ||
    !/^\/cms_e2e_refactor(?:_golden|_screens|_perf|_burst(?:_autosave|_checkpoint)?)?$/.test(value.pathname) ||
    value.search ||
    value.hash
  )
    throw Error(
      'Golden capture requires explicit GOLDEN_DATABASE_URL on local54329, database cms_e2e_refactor or its named golden/screens fixtures.',
    )
  return {
    url: value.href,
    database: value.pathname.slice(1),
    host: value.hostname,
    port: value.port,
    user: decodeURIComponent(value.username),
    password: decodeURIComponent(value.password),
    ports: e2ePorts(env),
  }
}
export function privateDirectory(path) {
  const directory = resolve(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (statSync(directory).mode & 0o077) throw Error('Golden artifact directory must be private (chmod700).')
  if (spawnSync('git', ['-C', directory, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' }).status === 0)
    throw Error('Golden artifacts and preview credentials must stay outside Git.')
  return directory
}
export function localCookie(email) {
  const payload = Buffer.from(JSON.stringify({ subject: `local|${email}`, email })).toString('base64url')
  return `cms_session=${payload}.${createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url')}`
}
export async function schemaSnapshot(t, out) {
  const env = {
    ...process.env,
    PGHOST: t.host,
    PGPORT: t.port,
    PGUSER: t.user,
    PGPASSWORD: t.password,
    PGDATABASE: t.database,
  }
  const result = spawnSync('pg_dump', ['--schema-only'], { env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0) throw Error('Golden pg_dump failed; private connection output omitted.')
  // These randomized client transport guards are not SQL schema. Every SQL byte
  // (including comments, owners, grants and policies) remains in the oracle.
  writeFileSync(join(out, 'schema.sql'), result.stdout.replace(/^\\(?:un)?restrict .*\n/gm, ''), { mode: 0o600 })
  const db = new Client({ connectionString: t.url })
  await db.connect()
  try {
    const functions = (
      await db.query(
        "SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition,pg_get_userbyid(p.proowner) AS owner,p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','public_api') ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)",
      )
    ).rows
    writeFileSync(join(out, 'functions.json'), JSON.stringify(functions, null, 2) + '\n', { mode: 0o600 })
    return functions.length
  } finally {
    await db.end()
  }
}
export async function applications(t, out, mediaRoot, { traceFile } = {}) {
  if (demoNeedsBuild(root)) throw Error('Build admin and site from the current source before golden capture.')
  if (!existsSync(join(root, 'apps/admin/.next/BUILD_ID')) || !existsSync(join(root, 'apps/site/.next/BUILD_ID')))
    throw Error('Build admin and site before golden capture.')
  if (!mediaRoot || !resolve(mediaRoot).startsWith('/') || !statSync(mediaRoot).isDirectory())
    throw Error('Supply the reviewed local media directory.')
  const env = {
    ...process.env,
    DATABASE_URL: t.url,
    DATABASE_URL_AUTHENTICATED: `postgres://cms_admin_app:devpassword@${t.host}:${t.port}/${t.database}`,
    DATABASE_URL_PUBLIC: `postgres://cms_site_app:devpassword@${t.host}:${t.port}/${t.database}`,
    DATABASE_URL_WORKER: `postgres://cms_worker_app:devpassword@${t.host}:${t.port}/${t.database}`,
    MAILER_PROVIDER: 'recording',
    DOMAIN_PROVIDER: 'fake',
    AUTH_PROVIDER: 'local',
    AUTH_SECRET,
    CMS_LOCAL_TEST_MODE: 'true',
    ADMIN_ORIGIN: `http://127.0.0.1:${t.ports.admin}`,
    PUBLIC_SITE_PORT: String(t.ports.site),
    MEDIA_PROVIDER: 'filesystem',
    MEDIA_ROOT: resolve(mediaRoot),
    CMS_SERVE_LICENSED_BRAND_FONTS: 'true',
    TRUST_PROXY_HEADERS: 'false',
    SCHEDULING_ENABLED: 'false',
    APP_VERSION: 'golden-local',
    NODE_ENV: 'production',
    ...(traceFile ? { CMS_PERF_TRACE: '1', DATABASE_POOL_MAX: '2' } : {}),
  }
  const children = []
  const stop = async () => {
    for (const child of children) if (child.exitCode === null) process.kill(-child.pid, 'SIGTERM')
    await Promise.all(
      children.map(child =>
        child.exitCode !== null
          ? Promise.resolve()
          : new Promise(done => {
              child.once('exit', done)
              setTimeout(done, 5000).unref()
            }),
      ),
    )
  }
  try {
    for (const port of [t.ports.admin, t.ports.site])
      await new Promise((done, reject) => {
        const probe = createServer()
        probe.once('error', () => reject(Error('Golden port is already occupied; no server reuse is allowed.')))
        probe.listen(port, '127.0.0.1', () => probe.close(done))
      })
    for (const [app, port] of [
      ['admin', t.ports.admin],
      ['site', t.ports.site],
    ]) {
      const log = openSync(join(out, app + '.log'), 'w', 0o600)
      const directory = join(root, 'apps', app)
      const command = traceFile
        ? [
            process.execPath,
            [
              '--import',
              join(root, 'scripts/perf/request-trace.mjs'),
              createRequire(join(directory, 'package.json')).resolve('next/dist/bin/next'),
              'start',
              '--hostname',
              '127.0.0.1',
            ],
          ]
        : ['pnpm', ['--filter', app, 'start', '--hostname', '127.0.0.1']]
      const child = spawn(command[0], command[1], {
        cwd: traceFile ? directory : root,
        env: {
          ...env,
          PORT: String(port),
          ...(traceFile ? { CMS_PERF_APP: app, CMS_PERF_TRACE_FILE: traceFile } : {}),
        },
        stdio: ['ignore', log, log],
        detached: true,
      })
      closeSync(log)
      children.push(child)
      let ready = false
      for (let n = 0; n < 60; n++) {
        if (child.exitCode !== null) throw Error('Golden app exited before ready. Inspect private log.')
        try {
          const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
          if (r.ok && (await r.json()).version === 'golden-local') {
            ready = true
            break
          }
        } catch {}
        await pause(1000)
      }
      if (!ready) throw Error('Golden app did not become ready. Inspect private log.')
    }
    return stop
  } catch (error) {
    await stop()
    throw error
  }
}
export async function fixture(t) {
  const db = new Client({ connectionString: t.url })
  await db.connect()
  try {
    await db.query('BEGIN READ ONLY')
    const routes = (
      await db.query(
        "SELECT s.id AS site_id,s.slug,s.staging_hostname,r.path,p.id AS page_id,p.draft_version_id,r.page_version_id FROM published_routes r JOIN sites s ON s.id=r.site_id JOIN pages p ON p.id=r.page_id WHERE s.slug=ANY($1::text[]) AND s.status<>'archived' ORDER BY s.slug,r.path",
        [['sawso', 'echelon-chapters', 'echelon']],
      )
    ).rows
    if (routes.length !== 75) throw Error('Golden fixture must have exactly75 kept published routes.')
    const owner = (
      await db.query(
        "SELECT u.id,u.email FROM app_users u JOIN global_roles g ON g.user_id=u.id WHERE u.status='active' AND g.role='super_admin'",
      )
    ).rows
    if (owner.length !== 1) throw Error('Golden fixture must have exactly one active Super admin.')
    const nonStaging = (
      await db.query(
        `SELECT d.hostname_normalized AS host, r.path
         FROM domains d JOIN published_routes r ON r.site_id=d.site_id
        WHERE d.kind='primary' AND d.status='live' AND d.site_id=ANY($1::uuid[])
        ORDER BY d.hostname_normalized, r.path LIMIT 1`,
        [[...new Set(routes.map(route => route.site_id))]],
      )
    ).rows[0]
    await db.query('COMMIT')
    return { routes, owner: owner[0], nonStaging }
  } finally {
    await db.end()
  }
}
