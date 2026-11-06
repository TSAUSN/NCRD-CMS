import { isIP } from 'node:net'

// Cloud Run's built-in Cloud SQL connector exposes each instance as a Unix
// socket at /cloudsql/PROJECT:REGION:INSTANCE. The connector encrypts and
// authorizes the hop itself, so the socket carries no TLS of its own.
const CLOUD_SQL_SOCKET = /^\/cloudsql\/[a-z][a-z0-9-]{4,28}[a-z0-9]:[a-z]+-[a-z]+\d+:[a-z][a-z0-9-]{0,96}$/
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])

export function isCloudSqlSocket(value) {
  return typeof value === 'string' && CLOUD_SQL_SOCKET.test(value)
}

/** An operator connection must verify TLS, except through the local Cloud SQL
 * Auth Proxy, which listens on loopback and encrypts the hop to Google itself.
 * The proxy exception requires the explicit --via-local-proxy flag. */
export function assertOperatorConnection(config, viaLocalProxy) {
  if (!config.host || !config.database || !config.user || !config.password)
    throw Error('Supply the operator PostgreSQL host, database, user and password.')
  if (config.ssl?.rejectUnauthorized === true) return
  if (viaLocalProxy && LOOPBACK.has(config.host) && !config.ssl) return
  throw Error(
    viaLocalProxy
      ? 'The --via-local-proxy flag allows only a loopback Cloud SQL Auth Proxy without TLS settings.'
      : 'Supply the operator connection with verified database TLS, or use --via-local-proxy with the Cloud SQL Auth Proxy.',
  )
}

/** pg's URL parser decodes credentials, but reads sslrootcert as a literal
 * pathname. URLSearchParams encodes slashes there and breaks CA loading. */
export function postgresConnectionUrl(config, caPath) {
  if (config.socketPath !== undefined) return cloudSqlSocketUrl(config)
  if (
    typeof config.host !== 'string' ||
    !/^[a-zA-Z0-9.:-]+$/.test(config.host) ||
    typeof config.user !== 'string' ||
    typeof config.password !== 'string' ||
    typeof config.database !== 'string' ||
    !/^[a-zA-Z0-9_-]+$/.test(config.database) ||
    !Number.isInteger(Number(config.port ?? 5432)) ||
    Number(config.port ?? 5432) < 1 ||
    Number(config.port ?? 5432) > 65535
  ) {
    throw Error('Supply a valid PostgreSQL connection configuration.')
  }
  if (caPath && !/^\/[a-zA-Z0-9_./-]+$/.test(caPath))
    throw Error('Use an absolute CA path without spaces or URL delimiters.')
  const host = isIP(config.host) === 6 ? `[${config.host}]` : config.host
  const url = new URL(`postgresql://${host}:${config.port ?? 5432}/${config.database}`)
  // URL setters preserve existing %-escapes. Encode a literal percent as well
  // so a valid password containing e.g. "%40" is not changed into "@" by pg.
  url.username = encodeURIComponent(config.user)
  url.password = encodeURIComponent(config.password)
  url.search = `sslmode=verify-full${caPath ? `&sslrootcert=${caPath}` : ''}`
  return url.href
}

/** pg reads a `host` query parameter as the socket directory. The URL keeps
 * `localhost` as its authority only because WHATWG URLs reject credentials
 * without a host; pg connects through the socket, never to localhost. */
function cloudSqlSocketUrl(config) {
  if (!isCloudSqlSocket(config.socketPath))
    throw Error('Use the Cloud SQL socket path /cloudsql/PROJECT:REGION:INSTANCE.')
  if (
    typeof config.user !== 'string' ||
    typeof config.password !== 'string' ||
    typeof config.database !== 'string' ||
    !/^[a-zA-Z0-9_-]+$/.test(config.database)
  ) {
    throw Error('Supply a valid PostgreSQL connection configuration.')
  }
  const url = new URL(`postgresql://localhost/${config.database}`)
  url.username = encodeURIComponent(config.user)
  url.password = encodeURIComponent(config.password)
  url.search = `host=${config.socketPath}`
  return url.href
}

export function runtimeConnection(config, login, password) {
  const { cmsPooler, cloudSqlSocket, ...owner } = config
  if (cloudSqlSocket !== undefined) {
    if (cmsPooler) throw Error('Choose either the Supabase session pooler or a Cloud SQL socket, not both.')
    if (!isCloudSqlSocket(cloudSqlSocket))
      throw Error('Use the Cloud SQL socket path /cloudsql/PROJECT:REGION:INSTANCE.')
    return { database: owner.database, socketPath: cloudSqlSocket, user: login, password }
  }
  if (!cmsPooler) return { ...owner, user: login, password }
  if (
    !/^[a-z0-9]{20}$/.test(cmsPooler.projectRef ?? '') ||
    !/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(cmsPooler.host ?? '') ||
    Number(cmsPooler.port ?? 5432) !== 5432
  )
    throw Error('Supply the exact Supabase shared session-pooler host and project reference.')
  return { ...owner, host: cmsPooler.host, port: 5432, user: `${login}.${cmsPooler.projectRef}`, password }
}
