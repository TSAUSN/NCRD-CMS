import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { renderStructuredBody } from '@cms/renderer'
import { STRUCTURED_SCHEMA_VERSION } from '@cms/schema'
import {
  canonical,
  containedFile,
  digest,
  isObject,
  readV1Backup,
  type InputFile,
  type Json,
  type JsonObject,
  type V1Backup,
} from './backup.ts'
import { compareRenderings, partitionDifferences, v1DefaultValues } from './parity.ts'
import { readV1Catalogue } from './source.ts'
import { classesInStylesheet } from './presets.ts'
import { runImport, type ImportRun } from './run.ts'
import { referencePages, type ReferencePage } from './reference-pages.ts'
import { staticCompatibility } from './static-compatibility.ts'
import { editableReference } from './editable-reference.ts'

export const V1_MIGRATION_VERSION = 11
export const V1_ROLE_MAPPING = {
  content_creator: 'contributor',
  editor: 'editor',
  admin: 'site_admin',
  super_admin: 'super_admin',
} as const
export type MigrationRecord = {
  key: string
  kind: string
  sourceSite: string | null
  sourceSha256: string
  payload: Json
  issues: string[]
}
export type MigrationBundle = {
  format: 'cms-v1-migration'
  version: 1
  runId: string
  manifestSha256: string
  takenAt: string
  files: InputFile[]
  records: MigrationRecord[]
  references: ReferencePage[]
  counts: {
    documents: number
    placeholders: number
    sourceFiles: number
    assets: number
    definitions: number
    siteVariants?: ImportRun['counts']['siteVariants']
  }
}
export type PageParity = {
  site: string
  page: string
  state: string
  sourceSha256: string
  sectionCount: number | null
  compatibleSections: number
  sections: { index: number; template: string; issues: string[] }[]
  issues: string[]
}

const SITES = { humanneedsindex: 'tsa-humanneedsindex', echelonsymposium: 'tsa-echelonsymposium' } as const
const STATIC_PAGES = {
  humanneedsindex: ['index.html', 'methodology.html', 'resources.html', 'explore-data.html', 'resource.html'],
  echelonsymposium: ['index.html'],
} as const

function sourceSite(key: string, payload: JsonObject | null): string | null {
  if (key.startsWith('sites/')) return key.split('/')[1] ?? null
  if (typeof payload?.siteId === 'string') return payload.siteId
  if (/^(siteRegistry|publishedSiteSettings|publishedTheme)\//.test(key)) return key.split('/')[1] ?? null
  return null
}

export function backupRecordKind(key: string, payload: JsonObject | null): string {
  if (payload === null) return 'placeholder'
  if (/^sites\/[^/]+\/pages\/[^/]+$/.test(key)) return 'draft-page'
  if (key.startsWith('publishedPages/'))
    return payload.status === 'published' ? 'published-page' : 'publication-tombstone'
  if (key.startsWith('releaseNotes/')) return 'release-note'
  if (/^sites\/[^/]+\/publishingHistory\//.test(key)) return 'publishing-history'
  if (key.startsWith('users/')) return 'user'
  if (/^sites\/[^/]+\/media\//.test(key)) return 'media'
  if (/\/settings\//.test(key) || /^(publishedSiteSettings|publishedTheme|siteRegistry)\//.test(key))
    return 'site-settings'
  return 'unmapped-record'
}

/** Page states are kept separate even when their content happens to be equal. */
export function inspectBackupPages(backup: V1Backup, run: ImportRun): PageParity[] {
  const definitions = new Map(run.records.map(record => [record.provenance.id, record]))
  return backup.records.flatMap(record => {
    const kind = backupRecordKind(record.path, record.payload)
    if (!['draft-page', 'published-page', 'publication-tombstone'].includes(kind) || !record.payload) return []
    const payload = record.payload
    const site = sourceSite(record.path, payload) ?? 'unknown'
    const page =
      kind === 'draft-page'
        ? record.path.split('/')[3]!
        : typeof payload.pageId === 'string'
          ? payload.pageId
          : 'unknown'
    const issues = new Set<string>()
    if (kind !== 'publication-tombstone' && !Array.isArray(payload.sections)) issues.add('native-page-needs-rebuild')
    if (kind !== 'publication-tombstone' && payload.layoutMode !== 'sections') issues.add('legacy-layout-needs-review')
    if (isObject(payload.templates) && Object.keys(payload.templates).length) issues.add('custom-templates-need-review')
    if (Array.isArray(payload.inserts) && payload.inserts.length) issues.add('legacy-inserts-need-review')
    if (payload.compiledHtml || payload.compiledCss || payload.blocks || payload.overrides)
      issues.add('legacy-page-overrides-need-review')
    const sections = (Array.isArray(payload.sections) ? payload.sections : []).map((section, index) => {
      const reasons = new Set<string>()
      const template = isObject(section) && typeof section.templateId === 'string' ? section.templateId : 'unknown'
      const definition = definitions.get(template)
      if (template.startsWith('native:')) reasons.add('native-section-needs-rebuild')
      else if (!definition) reasons.add('missing-template')
      else for (const reason of definition.reasons) reasons.add(reason.code)
      if (!isObject(section)) reasons.add('invalid-section-shape')
      else {
        if (section.mode !== 'clone' || section.source !== 'git') reasons.add('legacy-section-mode')
        if (isObject(section.settings) && Object.keys(section.settings).length)
          reasons.add('instance-settings-need-review')
        if (isObject(section.content) && Object.keys(section.content).length) {
          // V1 content blocks also hold hidden/colour/geometry/icon overrides.
          // Until mapped exactly, an otherwise convertible definition is not a
          // claim that this saved instance has the same appearance.
          reasons.add('saved-content-overrides-need-review')
        }
      }
      return { index, template, issues: [...reasons].sort() }
    })
    for (const section of sections) for (const issue of section.issues) issues.add(issue)
    if (kind !== 'publication-tombstone') issues.add('page-render-parity-not-verified')
    return [
      {
        site,
        page,
        state: kind,
        sourceSha256: record.sha256,
        sectionCount: Array.isArray(payload.sections) ? payload.sections.length : null,
        compatibleSections: sections.filter(section => section.issues.length === 0).length,
        sections,
        issues: [...issues].sort(),
      },
    ]
  })
}

function filesBelow(root: string, directory: string): string[] {
  const base = realpathSync(root)
  const entries = readdirSync(path.join(base, directory), { withFileTypes: true })
  return entries
    .flatMap(entry => {
      if (entry.isSymbolicLink()) throw new Error('site source inventory refuses symlinks')
      const relative = `${directory}/${entry.name}`
      if (entry.isDirectory()) return filesBelow(base, relative)
      return entry.isFile() ? [relative] : []
    })
    .sort()
}

export function createMigration(options: { v1Root: string; repoRoot: string; backupRoot: string }): {
  bundle: MigrationBundle
  report: ReturnType<typeof migrationReport>
} {
  const backup = readV1Backup(options.backupRoot)
  const run = runImport(options)
  const catalogue = readV1Catalogue(options, classesInStylesheet)
  const pages = inspectBackupPages(backup, run)
  const pageByHash = new Map(pages.map(page => [`${page.state}:${page.sourceSha256}`, page]))
  const records: MigrationRecord[] = backup.records.map(record => {
    const kind = backupRecordKind(record.path, record.payload)
    const issues = [...(pageByHash.get(`${kind}:${record.sha256}`)?.issues ?? [])]
    if (kind === 'user') {
      issues.push('identity-and-site-assignment-review')
      if (!Object.hasOwn(V1_ROLE_MAPPING, String(record.payload?.role))) issues.push('unknown-role')
    }
    if (['media', 'site-settings', 'unmapped-record', 'publishing-history'].includes(kind))
      issues.push(`${kind}-mapping-review`)
    return {
      key: `backup/${record.path}`,
      kind,
      sourceSite: sourceSite(record.path, record.payload),
      sourceSha256: record.sha256,
      payload: record.payload,
      issues: issues.sort(),
    }
  })
  const files = [
    ...backup.files,
    ...run.manifest.files.map(file => ({ path: `catalogue/${file.path}`, sha256: file.sha256, bytes: file.bytes })),
  ]
  const definitionParity: {
    id: string
    status: string
    normalizedHtml: string
    substantiveDifferences: number | null
  }[] = []
  for (const definition of catalogue.definitions) {
    const converted = run.records.find(record => record.provenance.id === definition.id)!
    let normalizedHtml = 'not-convertible'
    let substantiveDifferences: number | null = null
    if (converted.conversion.document) {
      const values = v1DefaultValues(definition.html, definition.slots)
      if (values.problems.length) normalizedHtml = 'value-extraction-needs-review'
      else {
        const rendered = renderStructuredBody(
          {
            definition_kind: 'structured',
            structured_doc: converted.conversion.document,
            structured_schema_version: STRUCTURED_SCHEMA_VERSION,
          },
          values.values,
        )
        if (rendered === null) normalizedHtml = 'renderer-refused'
        else {
          const differences = partitionDifferences(compareRenderings(definition.html, rendered))
          substantiveDifferences = differences.substantive.length
          normalizedHtml = substantiveDifferences === 0 ? 'pass' : 'different'
        }
      }
    }
    definitionParity.push({ id: definition.id, status: converted.status, normalizedHtml, substantiveDifferences })
    const compatibility = staticCompatibility({
      slug: `v1-static-${digest(definition.id).slice(0, 24)}`,
      html: definition.html,
      css: definition.css,
      inheritedIssues: converted.reasons
        .filter(reason => ['site-divergence', 'interaction-preset-css', 'unresolved-anchor'].includes(reason.code))
        .map(reason => reason.code),
    })
    const variants = converted.variants.map(receipt => ({
      ...receipt,
      source: catalogue.siteVariants.find(
        variant => variant.id === definition.id && variant.sourceSite === receipt.sourceSite,
      )!,
    }))
    const payload = JSON.parse(
      JSON.stringify({ source: definition, conversion: converted.conversion, compatibility, variants }),
    ) as Json
    records.push({
      key: `catalogue/${definition.id}`,
      kind: 'section-definition',
      sourceSite: null,
      sourceSha256: digest(canonical(payload)),
      payload,
      issues: [
        ...new Set([
          ...converted.reasons.map(reason => reason.code),
          ...(normalizedHtml === 'pass' ? [] : ['definition-parity-needs-review']),
        ]),
      ].sort(),
    })
  }
  let sourceFiles = 0
  let assets = 0
  const sourceText = new Map<string, string>()
  const siteEvidence: { site: string; staticPages: string[]; files: number; assets: number; assetBytes: number }[] = []
  for (const [site, directory] of Object.entries(SITES)) {
    const textFiles = [
      ...STATIC_PAGES[site as keyof typeof STATIC_PAGES].map(file => `${directory}/${file}`),
      ...(existsSync(path.join(options.v1Root, directory, 'dist/assets'))
        ? filesBelow(options.v1Root, `${directory}/dist/assets`).filter(file => file.endsWith('.css'))
        : []),
      ...filesBelow(options.v1Root, `${directory}/src`).filter(
        file => /\.(css|js|json)$/.test(file) && !/\.test\./.test(file),
      ),
    ]
    for (const relative of textFiles) {
      const bytes = readFileSync(containedFile(options.v1Root, relative))
      if (bytes.length > 8 * 1024 * 1024) throw new Error('site source file exceeds 8 MiB')
      files.push({ path: `source/${relative}`, sha256: digest(bytes), bytes: bytes.length })
      const payload = { text: bytes.toString('utf8') }
      sourceText.set(relative, payload.text)
      records.push({
        key: `source/${relative}`,
        kind: 'site-source',
        sourceSite: site,
        sourceSha256: digest(canonical(payload)),
        payload,
        issues: ['native-source-dependency-review'],
      })
      sourceFiles += 1
    }
    const assetFiles = filesBelow(options.v1Root, `${directory}/public`)
    let assetBytes = 0
    for (const relative of assetFiles) {
      const file = containedFile(options.v1Root, relative)
      const size = statSync(file).size
      if (size > 128 * 1024 * 1024) throw new Error('source asset exceeds 128 MiB inventory limit')
      const bytes = readFileSync(file)
      files.push({ path: `asset/${relative}`, sha256: digest(bytes), bytes: bytes.length })
      assetBytes += bytes.length
      assets += 1
    }
    siteEvidence.push({
      site,
      staticPages: [...STATIC_PAGES[site as keyof typeof STATIC_PAGES]],
      files: textFiles.length,
      assets: assetFiles.length,
      assetBytes,
    })
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  records.sort((a, b) => a.key.localeCompare(b.key, 'en'))
  const manifestSha256 = digest(canonical(files))
  const references = referencePages(backup, catalogue, sourceText)
  const runId = digest(
    canonical({
      version: V1_MIGRATION_VERSION,
      manifestSha256,
      records: records.map(({ key, sourceSha256, issues }) => ({ key, sourceSha256, issues })),
      references,
    }),
  )
  const bundle: MigrationBundle = {
    format: 'cms-v1-migration',
    version: 1,
    runId,
    manifestSha256,
    takenAt: backup.takenAt,
    files,
    records,
    references,
    counts: {
      documents: backup.documents,
      placeholders: backup.placeholders,
      sourceFiles,
      assets,
      definitions: run.records.length,
      siteVariants: run.counts.siteVariants,
    },
  }
  return { bundle, report: migrationReport(bundle, pages, definitionParity, siteEvidence) }
}

function migrationReport(
  bundle: MigrationBundle,
  pages: PageParity[],
  definitions: {
    id: string
    status: string
    normalizedHtml: string
    substantiveDifferences: number | null
  }[],
  siteEvidence: { site: string; staticPages: string[]; files: number; assets: number; assetBytes: number }[],
) {
  return {
    format: 'cms-v1-parity-report',
    version: 1,
    runId: bundle.runId,
    manifestSha256: bundle.manifestSha256,
    sourceTakenAt: bundle.takenAt,
    counts: bundle.counts,
    files: bundle.files,
    roleMapping: V1_ROLE_MAPPING,
    recordKinds: Object.fromEntries(
      [...new Set(bundle.records.map(record => record.kind))]
        .sort()
        .map(kind => [kind, bundle.records.filter(record => record.kind === kind).length]),
    ),
    unresolvedRecords: bundle.records.filter(record => record.issues.length > 0).length,
    staticCompatibility: {
      candidates: bundle.records.filter(
        record =>
          record.kind === 'section-definition' &&
          isObject(record.payload) &&
          isObject(record.payload.compatibility) &&
          record.payload.compatibility.status !== 'refused',
      ).length,
    },
    references: bundle.references.map(page => ({
      key: page.key,
      site: page.sourceSite,
      page: page.sourcePage,
      state: page.sourceState,
      sections: page.sections.length,
      renderedSections: page.sections.filter(section => section.structuredDoc || section.compiled !== null).length,
      appliedFields: page.sections.reduce((count, section) => count + section.appliedFields, 0),
      ...referenceFieldSummary(page),
      issues: page.issues,
    })),
    siteEvidence,
    pages,
    definitions,
    cutover: {
      ready: false,
      checks: [
        {
          key: 'fresh-backup',
          status: 'required',
          detail:
            'Re-export at the agreed content freeze and compare this manifest; a historical backup cannot establish current parity.',
        },
        {
          key: 'all-records-preserved',
          status: 'pass',
          detail: 'Every backup document and fieldless parent has a separately hashed immutable import record.',
        },
        {
          key: 'draft-live-separation',
          status: 'pass',
          detail:
            'Drafts, publications and unpublish tombstones are distinct source records; source status never moves a V2 live pointer.',
        },
        {
          key: 'content-mapping',
          status: 'required',
          detail:
            'Resolve every native layout, saved content override, settings, media and identity finding with source-linked evidence.',
        },
        {
          key: 'hni-echelon-page-parity',
          status: 'required',
          detail:
            'Render imported HNI/Echelon pages with their saved state and all required assets; compare normalized HTML and desktop/mobile screenshots.',
        },
        {
          key: 'asset-transfer',
          status: 'required',
          detail:
            'Transfer inventoried assets through Media and reconcile byte hashes; this package records hashes without embedding asset bytes.',
        },
        {
          key: 'identity-activation',
          status: 'required',
          detail:
            'Review explicit role mapping and site grants; provision hosted identities separately without importing credentials.',
        },
        {
          key: 'recovery-dns-cutover',
          status: 'required',
          detail:
            'Complete isolated V2 restore, DNS/rollback rehearsal and named operator cutover approval while V1 keeps serving.',
        },
      ],
    },
  }
}

/** Counts and review notes only; source copy never enters the inventory. */
export function referenceFieldSummary(page: Pick<ReferencePage, 'sections'>) {
  let editableFields = 0
  let richTextFields = 0
  const fieldMappingIssues = new Set<string>()
  for (const section of page.sections) {
    if (section.structuredDoc) {
      editableFields += section.structuredDoc.fields.length
      richTextFields += section.structuredDoc.fields.filter(field => field.type === 'richtext').length
    } else if (section.compiled) {
      const mapped = editableReference({ slug: section.slug, html: section.sourceHtml, css: section.sourceCss })
      editableFields += mapped.slots.length
      richTextFields += mapped.slots.filter(slot => slot.kind === 'richtext').length
      for (const issue of mapped.issues) fieldMappingIssues.add(issue)
    }
  }
  return { editableFields, richTextFields, fieldMappingIssues: [...fieldMappingIssues].sort() }
}

export function migrationMarkdown(report: ReturnType<typeof migrationReport>): string {
  const lines = [
    '# V1 migration parity and cutover report',
    '',
    `Run: \`${report.runId}\``,
    `Source backup: ${report.sourceTakenAt}`,
    '',
    `${report.counts.documents} documents + ${report.counts.placeholders} fieldless parents preserved; ${report.counts.definitions} catalogue definitions; ${report.counts.sourceFiles} source files; ${report.counts.assets} inventoried assets.`,
    '',
    '**Cutover is not ready.** Source preservation is complete for this manifest. Page reconstruction, full rendered parity and external cutover checks remain explicit review work.',
    '',
    '| Site | Page | Source state | Sections | Compatible instances | Issues |',
    '| --- | --- | --- | ---: | ---: | --- |',
  ]
  for (const page of report.pages)
    lines.push(
      `| ${page.site} | ${page.page} | ${page.state} | ${page.sectionCount ?? 'native'} | ${page.compatibleSections} | ${page.issues.join(', ') || 'none'} |`,
    )
  lines.push(
    '',
    `Catalogue normalized HTML passes: ${report.definitions.filter(d => d.normalizedHtml === 'pass').length}/${report.definitions.length}. This is definition-level evidence, not HNI/Echelon page or screenshot parity.`,
    '',
    `Passive static compatibility candidates: ${report.staticCompatibility.candidates}/${report.definitions.length}. These preserve authored markup as governed reference sections with explicit review of stylesheet/runtime differences.`,
    ...(report.counts.siteVariants
      ? [
          `${report.counts.siteVariants.variants} source-site variant subreceipts for ${report.counts.siteVariants.definitions} parent catalogue identities; parent definition count is unchanged. Destination selection preserves each site’s original declaration. Conversion counts do not establish visual parity.`,
        ]
      : []),
    '',
    'Mapped-field counts exclude values with unresolved field mappings. They do not establish complete page styling or visual parity.',
    '',
    '| Reference draft | Source state | Renderable sections | Fully mapped saved fields | Editable fields | Rich-text fields | Field-mapping notes |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
  )
  for (const page of report.references)
    lines.push(
      `| ${page.site}/${page.page} | ${page.state} | ${page.renderedSections}/${page.sections} | ${page.appliedFields} | ${page.editableFields} | ${page.richTextFields} | ${page.fieldMappingIssues.join(', ') || 'none'} |`,
    )
  lines.push(
    '',
    'The icon-source-drawing-kept note means a source icon is shown exactly as the source drew it and is not one of the editor’s icon choices, because the code-owned icon set draws differently (SPEC §6.5, LIB-03).',
  )
  lines.push(
    '',
    'Rich-text field counts describe editable grouping, not source-site fidelity. The richtext-link-policy-applied note means ordinary inline links gain the renderer’s default noopener/nofollow relationship; their destinations and labels are retained. Styled or independently authored regions remain separate fields. The inline-richtext-field-mapping-required note means a source paragraph, heading, other inline-only or link-contained region stays in text fields because the current visual rich-text editor emits blocks and links.',
  )
  lines.push('', '| Cutover check | Status | Evidence required |', '| --- | --- | --- |')
  for (const check of report.cutover.checks) lines.push(`| ${check.key} | ${check.status} | ${check.detail} |`)
  return `${lines.join('\n')}\n`
}
