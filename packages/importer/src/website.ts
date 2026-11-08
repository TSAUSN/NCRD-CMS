/** Turn a local website folder into a private CMS content archive and a reviewable report. */
import {
  type SiteArchive,
  DEFAULT_THEME_TOKENS,
  DEFAULT_HEADER_CONFIG_V1,
  DEFAULT_FOOTER_CONFIG_V1,
  parseSiteArchive,
  SITE_ARCHIVE_FORMAT,
  SITE_ARCHIVE_VERSION,
} from '@cms/schema'
import { realpathSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { localWebsiteFile, PAGE_EXTENSIONS, SiteFiles } from './website-files.ts'
import { readPage } from './website-page-source.ts'
import { walk, attr, textOf, find, visibleText } from './website-tree.ts'
import { createPageStylesheetReader } from './website-styles.ts'
import { randomUUID } from 'node:crypto'
import { createWebsiteSectionRegistry } from './website-section-registry.ts'

export type WebsiteImportOptions = {
  /** Folder holding the site's pages and assets. */
  root: string
  name: string
  /** The new site's short address in the CMS. */
  slug: string
  kind?: 'resource' | 'event' | 'general'
  /** Pages to import, relative to the root. Default: every .html file in the root. */
  pages?: string[]
  /** Stylesheets a bundler injects at run time, relative to the root. */
  css?: string[]
  /** Folder that root-relative addresses ("/images/a.png") resolve against. Default: the root. */
  publicDir?: string
  /** The site's own domain names, so full addresses on them resolve to its files. */
  domains?: string[]
  now?: Date
}

export type SectionReport = {
  page: string
  label: string
  fields: number
  mode: 'tagged' | 'proposed' | 'static'
  reused: boolean
  problems: string[]
}
export type WebsiteImportReport = {
  site: { name: string; slug: string }
  pages: { file: string; path: string; title: string; sections: number }[]
  sections: SectionReport[]
  header: string
  footer: string
  media: { images: number; converted: string[]; missing: string[]; remote: string[] }
  documents: number
  fonts: { registered: string[]; dropped: string[] }
  removed: Record<string, number>
  notes: string[]
}
export type WebsiteImport = { archive: SiteArchive; report: WebsiteImportReport }

export async function importWebsite(options: WebsiteImportOptions): Promise<WebsiteImport> {
  const root = realpathSync(resolve(options.root))
  const publicDir = realpathSync(resolve(options.publicDir ?? options.root))
  const created = (options.now ?? new Date()).toISOString()
  const pageFiles = (
    options.pages ??
    readdirSync(root)
      .filter(file => /\.html?$/i.test(file))
      .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)))
  ).map(file => {
    const page = localWebsiteFile(resolve(root, file), [root], PAGE_EXTENSIONS)
    if (!page) throw new Error('Choose HTML pages inside the website folder.')
    return page
  })
  if (!pageFiles.length) throw new Error('No pages to import: the folder has no .html files.')
  const declared = options.domains ?? []
  const files = new SiteFiles(root, publicDir, created, declared)
  const removed: Record<string, number> = {}
  const notes: string[] = []
  const pages = pageFiles.map(file => readPage(file, root))
  for (const page of pages)
    for (const [what, count] of Object.entries(page.skipped)) removed[what] = (removed[what] ?? 0) + count
  const paths = new Set<string>()
  for (const page of pages) {
    let path = page.path
    let n = 2
    while (paths.has(path)) path = `${page.path}-${n++}`
    page.path = path
    paths.add(path)
  }
  const routes = new Map(pages.map(page => [page.file, page.path]))
  // A page that names its own address (canonical link, sharing URL) names the site's domain.
  for (const page of pages)
    for (const el of walk(page.document)) {
      const named =
        el.tagName === 'link' && /\bcanonical\b/i.test(attr(el, 'rel') ?? '')
          ? attr(el, 'href')
          : el.tagName === 'meta' && attr(el, 'property') === 'og:url'
            ? attr(el, 'content')
            : undefined
      const host = named ? /^https?:\/\/([^/:]+)/i.exec(named)?.[1] : undefined
      if (host) files.domains.add(host.toLowerCase().replace(/^www\./, ''))
    }

  const first = pages[0]!
  const pageStylesheet = createPageStylesheetReader(root, publicDir, files, removed, options.css ?? [])
  const registry = createWebsiteSectionRegistry({ files, routes, removed, notes, slug: options.slug, created })
  const { definitions, versions, sectionReports, defineSection } = registry

  const siteCss = pageStylesheet(first)
  const archivePages: SiteArchive['content']['pages'] = []
  const pageVersions: SiteArchive['content']['page_versions'] = []
  const pageReports: WebsiteImportReport['pages'] = []
  for (const [index, page] of pages.entries()) {
    const pageCss = page === first ? siteCss : pageStylesheet(page)
    const content = []
    for (const [position, node] of page.sections.entries()) {
      const heading = find(node, el => /^h[1-6]$/.test(el.tagName))
      // A name an editor recognises: the section's own heading, else its first words.
      const words = visibleText(node).replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ')
      const pictures = [...walk(node)].filter(el => el.tagName === 'img').length
      const label = (
        attr(node, 'data-cms-section') ||
        attr(node, 'aria-label') ||
        (heading ? textOf(heading).trim() : '') ||
        (words ? `${words}…` : '') ||
        attr(node, 'id') ||
        (pictures > 1 ? `${pictures} pictures` : `Section ${position + 1}`)
      )
        .replace(/\s+/g, ' ')
        .slice(0, 60)
      const section = defineSection(node, page, label, 'page', pageCss)
      if (section)
        content.push({
          section_def_id: section.id,
          section_def_version: 1,
          values: section.values,
          hidden: false,
          hidden_at: [],
          label: section.label,
        })
    }
    const pageId = randomUUID()
    const versionId = randomUUID()
    archivePages.push({
      id: pageId,
      revision: 1,
      draft_version_id: versionId,
      published_version_id: null,
      slug: page.path,
      title: page.title.replace(/\s*[|–—-]\s*[^|–—-]+$/, '').trim() || page.title,
      layout_mode: 'sections',
      status: 'draft',
      editor_label: '',
      sort_index: index,
      archived_at: null,
    })
    pageVersions.push({
      id: versionId,
      revision: 1,
      created_at: created,
      page_id: pageId,
      content,
      kind: 'checkpoint',
      meta: { title: page.title, description: page.description, noindex: false },
      note: 'Imported website',
      page_title: archivePages.at(-1)!.title,
      page_slug: page.path,
    })
    pageReports.push({
      file: relative(root, page.file),
      path: `/${page.path}`,
      title: archivePages.at(-1)!.title,
      sections: content.length,
    })
  }

  // The first page's header and footer stand for the site's.
  const frameOf = (kind: 'header' | 'footer') => {
    const node = first[kind]
    if (!node) return null
    const section = defineSection(node, first, kind === 'header' ? 'Site header' : 'Site footer', kind, siteCss)
    return section
      ? {
          schemaVersion: 2 as const,
          enabled: true,
          ...(kind === 'header' ? { sticky: false } : {}),
          component: { section_def_id: section.id, section_def_version: 1, values: section.values },
        }
      : null
  }
  const header = frameOf('header')
  const footer = frameOf('footer')
  if (!header) notes.push('No <header> was found; the site starts with the built-in header.')
  if (!footer) notes.push('No <footer> was found; the site starts with the built-in footer.')

  await files.processImages()
  if (files.droppedFonts.size)
    notes.push(
      'Fonts outside the governed registry are not carried over; the site uses its fallback fonts until a developer registers licensed font files.',
    )
  if (files.remote.size)
    notes.push(
      "Remote stylesheets, images and fonts are not loaded by published pages; download them into the site folder to import them. A full address on the site's own domain is read from the folder when the domain is named (--domain).",
    )
  if (files.unreadable.size)
    notes.push(`These stylesheets could not be read and were left out: ${[...files.unreadable].join(', ')}.`)
  if (files.unimported.size)
    notes.push(
      `Links lead to pages that were not imported: ${[...files.unimported].join(', ')}. Import them too, or publishing will ask about those links.`,
    )
  const headless = pageVersions
    .filter(
      version =>
        !version.content.some(section => {
          const definition = versions.find(row => row.section_def_id === section.section_def_id)
          return /<h1[\s>]/i.test(definition?.source_html ?? '') || JSON.stringify(section.values).includes('<h1')
        }),
    )
    .map(version => `/${version.page_slug}`)
  if (headless.length)
    notes.push(
      `Pages without a main heading (<h1>): ${headless.join(', ')}. Publishing asks for one, for readers and search engines. Change the page's first heading to <h1> in the source before importing, or afterwards in Section library → Edit section; until then an administrator can publish with a recorded reason.`,
    )

  const one = (headId = randomUUID(), versionId = randomUUID()) => ({
    id: headId,
    revision: 1,
    draft_version_id: versionId,
    published_version_id: null,
  })
  const theme = one()
  const settings = one()
  const navigation = one()
  const headerHead = one()
  const footerHead = one()
  // Checked in full by parseSiteArchive below; field values are JSON by construction.
  const content = {
    site: { name: options.name, slug: options.slug, kind: options.kind ?? 'general' },
    pages: archivePages,
    page_versions: pageVersions,
    themes: [theme],
    theme_versions: [
      {
        id: theme.draft_version_id,
        revision: 1,
        created_at: created,
        theme_id: theme.id,
        tokens: DEFAULT_THEME_TOKENS,
      },
    ],
    site_settings: [settings],
    site_setting_versions: [
      {
        id: settings.draft_version_id,
        revision: 1,
        created_at: created,
        site_settings_id: settings.id,
        settings: { name: options.name },
      },
    ],
    navigations: [{ ...navigation, mode: 'manual' }],
    navigation_versions: [
      {
        id: navigation.draft_version_id,
        revision: 1,
        created_at: created,
        navigation_id: navigation.id,
        tree: registry.navigation,
      },
    ],
    global_elements: [
      { ...headerHead, kind: 'header', use_on_live: true },
      { ...footerHead, kind: 'footer', use_on_live: true },
    ],
    global_element_versions: [
      {
        id: headerHead.draft_version_id,
        revision: 1,
        created_at: created,
        global_element_id: headerHead.id,
        content: header ?? {
          ...DEFAULT_HEADER_CONFIG_V1,
          brand: { ...DEFAULT_HEADER_CONFIG_V1.brand, siteName: options.name },
        },
      },
      {
        id: footerHead.draft_version_id,
        revision: 1,
        created_at: created,
        global_element_id: footerHead.id,
        content: footer ?? {
          ...DEFAULT_FOOTER_CONFIG_V1,
          brand: { ...DEFAULT_FOOTER_CONFIG_V1.brand, siteName: options.name },
        },
      },
    ],
    section_defs: definitions,
    section_def_versions: versions,
    collections: [],
    collection_schema_versions: [],
    collection_entries: [],
    collection_entry_versions: [],
    site_assets: files.assets,
    document_metadata: files.assets
      .filter(asset => asset.kind === 'document')
      .map(asset => ({ asset_id: asset.id, category: 'Imported', archived: false })),
    media: files.media,
    media_variants: files.variants,
  } as unknown as SiteArchive['content']
  const archive = parseSiteArchive({
    format: SITE_ARCHIVE_FORMAT,
    version: SITE_ARCHIVE_VERSION,
    exported_at: created,
    content,
    objects: files.objects,
  })
  return {
    archive,
    report: {
      site: { name: options.name, slug: options.slug },
      pages: pageReports,
      sections: sectionReports,
      header: header ? 'imported as the site header' : 'not found',
      footer: footer ? 'imported as the site footer' : 'not found',
      media: {
        images: files.media.length,
        converted: files.converted,
        missing: [...files.missing],
        remote: [...files.remote],
      },
      documents: files.assets.filter(asset => asset.kind === 'document').length,
      fonts: { registered: [...files.registeredFonts], dropped: [...files.droppedFonts] },
      removed,
      notes,
    },
  }
}

/** The report as Markdown, for a person deciding whether the draft is ready. */
export function websiteReportMarkdown(report: WebsiteImportReport): string {
  const lines = [
    `# Import report: ${report.site.name}`,
    '',
    `${report.pages.length} pages, ${report.sections.length} sections, ${report.media.images} images, ${report.documents} documents.`,
    '',
    '## Pages',
    '',
    '| File | Address | Title | Sections |',
    '| --- | --- | --- | --- |',
    ...report.pages.map(page => `| ${page.file} | ${page.path} | ${page.title} | ${page.sections} |`),
    '',
    '## Sections',
    '',
    '| Page | Section | Editable fields | How | Notes |',
    '| --- | --- | --- | --- | --- |',
    ...report.sections.map(
      section =>
        `| ${section.page} | ${section.label} | ${section.fields} | ${section.reused ? 'shared with an earlier page' : section.mode} | ${section.problems.slice(0, 3).join('; ').replace(/\|/g, '/')} |`,
    ),
    '',
    `Header: ${report.header}. Footer: ${report.footer}.`,
    '',
    '## Left out',
    '',
    ...Object.entries(report.removed).map(([what, count]) => `- ${what}: ${count}`),
    ...(report.fonts.dropped.length ? [`- fonts not in the registry: ${report.fonts.dropped.join(', ')}`] : []),
    ...(report.media.missing.length ? [`- images that could not be read: ${report.media.missing.join(', ')}`] : []),
    ...(report.media.remote.length
      ? [
          `- remote files: ${report.media.remote.slice(0, 20).join(', ')}${report.media.remote.length > 20 ? ', …' : ''}`,
        ]
      : []),
    '',
    ...report.notes.map(note => `- ${note}`),
  ]
  return `${lines.join('\n')}\n`
}
