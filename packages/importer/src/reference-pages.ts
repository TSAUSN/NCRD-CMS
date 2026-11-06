import { isObject, digest, type V1Backup } from './backup.ts'
import { attribute, parseHtml, type HtmlNode } from './html.ts'
import { applyLegacyValues, serializeLegacy } from './legacy-values.ts'
import { staticCompatibility, type StaticCompatibility } from './static-compatibility.ts'
import type { V1Catalogue } from './source.ts'
import { disclosureCss, inertReference } from './inert-reference.ts'
import { referenceStyles } from './reference-styles.ts'
import { providerReference, type ProviderReference } from './provider-reference.ts'
import { referenceCssClosure } from './reference-css-closure.ts'
import { eventFallbacks } from './event-fallbacks.ts'
import { applyInstanceSettings } from './instance-settings.ts'

export type ReferencePage = {
  key: string
  sourceSite: string
  sourcePage: string
  sourceState: string
  sections: (StaticCompatibility & {
    key: string
    appliedFields: number
    structuredDoc?: ProviderReference['structuredDoc']
    values?: ProviderReference['values']
    slots?: ProviderReference['slots']
    providerViews?: string[]
    sourceVariant?: {
      sourceSite: string
      templateId: string
      sourceFile: string
      sourceLine: number
      htmlSha256: string
      cssSha256: string
    }
    styleStats?: { inputRules: number; retainedRules: number; sourceBytes: number; retainedBytes: number }
  })[]
  issues: string[]
}

/** Find a native source section without evaluating its JavaScript renderer. */
function nativeSections(html: string): { key: string; html: string }[] {
  const main = /<main\b[^>]*>([\s\S]*)<\/main\s*>/i.exec(html)
  if (!main) return []
  const parsed = parseHtml(main[1]!)
  if (!parsed.ok) return []
  return parsed.nodes
    .filter(node => node.kind === 'element')
    .map((node, index) => ({
      key:
        node.kind === 'element'
          ? (attribute(node, 'data-cms-section') ?? attribute(node, 'id') ?? `native-${index}`)
          : `native-${index}`,
      html: serializeLegacy([node]),
    }))
}

function findNative(html: string, marker: string): string | null {
  const main = /<main\b[^>]*>([\s\S]*)<\/main\s*>/i.exec(html)
  if (!main) return null
  const parsed = parseHtml(main[1]!)
  if (!parsed.ok) return null
  const walk = (nodes: HtmlNode[]): string | null => {
    for (const node of nodes) {
      if (node.kind === 'text') continue
      if (attribute(node, 'data-cms-section') === marker || attribute(node, 'id') === marker)
        return serializeLegacy([node])
      const found = walk(node.children)
      if (found) return found
    }
    return null
  }
  return walk(parsed.nodes)
}

export function referencePages(backup: V1Backup, catalogue: V1Catalogue, source: Map<string, string>): ReferencePage[] {
  const definitions = new Map(catalogue.definitions.map(def => [def.id, def]))
  const siteVariants = new Map(catalogue.siteVariants.map(def => [`${def.sourceSite}/${def.id}`, def]))
  const result: ReferencePage[] = []
  const repositories: Record<string, string> = {
    humanneedsindex: 'tsa-humanneedsindex',
    echelonsymposium: 'tsa-echelonsymposium',
  }
  for (const record of backup.records) {
    if (!record.payload) continue
    const draft = /^sites\/([^/]+)\/pages\/([^/]+)$/.exec(record.path)
    const live = record.path.startsWith('publishedPages/') && record.payload.status === 'published'
    const site = draft?.[1] ?? (live && typeof record.payload.siteId === 'string' ? record.payload.siteId : null)
    const page = draft?.[2] ?? (live && typeof record.payload.pageId === 'string' ? record.payload.pageId : null)
    if (!site || !page || !repositories[site]) continue
    const directory = repositories[site]!
    let sourceHtml = source.get(`${directory}/${page === 'home' ? 'index' : page}.html`) ?? ''
    const eventFallbackIssues: string[] = []
    if (
      site === 'echelonsymposium' &&
      !backup.records.some(
        record =>
          /(?:publishedContent|contentCollections|collections)\//.test(record.path) &&
          (record.path.includes(site) || record.payload?.siteId === site),
      )
    ) {
      const fallback = eventFallbacks(
        sourceHtml,
        source.get(`${directory}/src/cms/event-content-defaults.js`) ?? '',
        source.get(`${directory}/src/main.js`) ?? '',
      )
      sourceHtml = fallback.html
      eventFallbackIssues.push(...fallback.issues)
    }
    const builtCss = [...source]
      .filter(([file]) => file.startsWith(`${directory}/dist/assets/`) && file.endsWith('.css'))
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([, text]) => text)
      .join('\n')
    const styled = referenceStyles(builtCss || source.get(`${directory}/src/style.css`) || '', {
      wrapHeroSubtitle: site === 'echelonsymposium',
      readableRegistrationStatus: site === 'echelonsymposium',
      inFlowEchelonHeader: site === 'echelonsymposium',
    })
    if (!builtCss) styled.issues.push('compiled-site-utilities-unavailable')
    const pageCss = styled.css.replace(/\[\s*data-cms-section\b/g, '[data-v1-cms-section')
    const state = draft ? 'draft' : 'published'
    const issues = new Set([
      'source-reference-needs-review',
      'page-visual-parity-not-verified',
      'site-frame-and-theme-review',
      ...eventFallbackIssues,
    ])
    const items = Array.isArray(record.payload.sections) ? record.payload.sections : null
    const sections: ReferencePage['sections'] = []
    if (items) {
      for (const [index, item] of items.entries()) {
        const template = isObject(item) && typeof item.templateId === 'string' ? item.templateId : ''
        const variant = siteVariants.get(`${site}/${template}`)
        const definition = catalogue.divergingIds.includes(template) ? variant : definitions.get(template)
        const sourceVariant = variant
          ? {
              sourceSite: site,
              templateId: template,
              sourceFile: variant.sourcePath,
              sourceLine: variant.sourceLine,
              htmlSha256: variant.htmlSha256,
              cssSha256: variant.cssSha256,
            }
          : undefined
        const native = template.startsWith('native:') ? findNative(sourceHtml, template.slice(7)) : null
        const html = definition?.html ?? native
        const key = `${record.path}/sections/${index}`
        const slug = `v1-ref-${digest(key).slice(0, 24)}`
        if (html == null) {
          sections.push({
            key,
            slug,
            sourceHtml: '',
            sourceCss: '',
            compiled: null,
            status: 'refused',
            issues: ['missing-source-template'],
            appliedFields: 0,
          })
          continue
        }
        const content = isObject(item) && isObject(item.content) ? item.content : {}
        const applied = applyLegacyValues(html, content)
        const settings = applyInstanceSettings(applied.html, isObject(item) ? item.settings : null)
        const provider =
          site === 'humanneedsindex'
            ? providerReference({
                slug,
                html: settings.html,
                css: `${pageCss}\n${(definition?.css ?? '').replace(/\[\s*data-cms-section\b/g, '[data-v1-cms-section')}\n${settings.css}`,
                inheritedIssues: [
                  ...applied.issues,
                  ...styled.issues,
                  ...(native ? ['native-runtime-review'] : []),
                  ...settings.issues,
                  ...(variant ? ['source-site-variant-preserved'] : []),
                ],
              })
            : null
        if (provider) {
          sections.push({
            key,
            ...provider,
            ...(sourceVariant ? { sourceVariant } : {}),
            appliedFields: applied.appliedFields,
          })
          continue
        }
        const inert = inertReference(settings.html, { openFirst: site === 'humanneedsindex' })
        const inherited = [...applied.issues, ...inert.issues, ...styled.issues, ...settings.issues]
        if (native) inherited.push('native-runtime-review')
        if (variant) inherited.push('source-site-variant-preserved')
        const sectionCss = (definition?.css ?? '').replace(/\[\s*data-cms-section\b/g, '[data-v1-cms-section')
        const wrapped = `<div class="v1-reference-root">${inert.html}</div>`
        // A restored FAQ disclosure keeps V1's open-question styles.
        const disclosures = inert.issues.includes('native-disclosure-restored')
          ? disclosureCss(`${pageCss}\n${sectionCss}`)
          : ''
        const { css, ...styleStats } = referenceCssClosure(
          wrapped,
          `${pageCss}\n${sectionCss}\n${settings.css}\n${disclosures}`,
        )
        const compatibility = staticCompatibility({ slug, html: wrapped, css, inheritedIssues: inherited })
        sections.push({
          key,
          ...compatibility,
          ...(sourceVariant ? { sourceVariant } : {}),
          appliedFields: applied.appliedFields,
          styleStats,
        })
      }
    } else {
      issues.add('native-runtime-review')
      const extracted = nativeSections(sourceHtml)
      if (!extracted.length) issues.add('native-page-extraction-refused')
      for (const [index, native] of extracted.entries()) {
        const key = `${record.path}/native/${index}`
        const provider =
          site === 'humanneedsindex'
            ? providerReference({
                slug: `v1-ref-${digest(key).slice(0, 24)}`,
                html: native.html,
                css: pageCss,
                inheritedIssues: ['native-runtime-review', ...styled.issues],
              })
            : null
        if (provider) {
          sections.push({ key, ...provider, appliedFields: 0 })
          continue
        }
        const inert = inertReference(native.html, { openFirst: site === 'humanneedsindex' })
        const wrapped = `<div class="v1-reference-root">${inert.html}</div>`
        const { css, ...styleStats } = referenceCssClosure(
          wrapped,
          inert.issues.includes('native-disclosure-restored') ? `${pageCss}\n${disclosureCss(pageCss)}` : pageCss,
        )
        sections.push({
          key,
          appliedFields: 0,
          styleStats,
          ...staticCompatibility({
            slug: `v1-ref-${digest(key).slice(0, 24)}`,
            html: wrapped,
            css,
            inheritedIssues: ['native-runtime-review', ...styled.issues, ...inert.issues],
          }),
        })
      }
    }
    if (sections.some(section => section.status === 'refused')) issues.add('unconverted-sections-retained-for-review')
    for (const section of sections) for (const issue of section.issues) issues.add(issue)
    result.push({
      key: record.path,
      sourceSite: site,
      sourcePage: page,
      sourceState: state,
      sections,
      issues: [...issues].sort(),
    })
  }
  return result
}
