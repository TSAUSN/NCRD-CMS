import { sourceSectionLabel } from './section-labels.ts'
import { compileSection, compileStructuredSection, sectionScopeSelector } from '@cms/renderer'
import { STRUCTURED_SCHEMA_VERSION } from '@cms/schema'
import { canonical, digest } from './backup.ts'
import type { ImportClient } from './database.ts'
import type { MigrationBundle } from './migration.ts'
import { parseHtml } from './html.ts'
import { serializeLegacy } from './legacy-values.ts'
import { sourceShell } from './source-shell.ts'
import { editableReference } from './editable-reference.ts'
import { remapReferenceUrls } from './media-transfer.ts'
import { withSourceSamples } from './source-samples.ts'

export type WorkingDraftPlan = {
  format: 'cms-v1-working-drafts'
  version: 1
  runId: string
  sourceManifest: string
  pages: {
    sourceKey: string
    recordId: string
    siteId: string
    pageId: string
    sourceState: string
    expectedRevision: string
    draftVersionId: string
    sourceVersionId: string
    title: string
    slug: string
    issues: string[]
  }[]
  sites: ({
    siteId: string
    expectedRevision: string
    headerRevision: string
    footerRevision: string
    navigationRevision: string
  } & ReturnType<typeof sourceShell>)[]
}

const readShell = async (client: ImportClient, siteId: string) =>
  (
    await client.query(
      `SELECT s.revision::text AS revision,
  h.revision::text AS header_revision,f.revision::text AS footer_revision,n.revision::text AS navigation_revision FROM sites s
  JOIN global_elements h ON h.site_id=s.id AND h.kind='header' JOIN global_elements f ON f.site_id=s.id AND f.kind='footer'
  JOIN navigations n ON n.site_id=s.id WHERE s.id=$1`,
      [siteId],
    )
  ).rows[0]

const siteMedia = async (client: ImportClient, runId: string, siteId: string) =>
  new Map<string, string>(
    (
      await client.query('SELECT source_path,media_id FROM v1_import_media WHERE run_id=$1 AND site_id=$2', [
        runId,
        siteId,
      ])
    ).rows.map(row => [`/${row.source_path.split('/public/')[1]}`, String(row.media_id)]),
  )

const readTargets = async (client: ImportClient, runId: string) =>
  (
    await client.query(
      `SELECT r.id AS record_id,r.source_key,r.source_site,
  t.site_id,t.page_id,t.version_id AS source_version_id,p.revision::text,p.slug,p.title,p.draft_version_id,p.published_version_id,
  p.archived_at,v.content,v.meta FROM v1_import_targets t JOIN v1_import_records r ON r.run_id=t.run_id AND r.source_key=t.source_key
  JOIN pages p ON p.id=t.page_id JOIN page_versions v ON v.id=p.draft_version_id WHERE t.run_id=$1 ORDER BY r.source_key`,
      [runId],
    )
  ).rows

/** Select one authored state per address. Published source wins over its draft;
 * unpublished event content remains available. Empty test pages stay in the
 * preserved reference set instead of becoming visitors' navigation entries. */
export async function planWorkingDrafts(client: ImportClient, runId: string): Promise<WorkingDraftPlan> {
  const run = (await client.query('SELECT bundle FROM v1_import_runs WHERE id=$1', [runId])).rows[0]
  if (!run) throw new Error('V1 import run is unavailable to this operator')
  const bundle = run.bundle as MigrationBundle
  const targets = await readTargets(client, runId)
  const selected = new Map<string, MigrationBundle['references'][number]>()
  for (const reference of bundle.references) {
    if (!reference.sections.length) continue
    const key = `${reference.sourceSite}/${reference.sourcePage}`
    if (!selected.has(key) || reference.sourceState === 'published') selected.set(key, reference)
  }
  const pages = [...selected.values()]
    .map(reference => {
      const sourceKey = `backup/${reference.key}`
      const target = targets.find(target => target.source_key === sourceKey)
      if (!target) throw new Error('a selected source page has no imported reference')
      const record = bundle.records.find(record => record.key === sourceKey)
      const payload = record?.payload
      const authoredTitle =
        payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.title === 'string'
          ? payload.title
          : ''
      const slug = reference.sourcePage === 'home' ? '' : reference.sourcePage
      if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
        throw new Error('source page address needs an explicit mapping')
      return {
        sourceKey,
        recordId: String(target.record_id),
        siteId: String(target.site_id),
        pageId: String(target.page_id),
        sourceState: reference.sourceState,
        expectedRevision: String(target.revision),
        draftVersionId: String(target.draft_version_id),
        sourceVersionId: String(target.source_version_id),
        slug,
        title:
          authoredTitle.trim().slice(0, 200) ||
          (slug
            ? slug.replace(/-/g, ' ').replace(/^./, value => value.toUpperCase())
            : reference.sourceSite === 'humanneedsindex'
              ? 'Human Needs Index'
              : 'Echelon Symposium'),
        issues: reference.issues,
      }
    })
    .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey, 'en'))
  const sites: WorkingDraftPlan['sites'] = []
  for (const siteId of new Set(pages.map(page => page.siteId))) {
    const sourceSite = String(targets.find(target => target.site_id === siteId)!.source_site)
    // Minimal synthetic import packages need not contain native site files.
    if (!bundle.records.some(record => record.kind === 'site-source' && record.sourceSite === sourceSite)) continue
    const head = await readShell(client, siteId)
    if (!head) throw new Error('imported site frame is unavailable')
    const shell = sourceShell(
      bundle,
      sourceSite,
      pages.filter(page => page.siteId === siteId),
      await siteMedia(client, runId, siteId),
    )
    sites.push({
      siteId,
      expectedRevision: head.revision,
      headerRevision: head.header_revision,
      footerRevision: head.footer_revision,
      navigationRevision: head.navigation_revision,
      ...shell,
    })
  }
  return { format: 'cms-v1-working-drafts', version: 1, runId, sourceManifest: bundle.manifestSha256, pages, sites }
}

export function workingPlanHash(plan: WorkingDraftPlan): string {
  return digest(canonical(plan))
}

export function rewriteWorkingUrl(value: string, routes: Map<string, string>): string {
  const match = /^([^?#]+)(.*)$/.exec(value)
  return match && routes.has(match[1]!) ? routes.get(match[1]!)! + match[2]! : value
}

/** Only URL-bearing properties and actual HTML hrefs are rewritten. A sentence
 * mentioning a source address is authored content, never a route reference. */
export function rewriteWorkingValues(value: unknown, routes: Map<string, string>, key = ''): unknown {
  if (Array.isArray(value)) return value.map(child => rewriteWorkingValues(child, routes))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, child]) => [name, rewriteWorkingValues(child, routes, name)]),
    )
  if (typeof value !== 'string') return value
  if (['url', 'href'].includes(key)) return rewriteWorkingUrl(value, routes)
  return /<a\b/i.test(value) ? rewriteWorkingHtml(value, routes) : value
}

export function rewriteWorkingHtml(html: string, routes: Map<string, string>): string {
  const parsed = parseHtml(html)
  if (!parsed.ok) throw new Error('working draft contains unparseable source markup')
  let changed = false
  const walk = (nodes: typeof parsed.nodes) => {
    for (const node of nodes) {
      if (node.kind === 'text') continue
      for (const attr of node.attributes)
        if (attr.name === 'href') {
          const rewritten = rewriteWorkingUrl(attr.value, routes)
          if (rewritten !== attr.value) {
            attr.value = rewritten
            changed = true
          }
        }
      walk(node.children)
    }
  }
  walk(parsed.nodes)
  return changed ? serializeLegacy(parsed.nodes) : html
}

/** Caller owns a transaction and operator identity. This command deliberately
 * does not record a mapped review or move any publication pointer. The same
 * original page remains attached to its exact-version migration publish gate. */
export async function applyWorkingDrafts(client: ImportClient, plan: WorkingDraftPlan) {
  if (
    plan?.format !== 'cms-v1-working-drafts' ||
    plan.version !== 1 ||
    !Array.isArray(plan.pages) ||
    !plan.pages.length ||
    !Array.isArray(plan.sites)
  )
    throw new Error('invalid V1 working-draft plan')
  const hash = workingPlanHash(plan)
  const note = `V1 working draft ${hash}`
  const run = (await client.query('SELECT bundle FROM v1_import_runs WHERE id=$1', [plan.runId])).rows[0]
  if (!run || run.bundle.manifestSha256 !== plan.sourceManifest)
    throw new Error('working-draft source manifest changed or is unavailable')
  const targets = await readTargets(client, plan.runId)
  if (new Set(plan.pages.map(page => page.pageId)).size !== plan.pages.length)
    throw new Error('working-draft plan repeats a page')
  const receipts = (
    await client.query(
      'SELECT page_id,id AS version_id,revision::text FROM page_versions WHERE note=$1 ORDER BY page_id',
      [note],
    )
  ).rows
  if (receipts.length) {
    if (
      receipts.length !== plan.pages.length ||
      receipts.some(receipt => !plan.pages.some(page => page.pageId === receipt.page_id))
    )
      throw new Error('working-draft receipt does not match this plan')
    return { planHash: hash, replay: true, pages: receipts }
  }
  // Validate the entire plan before the first mutation, then page commands use
  // CAS again so a concurrent editor can never be overwritten.
  const addresses = new Set<string>()
  for (const site of plan.sites) {
    const head = await readShell(client, site.siteId)
    if (
      !plan.pages.some(page => page.siteId === site.siteId) ||
      !head ||
      head.revision !== site.expectedRevision ||
      head.header_revision !== site.headerRevision ||
      head.footer_revision !== site.footerRevision ||
      head.navigation_revision !== site.navigationRevision
    )
      throw new Error('working site frame changed; prepare a new plan')
  }
  for (const page of plan.pages) {
    const target = targets.find(target => target.source_key === page.sourceKey)
    if (
      !target ||
      target.page_id !== page.pageId ||
      target.record_id !== page.recordId ||
      target.site_id !== page.siteId ||
      target.source_version_id !== page.sourceVersionId ||
      target.revision !== page.expectedRevision ||
      target.draft_version_id !== page.draftVersionId
    )
      throw new Error('working-draft plan is stale; prepare a new plan before applying')
    if (target.published_version_id || target.archived_at)
      throw new Error('working drafts require an unpublished, active reference page')
    if (
      typeof page.title !== 'string' ||
      !page.title.trim() ||
      page.title.length > 200 ||
      typeof page.slug !== 'string' ||
      page.slug.length > 160 ||
      (page.slug !== '' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.slug))
    )
      throw new Error('invalid working page name or address')
    const address = `${page.siteId}/${page.slug}`
    if (addresses.has(address)) throw new Error('working-draft plan repeats an address')
    addresses.add(address)
    const occupied = (
      await client.query('SELECT id FROM pages WHERE site_id=$1 AND slug=$2 AND id<>$3', [
        page.siteId,
        page.slug,
        page.pageId,
      ])
    ).rows
    if (occupied.length) throw new Error('working page address is already occupied')
  }
  const result = []
  const shells = []
  for (const site of plan.sites) {
    const revision = (
      await client.query('SELECT app.update_site_name($1,$2,$3) AS revision', [
        site.siteId,
        site.expectedRevision,
        site.name,
      ])
    ).rows[0]!.revision
    const global = (
      await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
        site.siteId,
        site.headerRevision,
        site.footerRevision,
        JSON.stringify(site.header),
        JSON.stringify(site.footer),
      ])
    ).rows[0]!
    const navigation = (
      await client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
        site.siteId,
        site.navigationRevision,
        JSON.stringify(site.navigation),
        'manual',
      ])
    ).rows[0]!
    shells.push({ site_id: site.siteId, revision, ...global, navigation_version_id: navigation.version_id })
  }
  for (const page of plan.pages) {
    const target = targets.find(target => target.page_id === page.pageId)!
    const routes = new Map<string, string>()
    for (const destination of plan.pages.filter(other => other.siteId === page.siteId)) {
      const sourceRef = (run.bundle as MigrationBundle).references.find(
        reference => `backup/${reference.key}` === destination.sourceKey,
      )!
      const url = destination.slug ? `/${destination.slug}` : '/'
      for (const reference of (run.bundle as MigrationBundle).references.filter(
        reference => reference.sourceSite === sourceRef.sourceSite && reference.sourcePage === sourceRef.sourcePage,
      ))
        routes.set(`/source-${reference.sourceState}-${digest(reference.key).slice(0, 12)}`, url)
      routes.set(`/${sourceRef.sourcePage === 'home' ? 'index' : sourceRef.sourcePage}.html`, url)
    }
    const original = (await client.query('SELECT content FROM page_versions WHERE id=$1', [page.sourceVersionId]))
      .rows[0]!
    const sourceNotice = original.content[0]
    const sections = structuredClone(target.content) as Record<string, any>[]
    // Identity plus label prevent accidentally deleting an authored heading.
    if (sourceNotice?.label !== 'Migration review notice')
      throw new Error('original migration notice could not be identified')
    const first = sections[0]
    if (
      first &&
      first.section_def_id === sourceNotice.section_def_id &&
      first.section_def_version === sourceNotice.section_def_version
    )
      sections.shift()
    else if (sections.some(section => section.section_def_id === sourceNotice.section_def_id))
      throw new Error('migration notice was moved or edited; resolve it before preparation')
    if (!sections.length) throw new Error('working draft would contain no authored sections')
    for (const [index, section] of sections.entries()) {
      const definition = (
        await client.query(
          'SELECT v.*,d.name FROM section_def_versions v JOIN section_defs d ON d.id=v.section_def_id WHERE v.section_def_id=$1 AND v.version=$2',
          [section.section_def_id, section.section_def_version],
        )
      ).rows[0]!
      // Older reference imports used generic names (“V1 section 3”, “Section
      // 3”). Preserve any label already changed by an editor, while recovering
      // the original catalogue or landmark names.
      const originalNumber = /^(?:V1 s|S)ection (\d+)$/.exec(section.label ?? '')
      if (!section.label || originalNumber)
        section.label = sourceSectionLabel(
          run.bundle as MigrationBundle,
          page.sourceKey,
          originalNumber ? Number(originalNumber[1]) - 1 : index,
          definition.source_html,
        )
      const html = rewriteWorkingHtml(definition.source_html, routes)
      const doc = definition.structured_doc ? rewriteWorkingValues(definition.structured_doc, routes) : null
      const slug = `v1-work-${hash.slice(0, 12)}-${digest(`${page.siteId}/${section.section_def_id}/${section.section_def_version}`).slice(0, 24)}`
      // The working content is the starting content a library insertion and card show.
      const slots = withSourceSamples(definition.slots, section.values ?? {})
      let compiled = compileSection({
        sourceHtml: html,
        sourceCss: definition.source_css,
        slots,
        scopeSelector: sectionScopeSelector(slug)!,
      })
      if (doc) {
        const structured = compileStructuredSection({ slug, document: doc, sourceCss: definition.source_css })
        if (structured.blocking.length) throw new Error('working structured definition failed compilation')
        compiled = { ...compiled, css: structured.css, renderHash: structured.renderHash }
      }
      if (compiled.blocking.length) throw new Error('working definition failed compilation')
      const saved = (
        await client.query(
          'SELECT section_def_id,version FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
          [
            slug,
            section.label || definition.name,
            'Migrated V1 content',
            html,
            definition.source_css,
            compiled.css,
            JSON.stringify(compiled.ast),
            JSON.stringify(slots),
            compiled.renderHash,
            compiled.ast.policyVersion,
            compiled.ast.cssPolicyVersion,
            `Working content from immutable V1 source; plan ${hash}.`,
            compiled.carriesTrustedCode,
            doc ? 'structured' : 'legacy',
            doc ? JSON.stringify(doc) : null,
            doc ? STRUCTURED_SCHEMA_VERSION : null,
            'site',
            page.siteId,
          ],
        )
      ).rows[0]!
      section.section_def_id = saved.section_def_id
      section.section_def_version = saved.version
      section.values = rewriteWorkingValues(section.values, routes)
    }
    const shell = plan.sites.find(site => site.siteId === page.siteId)
    if (shell?.supplemental.length) {
      const media = await siteMedia(client, plan.runId, page.siteId)
      const assets = new Map([...media].map(([url, mediaId]) => [url, { mediaId, url: `/media/${mediaId}/original` }]))
      for (const [index, supplement] of shell.supplemental.entries()) {
        const slug = `v1-frame-${hash.slice(0, 12)}-${digest(`${page.siteId}/${index}`).slice(0, 24)}`
        const mapped = remapReferenceUrls(supplement.html, supplement.css, assets, routes)
        if (mapped.unresolved.length) throw new Error('source frame supplemental assets require transfer')
        const editable = editableReference({ slug, html: mapped.html, css: mapped.css })
        const compiled = editable.compiled
        const saved = (
          await client.query(
            'SELECT section_def_id,version FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
            [
              slug,
              supplement.label,
              'Migrated V1 site frame',
              editable.sourceHtml,
              mapped.css,
              compiled.css,
              JSON.stringify(compiled.ast),
              JSON.stringify(withSourceSamples(editable.slots, editable.values)),
              compiled.renderHash,
              compiled.ast.policyVersion,
              compiled.ast.cssPolicyVersion,
              `Source frame supplement for working plan ${hash}.`,
              compiled.carriesTrustedCode,
              'legacy',
              null,
              null,
              'site',
              page.siteId,
            ],
          )
        ).rows[0]!
        const section = {
          section_def_id: saved.section_def_id,
          section_def_version: saved.version,
          values: {
            ...editable.values,
            ...Object.fromEntries(
              mapped.mediaIds.map((mediaId, index) => [
                `v1-media-${index}`,
                { media_id: mediaId, variant: 'original' },
              ]),
            ),
          },
          hidden: false,
          hidden_at: [],
          label: supplement.label,
        }
        if (supplement.label === 'Source partnership') sections.unshift(section)
        else sections.push(section)
      }
    }
    const renamed = (
      await client.query('SELECT revision FROM app.rename_page($1,$2,$3,$4)', [
        page.pageId,
        page.expectedRevision,
        page.title,
        page.slug,
      ])
    ).rows[0]!
    const saved = (
      await client.query('SELECT revision,version_id FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
        page.pageId,
        renamed.revision,
        JSON.stringify(sections),
        JSON.stringify({ ...target.meta, noindex: true }),
        'checkpoint',
        note,
      ])
    ).rows[0]!
    result.push({
      page_id: page.pageId,
      record_id: page.recordId,
      version_id: saved.version_id,
      revision: String(saved.revision),
      slug: page.slug,
      title: page.title,
      reviewRequired: true,
    })
  }
  return { planHash: hash, replay: false, pages: result, sites: shells }
}
