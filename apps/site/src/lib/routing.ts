// Public routing (SPEC §6.10, §8). One deployment serves every tenant, and the
// only thing that decides which one is the normalized Host — matched against
// verified domains and staging hostnames through the public_api functions.
//
// There is no default-site branch anywhere in this file. An unknown host has
// nowhere to fall through to.
import { asPublic } from '@cms/platform'
import { normalizeHost, normalizePath } from '@cms/domain'
import type { RenderManifest, SiteShell } from '@cms/renderer'

export type ResolvedRoute = {
  siteId: string
  path: string
  pageId: string
  pageVersionId: string
  manifest: RenderManifest
  shell: SiteShell
  shellRevision: number
  isStaging: boolean
  canonicalHost: string | null
  redirectTo: string | null
  updatedAt: Date
}

/**
 * Forwarded headers are only believed when the deployment says a proxy is in
 * front of us. Blindly trusting X-Forwarded-Host is how one tenant's cache
 * entry ends up serving another's content.
 */
export function resolveRequestHost(headers: Headers): string | null {
  const trustProxy = process.env['TRUST_PROXY_HEADERS'] === 'true'
  const forwarded = trustProxy ? headers.get('x-forwarded-host') : null
  // A comma-separated forwarded chain names the original client host first.
  const candidate = forwarded?.split(',')[0]?.trim() || headers.get('host')
  return normalizeHost(candidate)
}

export async function resolveRoute(host: string, rawPath: string): Promise<ResolvedRoute | null> {
  const path = normalizePath(rawPath)
  const rows = await asPublic(client =>
    client.query<{
      site_id: string
      path: string
      page_id: string
      page_version_id: string
      render_manifest: RenderManifest
      shell_revision: string
      shell_payload: SiteShell
      is_staging: boolean
      canonical_host: string | null
      redirect_to: string | null
      updated_at: Date
    }>('SELECT * FROM public_api.resolve_route($1,$2)', [host, path]),
  )

  const row = rows.rows[0]
  if (!row) return null
  if (
    row.render_manifest.sections.some(section =>
      section.def.slots?.some(slot => slot.constraints?.['siteWidget'] === 'chapter-directory'),
    )
  ) {
    row.shell_payload = {
      ...row.shell_payload,
      chapter_directory: await asPublic(
        async client =>
          (await client.query('SELECT public_api.chapter_directory($1) AS entries', [host])).rows[0]?.entries ?? [],
      ),
    }
  }
  return {
    siteId: row.site_id,
    path: row.path,
    pageId: row.page_id,
    pageVersionId: row.page_version_id,
    manifest: row.render_manifest,
    shell: row.shell_payload,
    shellRevision: Number(row.shell_revision),
    isStaging: row.is_staging,
    canonicalHost: row.canonical_host,
    redirectTo: row.redirect_to,
    updatedAt: row.updated_at,
  }
}

export async function resolveRedirect(host: string, rawPath: string): Promise<string | null> {
  return asPublic(
    async client =>
      (
        await client.query<{ target: string | null }>('SELECT public_api.resolve_redirect($1,$2) AS target', [
          host,
          normalizePath(rawPath),
        ])
      ).rows[0]?.target ?? null,
  )
}

export async function siteRoutes(host: string): Promise<{ pageId: string; path: string; updatedAt: Date }[]> {
  const rows = await asPublic(client =>
    client.query<{ page_id: string; path: string; updated_at: Date }>('SELECT * FROM public_api.site_routes($1)', [
      host,
    ]),
  )
  return rows.rows.map(r => ({ pageId: r.page_id, path: r.path, updatedAt: r.updated_at }))
}

export async function resolveHost(
  host: string,
): Promise<{ siteId: string; isStaging: boolean; redirectTo: string | null } | null> {
  const rows = await asPublic(client =>
    client.query<{ site_id: string; is_staging: boolean; redirect_to: string | null }>(
      'SELECT * FROM public_api.resolve_host($1)',
      [host],
    ),
  )
  const row = rows.rows[0]
  return row ? { siteId: row.site_id, isStaging: row.is_staging, redirectTo: row.redirect_to } : null
}

/**
 * A cache key that includes tenant, path, and the published revision, so a
 * publish makes the old entry unreachable even before invalidation arrives
 * (SPEC §6.8). Also the ETag.
 */
export function cacheKey(route: ResolvedRoute): string {
  return (
    `"${route.siteId}:${route.path}:${route.pageVersionId}:${route.shellRevision}:` +
    `${route.manifest.dependency_revision ?? 'none'}"`
  )
}

/** A neutral 404: no tenant names, no hints about what does exist. */
export function neutralNotFound(): Response {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Page not found</title><meta name="robots" content="noindex,nofollow"></head>' +
      '<body><main><h1>Page not found</h1><p>This address does not point to a page.</p></main></body></html>',
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )
}

/** The clean address for a V1 file-style address: `/index.html` → `/`, `/a/b.html` → `/a/b`.
 * Anything else is not a file-style address and has no target. */
export function htmlAddressTarget(pathname: string): string | null {
  if (!/\.html$/i.test(pathname)) return null
  // The result becomes a Location header. A path starting with two slashes or a
  // backslash would be read as another host, so only same-site paths qualify.
  if (!pathname.startsWith('/') || /^\/[\/\\]/.test(pathname)) return null
  const clean = pathname
    .replace(/(^|\/)index\.html$/i, '$1')
    .replace(/\.html$/i, '')
    .replace(/(.)\/$/, '$1')
  return clean === '' ? '/' : clean
}
