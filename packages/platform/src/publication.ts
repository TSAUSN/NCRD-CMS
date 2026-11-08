import { siteSocialSectionValues } from '@cms/schema'
import {
  isHeroSlides,
  repeatItemKeys,
  repeatItemSlotId,
  heroSlideContentProblem,
  heroSlideParityProblem,
  sectionAnchorNames,
  SiteFileProjection,
} from '@cms/schema'
import { decodeSourceText } from '@cms/renderer/source-html'
import { sampleFieldNames, boundSampleFieldNames } from '@cms/schema'
import type { PoolClient } from 'pg'

import { DomainError, runReadinessChecks, READINESS_POLICY_VERSION, type ReadinessReport } from '@cms/domain'
import { renderPage, type PageDocument, type RenderManifest, type SiteShell } from '@cms/renderer'

/**
 * Any connection already carrying the right identity. The evaluation reads and
 * computes; it does not need a pool, a transaction of its own, or the ability
 * to release. Typed structurally so the seed's plain `Client` and the apps'
 * pooled clients are the same caller.
 */
export type Queryable = Pick<PoolClient, 'query'>

/**
 * Which door this caller uses to build a render manifest.
 *
 * `member` is the tenant-checked `app.build_render_manifest`, which refuses a
 * version outside the caller's sites. `worker` is the internal one: the worker
 * is not a tenant, it acts across every site, and its authorization comes from
 * holding the lease on a schedule rather than from membership. Naming the two
 * separately keeps that difference visible instead of widening the member
 * function until it lets a non-member through. `published` reads only the exact
 * version already projected through the commands in this transaction; release
 * simulation uses it after all selected dependencies have been applied.
 */
export type ManifestAccess = 'member' | 'worker' | 'published' | 'published-context' | 'review'

const MANIFEST_FUNCTION: Record<Exclude<ManifestAccess, 'published' | 'review'>, string> = {
  member: 'app.build_render_manifest',
  worker: 'app.build_render_manifest_internal',
  // Baseline only: tolerate a private article's missing published Story while
  // resolving every existing list item from the published context, never drafts.
  'published-context': 'app.build_initial_preview_manifest',
}

/** A version that cannot be rendered cannot be judged, and must not go live. */
function unrenderable(message: string): ReadinessReport {
  const finding = { rule: 'empty_page', severity: 'blocking', message } as const
  return {
    policyVersion: READINESS_POLICY_VERSION,
    findings: [finding],
    blocking: [finding],
    advisory: [],
    ok: false,
  }
}

type ShellRow = { payload: SiteShell }
type PublishedPath = { page_id: string; path: string; anchors?: string[] }
type DraftPath = { path: string; anchors: string[] }
type ReadinessFacts = {
  shells: Map<string, ShellRow[]>
  paths: Map<string, PublishedPath[]>
  drafts: Map<string, DraftPath[]>
}

async function siteFacts<T>(
  cache: Map<string, T[]> | undefined,
  siteId: string,
  load: () => Promise<{ rows: T[] }>,
): Promise<T[]> {
  if (!cache) return (await load()).rows
  let rows = cache.get(siteId)
  if (!rows) {
    rows = (await load()).rows
    cache.set(siteId, rows)
  }
  // Each candidate gets its own values; rendering cannot mutate another report.
  return structuredClone(rows)
}

/** Evaluate one locked, unchanged projection. Release callers hold the site
 * lock and perform no writes inside this batch. Facts live only for this call:
 * baseline and rollback-only future projections must always use separate calls.
 * Every immutable version is still rendered and checked independently. */
export async function evaluateVersionsReadiness(
  client: Queryable,
  versions: readonly { versionId: string; access: ManifestAccess }[],
  plannedPaths: readonly string[] = [],
): Promise<ReadinessReport[]> {
  const facts: ReadinessFacts = { shells: new Map(), paths: new Map(), drafts: new Map() }
  const reports: ReadinessReport[] = []
  for (const version of versions)
    reports.push(await evaluateReadiness(client, version.versionId, version.access, plannedPaths, facts))
  return reports
}

/**
 * Evaluate readiness for one immutable page version, on an already-authorized
 * connection. The caller supplies the session (a member's, or the worker's);
 * this does not open one, so it composes with whatever transaction is in flight.
 */
export async function evaluateVersionReadiness(
  client: Queryable,
  versionId: string,
  access: ManifestAccess,
  plannedPaths: readonly string[] = [],
): Promise<ReadinessReport> {
  return evaluateReadiness(client, versionId, access, plannedPaths)
}

const linkRules = {
  document: {
    pattern:
      /<a\b[^>]*\bhref\s*=\s*"\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:[?#][^"]*)?"/gi,
    member: 'app.readiness_document_paths',
    worker: 'app.readiness_document_paths_internal',
  },
  media: {
    pattern:
      /<a\b[^>]*\bhref\s*=\s*"\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/(?:original|thumbnail|card|wide)(?:[?#][^"]*)?"/gi,
    member: 'app.readiness_media_paths',
    worker: 'app.readiness_media_paths_internal',
  },
} as const

/** Only delivery paths authorized for this exact version count as internal links. */
async function linkedAssetPaths(
  client: Queryable,
  versionId: string,
  access: ManifestAccess,
  html: string,
  kind: keyof typeof linkRules,
): Promise<string[]> {
  const rule = linkRules[kind]
  const ids = [...new Set([...html.matchAll(rule.pattern)].map(match => match[1]!.toLowerCase()))]
  if (!ids.length) return []
  const functionName = access === 'worker' ? rule.worker : rule.member
  const { rows } = await client.query<{ path: string }>(`SELECT path FROM ${functionName}($1,$2::uuid[])`, [
    versionId,
    ids,
  ])
  return rows.map(row => row.path)
}

async function evaluateReadiness(
  client: Queryable,
  versionId: string,
  access: ManifestAccess,
  plannedPaths: readonly string[],
  facts?: ReadinessFacts,
): Promise<ReadinessReport> {
  // The title and site come from the saved version, not from the caller, so the
  // editor and the scheduler cannot disagree about what they are checking.
  const owner = await client.query<{ site_id: string; title: string }>(
    `SELECT p.site_id, pv.page_title AS title
       FROM page_versions pv JOIN pages p ON p.id = pv.page_id
      WHERE pv.id = $1`,
    [versionId],
  )
  const page = owner.rows[0]
  if (!page) {
    // A missing version is a permanent command failure, separate from content readiness.
    throw new DomainError('not_found', `page version ${versionId} no longer exists`)
  }

  // A release's rollback-only trial has already built the authoritative route
  // through the publication commands. Judge that exact projection after its
  // dependencies and frame are in place, without rebuilding it a second time.
  // The route is RLS-scoped and must name this immutable version. Drafts never
  // fall back to a different live version; ordinary edit/worker checks rebuild.
  const manifestRow = await client.query<{ manifest: RenderManifest | null }>(
    access === 'published'
      ? 'SELECT render_manifest AS manifest FROM published_routes WHERE page_version_id=$1'
      : access === 'review'
        ? 'SELECT COALESCE(app.story_review_manifest($1),app.build_render_manifest($1)) AS manifest'
        : `SELECT ${MANIFEST_FUNCTION[access]}($1) AS manifest`,
    [versionId],
  )
  const manifest = manifestRow.rows[0]?.manifest
  if (!manifest) return unrenderable('This page could not be rendered.')
  const samplePictures = manifest.sections.some(section =>
    JSON.stringify(section.instance.values ?? {}).includes('/cms-samples/'),
  )
  if (
    samplePictures &&
    (await client.query('SELECT chapters_enabled FROM sites WHERE id=$1', [page.site_id])).rows[0]?.chapters_enabled
  )
    return unrenderable(
      'Choose Echelon photos from Media before publishing. Generic sample pictures cannot be published.',
    )
  const needsLegacyIntro = manifest.sections.some(section =>
    (section.def.slots ?? []).some(
      slot =>
        isHeroSlides(slot) &&
        slot.constraints?.heroEditingParity === true &&
        repeatItemKeys(section.instance.values?.[slot.id], 48).some(
          key => String(section.instance.values?.[repeatItemSlotId(slot.id, key, 'intro')] ?? '').length > 200,
        ),
    ),
  )
  const legacyRows = needsLegacyIntro
    ? (
        await client.query<{ content: RenderManifest['sections'][number]['instance'][] }>(
          'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.published_version_id WHERE p.id=$1',
          [manifest.page.id],
        )
      ).rows
    : []
  // This is a new opt-in component. Older immutable numbered heroes keep their
  // existing policy; all normal page, release and scheduler checks share this one.
  for (const section of manifest.sections) {
    if (section.instance.hidden) continue
    for (const slot of section.def.slots ?? []) {
      if (!isHeroSlides(slot)) continue
      const values = section.instance.values ?? {}
      if (
        slot.constraints?.heroEditingParity === true &&
        values.auto_change !== 'off' &&
        values.seconds !== undefined &&
        (!Number.isInteger(Number(values.seconds)) || Number(values.seconds) < 2 || Number(values.seconds) > 30)
      )
        return unrenderable('Choose between 2 and 30 seconds per slide.')
      for (const [at, key] of repeatItemKeys(values[slot.id], 48).entries()) {
        if (values[repeatItemSlotId(slot.id, key, 'enabled')] === 'off') continue
        const problem =
          heroSlideContentProblem(values, slot.id, key) ||
          (slot.constraints?.heroEditingParity === true
            ? heroSlideParityProblem(
                values,
                slot.id,
                key,
                legacyRows[0]?.content.filter(candidate => candidate.section_def_id === section.def.section_def_id)
                  .length === 1
                  ? legacyRows[0]?.content.find(candidate => candidate.section_def_id === section.def.section_def_id)
                      ?.values?.[repeatItemSlotId(slot.id, key, 'intro')]
                  : undefined,
              )
            : null)
        if (problem) return unrenderable(`Hero slide ${at + 1}: ${problem} You can keep editing or remove the slide.`)
      }
    }
  }

  const shellRows = await siteFacts(facts?.shells, page.site_id, () =>
    client.query<ShellRow>('SELECT payload FROM published_site_shells WHERE site_id = $1', [page.site_id]),
  )
  const shell: SiteShell = shellRows[0]?.payload ?? {
    site: { id: page.site_id, name: '', slug: '' },
    theme: {},
    navigation: [],
    canonical_host: null,
    staging_host: null,
  }

  // Judge the same derived site accounts that the shared renderer displays.
  // Manual chapter links and old immutable section definitions stay untouched.
  for (const section of manifest.sections)
    section.instance = {
      ...section.instance,
      values: siteSocialSectionValues(
        section.instance.values ?? {},
        section.def.slots ?? [],
        section.def.slug,
        shell.settings,
      ),
    }
  const paths = await siteFacts(facts?.paths, page.site_id, () =>
    client.query<PublishedPath>(
      `SELECT page_id,path,ARRAY(SELECT name FROM jsonb_array_elements(COALESCE(render_manifest->'sections','[]'::jsonb)) AS part CROSS JOIN LATERAL jsonb_array_elements_text(jsonb_build_array(part#>>'{instance,values,__cms_anchor}')||COALESCE(part#>'{instance,values,__cms_anchor_aliases}','[]'::jsonb)) AS names(name) WHERE name IS NOT NULL AND COALESCE((part#>>'{instance,hidden}')::boolean,false)=false) AS anchors FROM published_routes WHERE site_id = $1`,
      [page.site_id],
    ),
  )
  // Include the immutable candidate itself. A preview or first publication is
  // allowed to link to its own page id before published_routes contains it.
  const navigationPaths = Object.fromEntries([
    ...paths.map(route => [route.page_id, route.path] as const),
    [manifest.page.id, manifest.page.path] as const,
  ])

  // Use the staging origin only when there is no verified canonical host.
  // An immutable rendering failure blocks publication; it is not a retryable outage.
  let document: PageDocument
  try {
    document = renderPage({
      manifest,
      shell,
      isStaging: true,
      navigationPaths,
      options: shell.staging_host ? { canonicalBase: `https://${shell.staging_host}` } : {},
    })
  } catch (error) {
    return unrenderable(`This page could not be rendered: ${(error as Error).message}`)
  }

  const documentPaths = await linkedAssetPaths(client, versionId, access, document.html, 'document')
  const mediaPaths = await linkedAssetPaths(client, versionId, access, document.html, 'media')

  const knownAnchors = new Map(paths.map(route => [route.path, new Set(route.anchors ?? [])]))
  const ownAnchors = manifest.sections.flatMap(section =>
    section.instance.hidden ? [] : sectionAnchorNames(section.instance.values),
  )
  knownAnchors.set(manifest.page.path, new Set(ownAnchors))
  const sectionLinks = manifest.sections.flatMap(section =>
    section.instance.hidden
      ? []
      : (section.def.slots ?? []).flatMap(slot =>
          !isHeroSlides(slot) || slot.constraints?.heroEditingParity !== true
            ? []
            : repeatItemKeys(section.instance.values?.[slot.id], 48).flatMap(key => {
                const values = section.instance.values ?? {}
                if (values[repeatItemSlotId(slot.id, key, 'enabled')] === 'off') return []
                return ['primary', 'secondary'].flatMap(name => {
                  const value = values[repeatItemSlotId(slot.id, key, name)] as { url?: unknown } | null
                  return values[repeatItemSlotId(slot.id, key, name + '_visible')] !== 'off' &&
                    typeof value?.url === 'string'
                    ? [value.url]
                    : []
                })
              }),
        ),
  )
  let draftAnchors: Map<string, Set<string>> | undefined
  const original = SiteFileProjection.safeParse(shell.site_files)
  if (!(original.success && original.data.bundle.original) && document.html.includes('#')) {
    const declared = new Map<string, Set<string>>([...knownAnchors].map(([path, names]) => [path, new Set(names)]))
    const drafts = await siteFacts(facts?.drafts, page.site_id, () =>
      client.query<DraftPath>(
        `SELECT '/'||COALESCE(p.slug,'') AS path,ARRAY(SELECT name FROM jsonb_array_elements(v.content) part CROSS JOIN LATERAL jsonb_array_elements_text(jsonb_build_array(part#>>'{values,__cms_anchor}')||COALESCE(part#>'{values,__cms_anchor_aliases}','[]'::jsonb)) names(name) WHERE name IS NOT NULL) AS anchors FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.archived_at IS NULL`,
        [page.site_id],
      ),
    )
    for (const row of drafts) {
      const names = declared.get(row.path) ?? new Set<string>()
      for (const name of row.anchors ?? []) names.add(name)
      declared.set(row.path, names)
    }
    draftAnchors = declared
    const hosts = [shell.canonical_host, shell.staging_host]
      .filter((host): host is string => Boolean(host))
      .map(host => {
        try {
          return new URL('https://' + host).hostname
        } catch {
          return host
        }
      })
    const internal = (href: string) => {
      try {
        const url = new URL(href, 'https://cms.invalid' + manifest.page.path)
        if (url.hostname !== 'cms.invalid' && !hosts.includes(url.hostname)) return null
        if (!['http:', 'https:'].includes(url.protocol)) return null
        return {
          path: url.pathname.replace(/(.)\/$/, '$1') || '/',
          name: decodeURIComponent(url.hash.slice(1)),
          href: url.pathname + url.search + url.hash,
        }
      } catch {
        return null
      }
    }
    // Existing hand-authored fragments remain compatible. Declared section links
    // also refuse publishing a renamed referring draft before its target.
    for (const match of document.html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      const link = internal(decodeSourceText(match[1] ?? match[2] ?? ''))
      if (link?.name && declared.get(link.path)?.has(link.name)) sectionLinks.push(link.href)
    }
    for (let index = 0; index < sectionLinks.length; index++) {
      const link = internal(sectionLinks[index]!)
      if (link) sectionLinks[index] = link.href
    }
  }
  return runReadinessChecks({
    knownAnchors,
    sectionLinks,
    ...(draftAnchors ? { draftAnchors } : {}),
    sampleContent: manifest.sections.flatMap((section, index) =>
      section.instance.hidden
        ? []
        : [
            {
              section: section.instance.label || `Section ${index + 1}`,
              fields: [
                ...boundSampleFieldNames(section.instance.values ?? {}, section.def.slots ?? []),
                ...sampleFieldNames(section.instance.values ?? {}).filter(field => {
                  const bound = section.instance.values?.[field] as { kind?: string; entries?: unknown[] } | undefined
                  return !(bound?.kind === 'collection' && bound.entries?.length)
                }),
              ],
            },
          ],
    ),
    title: manifest.meta.title?.trim() || page.title,
    metaDescription: manifest.meta.description,
    html: document.html,
    sectionCount: manifest.sections.length,
    // The candidate can link to itself before its route is live.
    knownPaths: new Set([
      ...paths.map(r => r.path),
      ...plannedPaths,
      ...documentPaths,
      ...mediaPaths,
      manifest.page.path,
    ]),
    // Rendered HTML omits a refused canonical value; preserve the renderer's decision.
    canonicalRefusal: document.canonical.refusal,
  })
}
