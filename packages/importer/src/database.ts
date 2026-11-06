import { sourceSectionLabel } from './section-labels.ts'
import { DEFAULT_THEME_TOKENS, STRUCTURED_SCHEMA_VERSION } from '@cms/schema'
import { compileSection, compileStructuredSection, escapeText } from '@cms/renderer'
import { digest } from './backup.ts'
import type { MigrationBundle } from './migration.ts'
import { editableReference } from './editable-reference.ts'
import { remapReferenceUrls, transferSiteImages, type TransferredMedia } from './media-transfer.ts'
import {
  remapSiteAssetReferences,
  remapSiteAssetValues,
  transferSiteAssets,
  type TransferredSiteAssets,
} from './asset-transfer.ts'
import type { ReferencePage } from './reference-pages.ts'
import type { MediaStore } from '../../platform/src/ports.ts'
import { withSourceSamples } from './source-samples.ts'

export type ImportClient = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, any>[] }> }

/** Caller owns a transaction with a current super-admin actor. All mutation is
 * through product commands; failure rolls back source journal and drafts as one. */
export async function importReferenceDrafts(
  client: ImportClient,
  bundle: MigrationBundle,
  options: { prefix: string; stagingApex: string; media?: { sourceRoot: string; store: MediaStore } },
): Promise<{
  runId: string
  createdPages: number
  existingPages: number
  sites: string[]
  transferredImages: number
  transferredDocuments: number
  transferredFonts: number
  unresolvedAssets: string[]
}> {
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(options.prefix) || !/^[a-z0-9.-]+$/.test(options.stagingApex))
    throw new Error('invalid import prefix or staging apex')
  const runId = String(
    (await client.query('SELECT app.stage_v1_import($1) AS id', [JSON.stringify(bundle)])).rows[0]!.id,
  )
  const existing = (
    await client.query(
      `SELECT t.source_key,t.site_id,r.source_site FROM public.v1_import_targets t
    JOIN public.v1_import_records r ON r.run_id=t.run_id AND r.source_key=t.source_key WHERE t.run_id=$1`,
      [runId],
    )
  ).rows
  const targets = new Set(existing.map(row => row.source_key))
  const sites = new Map<string, string>(existing.map(row => [row.source_site, row.site_id]))
  const mediaBySite = new Map<string, TransferredMedia>()
  const assetsBySite = new Map<string, TransferredSiteAssets>()
  const unresolvedAssets = new Set<string>()
  let createdPages = 0
  let existingPages = 0
  for (const page of bundle.references) {
    const sourceKey = `backup/${page.key}`
    if (targets.has(sourceKey)) {
      existingPages += 1
      continue
    }
    let siteId = sites.get(page.sourceSite)
    if (!siteId) {
      const slug = `${options.prefix}-${page.sourceSite === 'humanneedsindex' ? 'hni' : 'echelon'}`
      siteId = String(
        (
          await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
            slug,
            `${page.sourceSite === 'humanneedsindex' ? 'HNI' : 'Echelon'} — V1 source reference`,
            page.sourceSite === 'humanneedsindex' ? 'resource' : 'event',
            `${slug}.${options.stagingApex}`,
            JSON.stringify(DEFAULT_THEME_TOKENS),
            '[]',
          ])
        ).rows[0]!.id,
      )
      sites.set(page.sourceSite, siteId)
    }
    if (!mediaBySite.has(page.sourceSite)) {
      if (bundle.counts.assets > 0 && !options.media)
        throw new Error('source package contains assets; configure media transfer for reference drafts')
      const transferred = options.media
        ? await transferSiteImages(
            client,
            bundle,
            runId,
            siteId,
            page.sourceSite,
            options.media.sourceRoot,
            options.media.store,
          )
        : { assets: new Map(), images: 0, unresolved: [] }
      mediaBySite.set(page.sourceSite, transferred)
      for (const path of transferred.unresolved) unresolvedAssets.add(`${page.sourceSite}:${path}`)
      const repository = page.sourceSite === 'humanneedsindex' ? 'tsa-humanneedsindex' : 'tsa-echelonsymposium'
      const hasDocuments = bundle.files.some(
        file => file.path.startsWith(`asset/${repository}/public/`) && /\/public\/(fonts|files)\//.test(file.path),
      )
      const transferredAssets =
        options.media && hasDocuments
          ? await transferSiteAssets(
              client,
              bundle,
              runId,
              siteId,
              page.sourceSite,
              options.media.sourceRoot,
              options.media.store,
            )
          : { assets: new Map(), fontIds: [], fonts: 0, documents: 0, unresolved: [] }
      assetsBySite.set(page.sourceSite, transferredAssets)
      for (const url of transferredAssets.assets.keys()) unresolvedAssets.delete(`${page.sourceSite}:${url}`)
      for (const path of transferredAssets.unresolved) unresolvedAssets.add(`${page.sourceSite}:${path}`)
    }
    const assets = mediaBySite.get(page.sourceSite)!.assets
    const siteAssets = assetsBySite.get(page.sourceSite)!
    const links = new Map<string, string>()
    for (const target of bundle.references
      .filter(target => target.sourceSite === page.sourceSite)
      .sort((a, b) => Number(a.sourceState === page.sourceState) - Number(b.sourceState === page.sourceState))) {
      const destination = `/source-${target.sourceState}-${digest(target.key).slice(0, 12)}`
      links.set(`/${target.sourcePage === 'home' ? 'index' : target.sourcePage}.html`, destination)
      if (target.sourcePage === 'home') links.set('/', destination)
    }
    const content: Record<string, unknown>[] = []
    const saveDefinition = async (
      key: string,
      html: string,
      css: string,
      label: string,
      provider?: ReferencePage['sections'][number],
    ) => {
      // Recompile under a run-specific site-scoped name. Never trust compiled
      // artifacts arriving in a package, even one the CLI just produced.
      const slug = `v1-${bundle.runId.slice(0, 12)}-${digest(key).slice(0, 24)}`
      const remapped = remapReferenceUrls(html, css, assets, links)
      for (const path of remapped.unresolved)
        if (!siteAssets.assets.has(path)) unresolvedAssets.add(`${page.sourceSite}:${path}`)
      const assetMapped = remapSiteAssetReferences(remapped.html, remapped.css, siteAssets.assets)
      for (const path of assetMapped.unresolved) unresolvedAssets.add(`${page.sourceSite}:${path}`)
      html = assetMapped.html
      css = assetMapped.css
      let structuredDoc: unknown = null
      let slots: unknown[]
      let values: Record<string, unknown>
      let compiled: ReturnType<typeof compileSection>
      if (provider?.structuredDoc) {
        // Provider configuration is validated as a closed structured document,
        // never interpolated into legacy markup or copied as a trusted AST.
        const structured = compileStructuredSection({ slug, document: provider.structuredDoc, sourceCss: css })
        if (structured.blocking.length) throw new Error('governed provider reference did not compile')
        structuredDoc = structured.document
        slots = structured.document.fields.map(field => ({
          id: field.name,
          kind: field.type,
          label: field.label,
          constraints: {},
        }))
        compiled = {
          ...compileSection({ sourceHtml: '', slots: [] }),
          css: structured.css,
          renderHash: structured.renderHash,
        }
        const rewriteLinks = (value: unknown): unknown => {
          if (Array.isArray(value)) return value.map(rewriteLinks)
          if (value && typeof value === 'object')
            return Object.fromEntries(
              Object.entries(value).map(([name, child]) => {
                if (name === 'url' && typeof child === 'string') {
                  const match = /^([^?#]+)(.*)$/.exec(child)
                  if (match && links.has(match[1]!)) return [name, links.get(match[1]!)! + match[2]!]
                }
                return [name, rewriteLinks(child)]
              }),
            )
          return value
        }
        const mappedValues = remapSiteAssetValues(rewriteLinks(provider.values ?? {}), siteAssets.assets)
        values = mappedValues.value as Record<string, unknown>
        assetMapped.assetIds.push(...mappedValues.assetIds)
        html = ''
      } else {
        const editable = editableReference({ slug, html, css })
        html = editable.sourceHtml
        compiled = editable.compiled
        slots = withSourceSamples(editable.slots, editable.values)
        values = editable.values
      }
      values = {
        ...values,
        ...Object.fromEntries(
          remapped.mediaIds.map((mediaId, index) => [`v1-media-${index}`, { media_id: mediaId, variant: 'original' }]),
        ),
        ...Object.fromEntries(
          [...new Set([...assetMapped.assetIds, ...siteAssets.fontIds])].map((assetId, index) => [
            `v1-asset-${index}`,
            { asset_id: assetId },
          ]),
        ),
      }
      const row = (
        await client.query(
          'SELECT section_def_id,version FROM app.upsert_section_def_version' +
            '($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
          [
            slug,
            label.slice(0, 200),
            'V1 migration reference',
            html,
            css,
            compiled.css,
            JSON.stringify(compiled.ast),
            JSON.stringify(slots),
            compiled.renderHash,
            compiled.ast.policyVersion,
            compiled.ast.cssPolicyVersion,
            `Preserved V1 source reference for import ${bundle.runId}; see immutable source record and review report.`,
            compiled.carriesTrustedCode,
            structuredDoc ? 'structured' : 'legacy',
            structuredDoc ? JSON.stringify(structuredDoc) : null,
            structuredDoc ? STRUCTURED_SCHEMA_VERSION : null,
            'site',
            siteId,
          ],
        )
      ).rows[0]!
      content.push({
        section_def_id: row.section_def_id,
        section_def_version: row.version,
        values,
        hidden: false,
        hidden_at: [],
        label,
      })
    }
    await saveDefinition(
      `${sourceKey}/notice`,
      '<section aria-label="Migration review"><h1>V1 source reference</h1>' +
        `<p>${escapeText(page.sourcePage)} · ${escapeText(page.sourceState)} source state.</p>` +
        '<p>This private draft preserves available source content. Styling, assets and interactive features require review before publication. ' +
        'The saved V1 state and every unresolved detail remain in the import journal.</p></section>',
      '',
      'Migration review notice',
    )
    for (const [index, section] of page.sections.entries()) {
      if (section.structuredDoc || section.compiled) {
        await saveDefinition(
          section.key,
          section.sourceHtml,
          section.sourceCss,
          sourceSectionLabel(bundle, sourceKey, index, section.sourceHtml),
          section,
        )
      } else {
        await saveDefinition(
          `${section.key}/review`,
          '<section aria-label="Unconverted V1 section"><h2>Section needs migration review</h2>' +
            `<p>Source section ${index + 1} is preserved in the import journal. ${escapeText(section.issues.join(', '))}.</p></section>`,
          '',
          `Review source section ${index + 1}`,
        )
      }
    }
    const slug = `source-${page.sourceState}-${digest(page.key).slice(0, 12)}`
    const pageId = String(
      (
        await client.query('SELECT app.create_page($1,$2,$3) AS id', [
          siteId,
          slug,
          `${page.sourcePage} — V1 ${page.sourceState} reference`.slice(0, 200),
        ])
      ).rows[0]!.id,
    )
    const versionId = String(
      (
        await client.query('SELECT version_id FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
          pageId,
          0,
          JSON.stringify(content),
          JSON.stringify({ noindex: true }),
          'checkpoint',
          'V1 preserved source reference; migration review is required.',
        ])
      ).rows[0]!.version_id,
    )
    await client.query('SELECT app.record_v1_reference_target($1,$2,$3,$4,$5)', [
      runId,
      sourceKey,
      siteId,
      pageId,
      versionId,
    ])
    createdPages += 1
  }
  // Replay reports retain unresolved source assets even when every page was
  // already imported and no image work ran on this invocation.
  const receipts = (await client.query('SELECT site_id,source_path FROM v1_import_media WHERE run_id=$1', [runId])).rows
  const transferred = new Set(receipts.map(row => `${row.site_id}:${row.source_path}`))
  const assetReceipts = (
    await client.query(
      "SELECT site_id,provenance->>'path' AS source_path FROM site_assets WHERE site_id=ANY($1::uuid[]) AND provenance->>'manifest_sha256'=$2",
      [[...sites.values()], bundle.manifestSha256],
    )
  ).rows
  for (const receipt of assetReceipts) transferred.add(`${receipt.site_id}:${receipt.source_path}`)
  for (const file of bundle.files.filter(file => file.path.startsWith('asset/'))) {
    const match = /^asset\/(tsa-humanneedsindex|tsa-echelonsymposium)\/public\/(.+)$/.exec(file.path)
    if (!match) continue
    const sourceSite = match[1] === 'tsa-humanneedsindex' ? 'humanneedsindex' : 'echelonsymposium'
    const siteId = sites.get(sourceSite)
    if (siteId && !transferred.has(`${siteId}:${file.path}`)) {
      const url = `/${match[2]}`
      unresolvedAssets.add(
        `${sourceSite}:${url}${/\.(?:png|jpe?g|webp)$/i.test(url) ? '#missing-authored-alt-intent' : ''}`,
      )
    }
  }
  return {
    runId,
    createdPages,
    existingPages,
    sites: [...new Set(sites.values())],
    transferredImages: [...mediaBySite.values()].reduce((count, media) => count + media.images, 0),
    transferredDocuments: [...assetsBySite.values()].reduce((count, assets) => count + assets.documents, 0),
    transferredFonts: [...assetsBySite.values()].reduce((count, assets) => count + assets.fonts, 0),
    unresolvedAssets: [...unresolvedAssets].sort(),
  }
}
