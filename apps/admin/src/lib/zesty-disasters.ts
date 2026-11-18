// Zesty Instances API access for the Current Disasters tool. Server only: the
// access token never reaches the browser, and nothing here logs it.
//
// A push re-reads the item, refuses when Zesty has a newer version than the
// one the editor opened (assertVersion), writes the field as a new version (PATCH) and then
// publishes that version immediately.
//
// This module can reach exactly one Zesty page. The page, its model and its
// field are constants here rather than settings, so no configuration change can
// point the tool elsewhere. It makes exactly three kinds of request — read the
// item, save the item, publish the item — each built here from those
// constants, checked against the allowed list before it is sent, and never
// following a redirect. The token may grant more inside Zesty; this code never
// uses it for anything else.
import 'server-only'

/** "Current National and International Disaster Efforts" on salvationarmyusa.org. */
export const DISASTERS_ITEM_ZUID = '7-beb69fc0fa-zk6tts'
/** Its content model, "Informational Pages". */
export const DISASTERS_MODEL_ZUID = '6-c2b7f2a9ad-k4frxv'
/** The rich-text field that holds the cards. */
export const DISASTERS_FIELD = 'body'

export type ZestyConfig = { instance: string; token: string }

export type ZestyItem = { version: number; body: string; updatedAt: string | null }

export class ZestyError extends Error {
  readonly kind: 'conflict' | 'request' | 'publish'
  constructor(message: string, kind: 'conflict' | 'request' | 'publish' = 'request') {
    super(message)
    this.kind = kind
  }
}

const ZUID = (prefix: string) => new RegExp(`^${prefix}-[a-z0-9]+-[a-z0-9]+$`)

/** Reads the tool's settings: only which Zesty instance and the token. Returns what is missing instead of throwing. */
export function zestyConfig(
  env: Record<string, string | undefined> = process.env,
): { ok: true; config: ZestyConfig } | { ok: false; missing: string[] } {
  const instance = env['ZESTY_INSTANCE_ZUID']?.trim() ?? ''
  const token = env['ZESTY_API_TOKEN']?.trim() ?? ''
  const missing = [...(ZUID('8').test(instance) ? [] : ['ZESTY_INSTANCE_ZUID']), ...(token ? [] : ['ZESTY_API_TOKEN'])]
  return missing.length ? { ok: false, missing } : { ok: true, config: { instance, token } }
}

type Fetch = typeof fetch

/** The only requests this tool can make. */
export type ZestyOperation = { kind: 'read' } | { kind: 'save'; body: string } | { kind: 'publish'; version: number }

function itemsUrl(config: ZestyConfig) {
  return `https://${config.instance}.api.zesty.io/v1/content/models/${DISASTERS_MODEL_ZUID}/items`
}

/** Builds a request from the pinned page. Nothing a caller passes can change where it goes. */
export function zestyRequest(
  config: ZestyConfig,
  operation: ZestyOperation,
): { url: string; method: string; body?: string } {
  const item = `${itemsUrl(config)}/${DISASTERS_ITEM_ZUID}`
  switch (operation.kind) {
    case 'read':
      return { url: item, method: 'GET' }
    case 'save':
      return { url: item, method: 'PATCH', body: JSON.stringify({ data: { [DISASTERS_FIELD]: operation.body } }) }
    case 'publish':
      return {
        url: `${itemsUrl(config)}/publishings/batch`,
        method: 'POST',
        body: JSON.stringify([
          { ZUID: DISASTERS_ITEM_ZUID, version: operation.version, publishAt: 'now', unpublishAt: 'never' },
        ]),
      }
  }
}

function allowed(config: ZestyConfig, request: { url: string; method: string }): boolean {
  const item = `${itemsUrl(config)}/${DISASTERS_ITEM_ZUID}`
  return (
    ((request.method === 'GET' || request.method === 'PATCH') && request.url === item) ||
    (request.method === 'POST' && request.url === `${itemsUrl(config)}/publishings/batch`)
  )
}

async function call(config: ZestyConfig, fetcher: Fetch, operation: ZestyOperation): Promise<unknown> {
  const request = zestyRequest(config, operation)
  // A second check, so a future edit to zestyRequest cannot quietly widen what the token is used for.
  if (!allowed(config, request)) throw new ZestyError('This tool can only change the Current Disasters page.')
  let response: Response
  try {
    response = await fetcher(request.url, {
      method: request.method,
      ...(request.body ? { body: request.body } : {}),
      cache: 'no-store',
      // Never send the token on to wherever a redirect points.
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/json',
        ...(request.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  } catch {
    throw new ZestyError('Zesty did not respond. Check the connection and try again.')
  }
  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!response.ok) {
    const detail =
      json && typeof json === 'object' && 'error' in json && typeof json.error === 'string' ? json.error : ''
    const reason =
      response.status === 401 || response.status === 403
        ? 'Zesty refused the access token. Ask an administrator to check ZESTY_API_TOKEN and its role.'
        : `Zesty returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : '.'}`
    throw new ZestyError(reason)
  }
  return json
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Reads the latest version of the item, published or not. */
export async function readDisasterItem(config: ZestyConfig, fetcher: Fetch = fetch): Promise<ZestyItem> {
  const json = record(await call(config, fetcher, { kind: 'read' }))
  const data = record(json['data'])
  const meta = record(data['meta'])
  const fields = record(data['data'])
  const version = Number(meta['version'])
  const body = fields[DISASTERS_FIELD]
  if (meta['ZUID'] !== undefined && meta['ZUID'] !== DISASTERS_ITEM_ZUID)
    throw new ZestyError('Zesty returned a different page than Current Disasters, so nothing was loaded.')
  if (!Number.isInteger(version) || typeof body !== 'string')
    throw new ZestyError(`Zesty's reply did not include the ${DISASTERS_FIELD} field and a version number.`)
  const updatedAt = typeof meta['updatedAt'] === 'string' ? meta['updatedAt'] : null
  return { version, body, updatedAt }
}

/** Refuses when Zesty has moved on from the version the editor opened. */
export function assertVersion(current: ZestyItem, expectedVersion: number) {
  if (current.version !== expectedVersion)
    throw new ZestyError(
      `Someone saved this page in Zesty (version ${current.version}) after you opened it (version ${expectedVersion}). ` +
        'Reload to see their changes. Your edits here will be lost, so copy anything you need first.',
      'conflict',
    )
}

/**
 * Writes the field as a new version of `current` and publishes it now. The
 * caller builds `body` from `current`, which it has just read and checked.
 */
export async function pushDisasterBody(
  config: ZestyConfig,
  current: ZestyItem,
  body: string,
  fetcher: Fetch = fetch,
): Promise<{ version: number; previousVersion: number }> {
  if (current.body === body) return { version: current.version, previousVersion: current.version }
  const saved = record(record(await call(config, fetcher, { kind: 'save', body }))['data'])
  const version = Number(saved['version'])
  if (!Number.isInteger(version) || version <= current.version)
    throw new ZestyError('Zesty saved the change but did not report the new version. Check the page in Zesty.')
  try {
    await call(config, fetcher, { kind: 'publish', version })
  } catch (error) {
    throw new ZestyError(
      `Saved as version ${version} in Zesty, but publishing failed: ${(error as Error).message} ` +
        'Publish that version in Zesty, or reload here and push again.',
      'publish',
    )
  }
  return { version, previousVersion: current.version }
}
