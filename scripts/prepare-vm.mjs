// Prepare a private single-server deployment. No provider call or secret value
// is read here; the operator supplies separate runtime environment files.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const hostname = value =>
  typeof value === 'string' &&
  value.length <= 253 &&
  value.split('.').length >= 2 &&
  value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)

export function vmFiles(config) {
  if (
    !hostname(config.adminHost) ||
    !hostname(config.stagingBaseDomain) ||
    config.adminHost === config.stagingBaseDomain ||
    config.adminHost.endsWith(`.${config.stagingBaseDomain}`)
  ) {
    throw Error('Supply distinct independent admin and staging hostnames.')
  }
  if (!digest(config.imageId)) throw Error('Supply the loaded application image ID (sha256 digest).')
  if (!/^docker\.io\/library\/caddy@sha256:[a-f0-9]{64}$/.test(config.caddyImage ?? ''))
    throw Error('Pin the official Caddy image by digest.')
  if (
    !/^[a-zA-Z0-9._%+-]+@/.test(config.certificateEmail ?? '') ||
    !hostname(config.certificateEmail?.split('@')[1]) ||
    config.certificateEmail.split('@').length !== 2
  )
    throw Error('Supply the certificate contact email.')
  const common = {
    APP_VERSION: config.imageId,
    NODE_ENV: 'production',
    MEDIA_PROVIDER: 'filesystem',
    MEDIA_ROOT: '/data/media',
    SCHEDULING_ENABLED: 'false',
    SCHEDULING_MONITORING_READY: 'false',
  }
  const cacheRevision = config.imageId.slice(7, 19)
  const healthcheck = (port, path = '/health') => ({
    test: [
      'CMD',
      'node',
      '-e',
      `fetch('http://127.0.0.1:${port}${path}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
    ],
    interval: '30s',
    timeout: '10s',
    retries: 3,
    start_period: '30s',
  })
  const app = (role, env, memory, heap) => ({
    image: config.imageId,
    pull_policy: 'never',
    command: [role],
    restart: 'unless-stopped',
    init: true,
    user: '1000:1000',
    read_only: true,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    pids_limit: 192,
    mem_limit: memory,
    env_file: [`/etc/cms-v2/${role}.env`],
    volumes: [
      '/etc/cms-v2/database-ca.crt:/etc/cms-v2/database-ca.crt:ro',
      `media:/data/media${role === 'site' ? ':ro' : ''}`,
      ...(['admin', 'site'].includes(role) ? [`${role}-cache:/app/apps/${role}/.next/cache`] : []),
    ],
    environment: { ...common, ...env, NODE_OPTIONS: `--max-old-space-size=${heap}` },
    tmpfs: ['/tmp:rw,nosuid,nodev,size=67108864,mode=1777'],
    logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } },
  })
  const admin = app(
    'admin',
    {
      AUTH_PROVIDER: 'supabase',
      ADMIN_ORIGIN: `https://${config.adminHost}`,
      STAGING_BASE_DOMAIN: config.stagingBaseDomain,
      TRUST_PROXY_HEADERS: 'true',
    },
    '384m',
    192,
  )
  const site = app('site', { TRUST_PROXY_HEADERS: 'true' }, '256m', 128)
  const worker = app(
    'worker',
    {
      ADMIN_ORIGIN: `https://${config.adminHost}`,
      DOMAIN_PROVIDER: 'origin',
      MAILER_PROVIDER: 'resend',
      MONITORING_PROVIDER: 'stdout',
      WORKER_HEALTH_PORT: '3002',
      WORKER_BATCH_SIZE: '5',
    },
    '448m',
    128,
  )
  admin.healthcheck = healthcheck(3000)
  site.healthcheck = healthcheck(3001)
  worker.healthcheck = healthcheck(3002, '/ready')
  worker.ports = ['127.0.0.1:3002:3002']
  const compose = {
    name: 'cms-v2-staging',
    services: {
      admin,
      site,
      worker,
      edge: {
        image: config.caddyImage,
        restart: 'unless-stopped',
        read_only: true,
        cap_drop: ['ALL'],
        cap_add: ['NET_BIND_SERVICE'],
        security_opt: ['no-new-privileges:true'],
        mem_limit: '64m',
        pids_limit: 64,
        ports: ['80:80', '443:443', '443:443/udp'],
        volumes: ['./Caddyfile:/etc/caddy/Caddyfile:ro', 'caddy-data:/data', 'caddy-config:/config'],
        depends_on: { admin: { condition: 'service_healthy' }, site: { condition: 'service_healthy' } },
        logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } },
      },
    },
    volumes: {
      media: {},
      'caddy-data': {},
      'caddy-config': {},
      'admin-cache': { name: `cms-v2-staging-admin-cache-${cacheRevision}` },
      'site-cache': { name: `cms-v2-staging-site-cache-${cacheRevision}` },
    },
  }
  const caddy = `{
  email ${config.certificateEmail}
  admin off
  on_demand_tls {
    ask http://site:3001/internal/tls
  }
}

${config.adminHost} {
  @internal path /internal /internal/*
  respond @internal 404
  reverse_proxy admin:3000 {
    header_up X-Forwarded-Host {http.request.host}
    header_up X-Forwarded-Proto https
  }
}

:443 {
  tls {
    on_demand
  }
  @internal path /internal /internal/*
  respond @internal 404
  reverse_proxy site:3001 {
    header_up X-Forwarded-Host {http.request.host}
    header_up X-Forwarded-Proto https
  }
}
`
  return { 'compose.yaml': JSON.stringify(compose, null, 2) + '\n', Caddyfile: caddy }
}

export function prepareVm(configPath, destination) {
  const files = vmFiles(JSON.parse(readFileSync(configPath, 'utf8')))
  const directory = resolve(destination)
  mkdirSync(directory, { mode: 0o700, recursive: false })
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(directory, name), content, { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ status: 'prepared-locally', directory, deployed: false, files: Object.keys(files) }))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [configPath, destination] = process.argv.slice(2)
  if (!configPath || !destination) throw Error('Usage: node scripts/prepare-vm.mjs CONFIG_JSON NEW_PRIVATE_DIRECTORY')
  prepareVm(configPath, destination)
}
