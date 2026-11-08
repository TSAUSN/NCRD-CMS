import { randomUUID } from 'node:crypto'
import {
  DEFAULT_THEME_TOKENS,
  DEFAULT_HEADER_CONFIG_V1,
  DEFAULT_FOOTER_CONFIG_V1,
  parseSiteArchive,
  type SiteArchive,
  type SiteFileBundle,
} from '@cms/schema'

type FrameComponent = {
  section_def_id: string
  section_def_version: number
  values: Record<string, unknown>
}

type PageArchive = {
  created: string
  slug: string
  pageSlug: string
  pageId: string
  title: string
  originalTitle: string
  description: string
  quirks: boolean
  html: Record<string, string>
  body: Record<string, string>
  header?: FrameComponent
  footer?: FrameComponent
  files: NonNullable<SiteArchive['content']['site_files']>
  objects: SiteArchive['objects']
  styles: SiteFileBundle['styles']
  scripts: SiteFileBundle['scripts']
  paths: NonNullable<SiteFileBundle['paths']>
  definitions: SiteArchive['content']['section_defs']
  versions: SiteArchive['content']['section_def_versions']
  content: SiteArchive['content']['page_versions'][number]['content']
}

export function assembleBetterTogetherArchive({
  created,
  slug,
  pageSlug,
  pageId,
  title,
  originalTitle,
  description,
  quirks,
  html,
  body,
  header,
  footer,
  files,
  objects,
  styles,
  scripts,
  paths,
  definitions,
  versions,
  content,
}: PageArchive) {
  const one = () => ({ id: randomUUID(), revision: 1, draft_version_id: randomUUID(), published_version_id: null }),
    pageVersion = randomUUID(),
    theme = one(),
    settings = one(),
    navigation = one(),
    head = one(),
    foot = one(),
    fileVersion = randomUUID()
  const bundle: SiteFileBundle = {
    version: 1,
    files: files.map(file => file.id),
    scripts,
    styles,
    paths,
    original: {
      version: 1,
      definitions: definitions.map(def => ({ section_def_id: def.id, section_def_version: 1 })),
      pages: [
        {
          pageId,
          ...(quirks ? { quirks: true } : {}),
          html,
          body,
          header: !!header,
          footer: !!footer,
        },
      ],
    },
  }
  return parseSiteArchive({
    format: 'cms-site-content',
    version: 1,
    exported_at: created,
    objects,
    content: {
      site: { name: 'Better Together 2027', slug, kind: 'conference' },
      pages: [
        {
          id: pageId,
          revision: 1,
          draft_version_id: pageVersion,
          published_version_id: null,
          slug: pageSlug,
          title,
          layout_mode: 'sections',
          status: 'draft',
          editor_label: '',
          sort_index: 0,
          archived_at: null,
        },
      ],
      page_versions: [
        {
          id: pageVersion,
          revision: 1,
          created_at: created,
          page_id: pageId,
          content,
          meta: { title: originalTitle, description, noindex: false },
          kind: 'checkpoint',
          note: 'Original local homepage',
          page_title: title,
          page_slug: pageSlug,
        },
      ],
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
          settings: { name: 'Better Together 2027' },
        },
      ],
      navigations: [{ ...navigation, mode: 'manual' }],
      navigation_versions: [
        { id: navigation.draft_version_id, revision: 1, created_at: created, navigation_id: navigation.id, tree: [] },
      ],
      global_elements: [
        { ...head, kind: 'header', use_on_live: true },
        { ...foot, kind: 'footer', use_on_live: true },
      ],
      global_element_versions: [
        {
          id: head.draft_version_id,
          revision: 1,
          created_at: created,
          global_element_id: head.id,
          content: header
            ? { schemaVersion: 2, enabled: true, sticky: false, component: header }
            : { ...DEFAULT_HEADER_CONFIG_V1, enabled: false },
        },
        {
          id: foot.draft_version_id,
          revision: 1,
          created_at: created,
          global_element_id: foot.id,
          content: footer
            ? { schemaVersion: 2, enabled: true, component: footer }
            : { ...DEFAULT_FOOTER_CONFIG_V1, enabled: false },
        },
      ],
      section_defs: definitions,
      section_def_versions: versions,
      collections: [],
      collection_schema_versions: [],
      collection_entries: [],
      collection_entry_versions: [],
      media: [],
      media_variants: [],
      site_files: files,
      site_file_versions: [{ id: fileVersion, version: 1, bundle, reviewed_at: created }],
      site_file_heads: [{ revision: 1, draft_version_id: fileVersion, published_version_id: null }],
    },
  })
}
