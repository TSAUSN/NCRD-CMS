import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { serializeOuter } from 'parse5'
import type { NavTree, SiteArchive, SlotDef } from '@cms/schema'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { organizeSource } from '@cms/renderer/source-organizer'
import { cssClosure } from './reference-css-closure.ts'
import { adaptImportedMenu, cleanTree, MENU_MARKER } from './website-page-cleanup.ts'
import type { PageSource } from './website-page-source.ts'
import { sha256, type SiteFiles } from './website-files.ts'
import { siteStylesheet, ROOT_CLASS } from './website-styles.ts'
import { slugPart, taggedFields, shelter, styleInventory } from './website-section-fields.ts'
import { setAttr, walk, type Element, type Node } from './website-tree.ts'
import type { SectionReport } from './website.ts'

/** Each section version's CSS limit; the archive and compiler enforce the same limit. */
const MAX_SECTION_CSS = 262_144

/** Compile distinct section definitions and keep the report in source order. */
export function createWebsiteSectionRegistry({
  files,
  routes,
  removed,
  notes,
  slug,
  created,
}: {
  files: SiteFiles
  routes: Map<string, string>
  removed: Record<string, number>
  notes: string[]
  slug: string
  created: string
}) {
  const definitions: SiteArchive['content']['section_defs'] = []
  const versions: SiteArchive['content']['section_def_versions'] = []
  const byContent = new Map<string, { id: string; slots: SlotDef[] }>()
  const sectionReports: SectionReport[] = []
  const slugs = new Set<string>()
  const siteSlug = slugPart(slug).slice(0, 20) || 'site'
  let importedNavigation: NavTree = []

  /** One section, as a definition and the values a page instance starts with. */
  function defineSection(
    node: Element,
    page: PageSource,
    label: string,
    placement: 'page' | 'header' | 'footer',
    siteCss: string,
  ) {
    const inlineCss: string[] = []
    const menu = placement === 'header' ? adaptImportedMenu(node, page, files, routes) : null
    if (menu) {
      importedNavigation = menu.tree
      notes.push(
        'The scripted mobile menu was replaced with an accessible disclosure backed by the site Navigation workspace.',
      )
    }
    cleanTree(node, page, files, routes, removed, inlineCss, placement !== 'page')
    const extraCss = inlineCss.map(css => siteStylesheet(css, page.file, files, removed)).join('\n')
    const report: SectionReport = {
      page: page.path || 'home',
      label,
      fields: 0,
      mode: 'static',
      reused: false,
      problems: [],
    }
    let html: string,
      fields: SlotDef[] = [],
      samples: Record<string, unknown> = {}
    const tagged = taggedFields(node)
    for (const el of [...walk({ childNodes: [node] } as unknown as Node)])
      for (const a of [...el.attrs]) if (a.name.startsWith('data-cms-')) setAttr(el, a.name, null)
    if (tagged) {
      html = serializeOuter(node)
      fields = tagged.fields
      samples = tagged.samples
      report.mode = 'tagged'
    } else {
      const sheltered = shelter(serializeOuter(node))
      const proposal = organizeSource(sheltered.html, '')
      if (proposal.blocking.length) {
        html = sheltered.restore(sheltered.html)
        report.problems.push(...proposal.blocking)
      } else {
        html = sheltered.restore(proposal.sourceHtml)
        fields = proposal.fields
        samples = proposal.samples
        report.mode = fields.length ? 'proposed' : 'static'
      }
    }
    if (menu) {
      html = html.replace(new RegExp(`<span[^>]*class="${MENU_MARKER}"[^>]*>\\s*</span>`, 'g'), '{{site-menu}}')
      fields.push({ id: 'site-menu', kind: 'navigation', label: 'Site menu', constraints: {} })
    }
    const wrapped = `<div class="${ROOT_CLASS}">${html}</div>`
    // Only the rules that can match this section travel with it, read from the
    // tree already parsed rather than from a second, stricter parse that real
    // sites' markup can fail (and that then carried the whole stylesheet).
    let css = cssClosure(styleInventory(node), `${siteCss}\n${extraCss}`).css + (menu ? `\n${menu.css}` : '')
    if (css.length > MAX_SECTION_CSS) {
      report.problems.push('Its styles are larger than a section may carry; the excess was left out.')
      css = css.slice(0, css.lastIndexOf('}', MAX_SECTION_CSS) + 1)
    }
    const key = sha256(`${placement}\0${wrapped}\0${css}\0${JSON.stringify(fields)}`)
    const reuse = byContent.get(key)
    report.fields = fields.length
    if (reuse) {
      report.reused = true
      sectionReports.push(report)
      return { id: reuse.id, values: samples, label }
    }
    let slug = `${siteSlug}-${slugPart(page.path || 'home') || 'page'}-${slugPart(label) || 'section'}`
      .slice(0, 60)
      .replace(/-+$/, '')
    let n = 2
    while (slugs.has(slug)) slug = `${slug.slice(0, 57)}-${n++}`
    slugs.add(slug)
    let compiled = compileSection({
      sourceHtml: wrapped,
      sourceCss: css,
      slots: fields,
      scopeSelector: sectionScopeSelector(slug)!,
    })
    let sourceHtml = wrapped
    if (compiled.blocking.length && fields.length) {
      // Fall back to a fixed section rather than lose it.
      report.problems.push(...compiled.blocking.map(problem => `fields dropped: ${problem}`))
      sourceHtml = `<div class="${ROOT_CLASS}">${shelter(serializeOuter(node)).html.replace(/<span data-cms-kept="\d+"><\/span>/g, '')}</div>`
      fields = []
      samples = {}
      compiled = compileSection({ sourceHtml, sourceCss: css, slots: [], scopeSelector: sectionScopeSelector(slug)! })
      report.mode = 'static'
      report.fields = 0
    }
    if (compiled.blocking.length) {
      report.problems.push(...compiled.blocking)
      sectionReports.push(report)
      return null
    }
    report.problems.push(...compiled.problems.slice(0, 5))
    const id = randomUUID()
    definitions.push({
      id,
      slug,
      name: label.slice(0, 200),
      category: placement === 'page' ? 'Imported' : 'Imported frame',
      status: 'active',
      scope: 'site',
      placement,
    })
    versions.push({
      id: randomUUID(),
      section_def_id: id,
      version: 1,
      source_html: sourceHtml,
      source_css: css,
      slots: fields,
      definition_kind: 'legacy',
      structured_doc: null,
      structured_schema_version: null,
      changelog: `Imported from ${basename(page.file)}`,
      created_at: created,
    })
    byContent.set(key, { id, slots: fields })
    sectionReports.push(report)
    return { id, values: samples, label }
  }

  return {
    defineSection,
    definitions,
    versions,
    sectionReports,
    get navigation() {
      return importedNavigation
    },
  }
}
