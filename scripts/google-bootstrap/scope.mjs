import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { spawnSync } from 'node:child_process'

export function validateTarget(config, { project, account }) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project ?? '') || project !== config.projectId)
    throw Error('Explicit --project must match the reviewed configuration exactly.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account ?? '') || account !== config.operatorAccount)
    throw Error('Explicit --account must match the reviewed operator exactly.')
  if (!/^\d{6,}$/.test(config.projectNumber ?? '') || !/^[a-z]+-[a-z]+\d$/.test(config.region ?? ''))
    throw Error('Supply the verified project number and region.')
  if (!/^[a-z][a-z0-9-]{0,38}[a-z0-9]$/.test(config.servicePrefix ?? ''))
    throw Error('Supply an explicit service prefix; existing deployments are never inferred.')
  if (
    !/^[a-z][a-z0-9-]{0,60}[a-z0-9]$/.test(config.sqlInstance ?? '') ||
    !/^[a-z][a-z0-9_]{1,50}$/.test(config.database ?? '')
  )
    throw Error('Supply explicit SQL instance and database names.')
  if (!['allUsers', 'disable-invoker-check'].includes(config.publicInvocation))
    throw Error('IT must choose the public invocation mechanism explicitly.')
  if (!/^[a-f0-9]{40}$/.test(config.revision ?? '')) throw Error('Pin the full verified Git commit.')
  if (!['db-f1-micro', 'db-g1-small', 'db-custom-1-3840'].includes(config.sqlTier))
    throw Error('Choose the reviewed bounded SQL tier.')
  if (
    !Number.isInteger(config.proxyPort) ||
    config.proxyPort < 1024 ||
    config.proxyPort > 65535 ||
    [3000, 3001, 54329].includes(config.proxyPort)
  )
    throw Error('Use a dedicated loopback SQL proxy port.')
  if (!/^[a-z][a-z0-9-]{1,11}[a-z0-9]$/.test(config.firebaseSitePrefix ?? ''))
    throw Error('Supply the reviewed Firebase site prefix.')
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.ownerEmail ?? '') ||
    !/^sb_publishable_[a-zA-Z0-9_-]+$/.test(config.authPublishableKey ?? '')
  )
    throw Error('Supply the Friday owner and existing public Auth key, never a secret key.')
  let auth
  try {
    auth = new URL(config.supabaseUrl)
  } catch {
    throw Error('Supply the reviewed HTTPS Supabase origin.')
  }
  if (auth.protocol !== 'https:' || auth.username || auth.password || auth.pathname !== '/' || auth.search || auth.hash)
    throw Error('Supply the reviewed HTTPS Supabase origin.')
  if (
    !Number.isInteger(config.expectedPublicPages) ||
    config.expectedPublicPages < 1 ||
    !/^([a-f0-9]{64})$/.test(config.cleanedDumpSha256 ?? '')
  )
    throw Error('Supply the reviewed route count and cleaned archive SHA-256.')
  for (const key of [
    'privateDirectory',
    'cleanedDump',
    'cleanedFingerprints',
    'mediaDirectory',
    'mediaInventory',
    'publicAssetOracle',
  ])
    if (!isAbsolute(config[key] ?? '')) throw Error('Supply an absolute private input path: ' + key)
  return config
}

/** Scope diagnostics read configuration before passing global flags, because
 * --project/--account can mask a wrong ambient configuration in gcloud output. */
export function assertActiveScope(config, env = process.env) {
  const root = env.CLOUDSDK_CONFIG ?? join(homedir(), '.config/gcloud')
  const active = env.CLOUDSDK_ACTIVE_CONFIG_NAME ?? readFileSync(join(root, 'active_config'), 'utf8').trim()
  if (!/^[a-zA-Z0-9_-]+$/.test(active)) throw Error('Invalid active gcloud configuration name.')
  const ini = readFileSync(join(root, 'configurations', 'config_' + active), 'utf8')
  const core = ini.match(/\[core\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? ''
  const value = name => core.match(new RegExp('^' + name + '\\s*=\\s*(.+)$', 'm'))?.[1].trim()
  if (
    (env.CLOUDSDK_CORE_PROJECT ?? value('project')) !== config.projectId ||
    (env.CLOUDSDK_CORE_ACCOUNT ?? value('account')) !== config.operatorAccount
  )
    throw Error(
      'STOP: active gcloud account/project differs. The administrator must select the reviewed configuration.',
    )
  if (
    env.CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT ||
    env.CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE ||
    /\[auth\][\s\S]*impersonate_service_account\s*=/.test(ini)
  )
    throw Error('Unexpected credential override/impersonation. Review the operator identity first.')
}

export function scopedArgs(config, args) {
  if (
    args.some(arg => /^(--project|--account)(=|$)/.test(arg)) ||
    args.some(arg => ['delete', 'remove', 'dns'].includes(arg))
  )
    throw Error('The bootstrap supplies scope and contains no deletion or DNS commands.')
  return [...args, '--project=' + config.projectId, '--account=' + config.operatorAccount]
}

export function cloud(config, args, { json = false, input } = {}) {
  assertActiveScope(config)
  const result = spawnSync(config.gcloudBinary ?? 'gcloud', scopedArgs(config, args), {
    encoding: 'utf8',
    input,
    maxBuffer: 16 * 1024 * 1024,
  })
  // Failed cloud commands may echo secret payloads or private manifests. Preserve
  // only the command category/status; the administrator can inspect provider logs safely.
  if (result.status !== 0)
    throw Error(`gcloud ${args.slice(0, 3).join(' ')} failed (${result.status ?? 'not started'}). No later step ran.`)
  return json ? JSON.parse(result.stdout || 'null') : result.stdout.trim()
}

export async function google(config, service, path, method = 'GET', body, allowed = []) {
  if (
    !['storage', 'firebase', 'sqladmin', 'monitoring', 'cloudscheduler'].includes(service) ||
    !['GET', 'POST', 'PUT', 'PATCH'].includes(method)
  )
    throw Error('Bootstrap REST scope/method is not allowed; no deletion or DNS API exists here.')
  assertActiveScope(config)
  const token = cloud(config, ['auth', 'print-access-token'])
  const result = await fetch(`https://${service}.googleapis.com/${path}`, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'X-Goog-User-Project': config.projectId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  })
  if (allowed.includes(result.status)) {
    await result.body?.cancel()
    return null
  }
  if (!result.ok)
    throw Error(`${service} ${method} failed with HTTP ${result.status}; response omitted to protect credentials.`)
  return result.status === 204 ? null : result.json()
}
