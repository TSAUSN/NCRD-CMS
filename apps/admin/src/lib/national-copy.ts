import { createHash } from 'node:crypto'
import { DomainError } from '@cms/domain'
import {
  MAX_SITE_ARCHIVE_BYTES,
  SITE_ARCHIVE_FORMAT,
  SITE_ARCHIVE_VERSION,
  markSampleValues,
  sectionStartingValues,
  repeatItemSpec,
  repeatItemKeys,
  repeatItemSlotId,
  sourceSampleValue,
  type SlotDef,
  type SiteArchive,
  ThemeTokens,
} from '@cms/schema'
import { type Queryable, type MediaStore } from '@cms/platform'
import { nationalTemplateTheme } from '@cms/seeds/core-themes'
import { echelonSiteSetup } from '@cms/seeds/echelon-site'
import { importSiteArchiveInTransaction, importedId } from './site-portability.ts'
import { createSiteFromSetupInTransaction, stagingHostnameFor } from './site-creation.ts'
import { nationalTemplateSites } from './national-template.ts'

/** Keep the layout and item count while replacing editable words/photos with samples. */
function sampleLayoutValues(slots: SlotDef[], source: Record<string, unknown>) {
  const values = sectionStartingValues(slots)
  for (const slot of slots) {
    const spec = repeatItemSpec(slot)
    if (spec) {
      const keys = repeatItemKeys(source[slot.id], spec.max)
      for (const id of Object.keys(values)) if (id.startsWith(slot.id + '__')) delete values[id]
      values[slot.id] = { items: keys }
      keys.forEach((key, index) => {
        for (const field of spec.fields) {
          const sample = sourceSampleValue(field, spec.samples[index]?.[field.id] ?? spec.samples[0]?.[field.id])
          values[repeatItemSlotId(slot.id, key, field.id)] = sample ?? sectionStartingValues([field])[field.id] ?? ''
        }
      })
    } else if (
      slot.kind === 'repeat' &&
      source[slot.id] &&
      typeof source[slot.id] === 'object' &&
      'readerKey' in (source[slot.id] as object)
    )
      values[slot.id] = structuredClone(source[slot.id])
  }
  const marked = markSampleValues(values)
  for (const [key, value] of Object.entries(source))
    if (key.startsWith('__cms_') && !key.startsWith('__cms_sample')) marked[key] = value
  return marked
}

/** Copy choices transform content before the existing guarded import command. */
export function nationalCopyContent(input: SiteArchive, bringWords: boolean, bringStories: boolean): SiteArchive {
  const archive = structuredClone(input),
    c = archive.content
  // A new site starts from active pages. Backups still retain archived pages.
  c.pages = c.pages.filter(page => page.archived_at === null && page.status !== 'archived')
  const activePages = new Set(c.pages.map(page => page.id))
  c.page_versions = c.page_versions.filter(version => activePages.has(version.page_id))
  for (const page of c.pages)
    if (page.parent_page_id && !activePages.has(page.parent_page_id)) page.parent_page_id = null
  const storyLists = new Set(c.collections.filter(list => list.reader_key === 'stories').map(list => list.id))
  const storyPaths = new Set(
    c.collection_entry_versions
      .filter(v => storyLists.has(v.collection_id))
      .flatMap(v =>
        typeof v.values.story_url === 'string'
          ? [new URL(v.values.story_url, 'https://local.invalid').pathname.replace(/^\//, '')]
          : [],
      ),
  )
  const storyPages = new Set(c.pages.filter(page => storyPaths.has(page.slug)).map(page => page.id))
  if (!bringStories) {
    c.pages = c.pages.filter(page => !storyPages.has(page.id))
    c.page_versions = c.page_versions.filter(v => !storyPages.has(v.page_id))
  }
  const removed = new Set(
    input.content.pages.filter(page => !c.pages.some(next => next.id === page.id)).map(page => page.id),
  )
  function prune(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(prune).filter(value => value !== undefined)
    if (!value || typeof value !== 'object') return value
    const obj = value as Record<string, unknown>,
      target = obj.target as { type?: unknown; page_id?: unknown } | undefined
    if (target?.type === 'page' && typeof target.page_id === 'string' && removed.has(target.page_id)) return undefined
    return Object.fromEntries(
      Object.entries(obj)
        .map(([key, value]) => [key, prune(value)])
        .filter(([, value]) => value !== undefined),
    )
  }
  for (const v of c.navigation_versions) v.tree = prune(v.tree) as typeof v.tree
  for (const v of c.global_element_versions) v.content = prune(v.content) as typeof v.content
  const emptyLists = new Set(
    c.collections.filter(list => (list.reader_key === 'stories' ? !bringStories : !bringWords)).map(list => list.id),
  )
  c.collection_entries = c.collection_entries.filter(row => !emptyLists.has(row.collection_id))
  c.collection_entry_versions = c.collection_entry_versions.filter(row => !emptyLists.has(row.collection_id))
  for (const list of c.collections)
    if (emptyLists.has(list.id)) {
      list.entry_revision = 0
      list.published_entry_revision = 0
    }
  if (!bringWords) {
    const definitions = new Map(c.section_def_versions.map(def => [def.section_def_id + '@' + def.version, def]))
    for (const version of c.global_element_versions) {
      const config = version.content as {
        kind?: string
        component?: { section_def_id: string; section_def_version: number; values: Record<string, unknown> }
      }
      if (config.kind === 'component' && config.component) {
        const slots = definitions.get(
          config.component.section_def_id + '@' + config.component.section_def_version,
        )?.slots
        if (slots) config.component.values = sampleLayoutValues(slots, config.component.values)
      }
    }
    for (const version of c.page_versions) {
      if (bringStories && storyPages.has(version.page_id)) continue
      version.content = version.content.map(section => {
        const slots = definitions.get(section.section_def_id + '@' + section.section_def_version)?.slots
        if (!slots) throw new DomainError('invalid_state', 'A copied section is unavailable.')
        const values = sampleLayoutValues(slots, section.values)
        for (const [key, value] of Object.entries(section.values))
          if (key.startsWith('__cms_') && !key.startsWith('__cms_sample')) values[key] = value
        return { ...section, values }
      })
      version.meta = { title: version.page_title, noindex: false }
      version.note = 'Created with labelled sample content'
    }
  }
  // Saved template sets come from the shared library, not copied local recipes.
  c.page_recipes = []
  c.page_recipe_versions = []
  for (const definition of c.section_defs) if (definition.scope === 'global') definition.status = 'hidden'
  // Copy only assets still used by the chosen content, including governed file aliases.
  const references = JSON.stringify([
    c.page_versions,
    c.global_element_versions,
    c.theme_versions,
    c.site_setting_versions,
    c.navigation_versions,
    c.collection_entry_versions,
    c.collection_schema_versions,
    c.section_def_versions,
    c.site_file_versions,
  ])
  const used = new Set(
    references.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)?.map(id => id.toLowerCase()) ??
      [],
  )
  c.media = c.media.filter(row => used.has(row.id))
  c.media_variants = c.media_variants.filter(row => used.has(row.media_id))
  if (c.site_assets) c.site_assets = c.site_assets.filter(row => row.kind === 'font' || used.has(row.id))
  if (c.document_metadata) c.document_metadata = c.document_metadata.filter(row => used.has(row.asset_id))
  const objectIds = new Set([
    ...c.media.map(row => row.id),
    ...(c.site_assets?.map(row => row.id) ?? []),
    ...(c.site_files?.map(row => row.id) ?? []),
  ])
  archive.objects = archive.objects.filter(object => objectIds.has(object.media_id))
  const latest = c.themes[0]?.draft_version_id
  for (const theme of c.theme_versions) {
    const current = ThemeTokens.parse(theme.tokens)
    theme.tokens = nationalTemplateTheme(current.fonts, current.presentation?.headings === 'small-caps')
  }
  if (!latest) throw new DomainError('invalid_state', 'The source site has no saved look.')
  return archive
}
export async function startNationalSite(
  client: Queryable,
  requestId: string,
  input: {
    name: string
    slug: string
    source: 'copy' | 'templates' | 'home'
    sourceSiteId?: string
    bringWords: boolean
    bringStories: boolean
  },
  media: MediaStore,
) {
  const allowed = await nationalTemplateSites(client) // reauthorize as Super admin
  const hostname = stagingHostnameFor(input.slug)
  if (!hostname) throw new DomainError('invalid_state', 'The private site address is unavailable.')
  if (input.source !== 'copy') {
    const setup = echelonSiteSetup()
    setup.name = input.name
    setup.slug = input.slug
    setup.pages =
      input.source === 'home'
        ? [
            {
              slug: '',
              title: 'Home',
              layout: 'content',
              template: 'landing',
              intro: '',
              body: '',
              menu: true,
              nested: false,
              footer: false,
            },
          ]
        : [
            {
              slug: '',
              title: 'Home',
              layout: 'content',
              template: 'echelon-home',
              intro: '',
              body: '',
              menu: true,
              nested: false,
              footer: false,
            },
            {
              slug: 'chapter',
              title: 'Chapter',
              layout: 'content',
              template: 'chapter',
              intro: '',
              body: '',
              menu: true,
              nested: false,
              footer: false,
            },
          ]
    const prior = (await client.query('SELECT id FROM sites WHERE creation_request_id=$1', [requestId])).rows[0]
    const result = await createSiteFromSetupInTransaction(client, requestId, setup, hostname)
    if (prior) return result
    if (!input.bringWords) {
      const pages = (
        await client.query(
          'SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1',
          [result.siteId],
        )
      ).rows
      for (const page of pages) {
        const content = []
        for (const section of page.content) {
          const def = (
            await client.query('SELECT slots FROM section_def_versions WHERE section_def_id=$1 AND version=$2', [
              section.section_def_id,
              section.section_def_version,
            ])
          ).rows[0]!
          content.push({ ...section, values: sampleLayoutValues(def.slots, section.values) })
        }
        await client.query('SELECT app.save_page_draft($1,$2,$3,$4,$5,$6)', [
          page.id,
          page.revision,
          JSON.stringify(content),
          JSON.stringify(page.meta),
          'checkpoint',
          'Created with labelled sample content',
        ])
      }
    }
    return result
  }
  if (!allowed.some(site => site.id === input.sourceSiteId))
    throw new DomainError('not_found', 'Choose a site that uses the national template.')
  const exported = (
    await client.query<{
      archive: {
        content: SiteArchive['content']
        objects: {
          media_id: string
          kind: SiteArchive['objects'][number]['kind']
          object_key: string
          sha256: string
        }[]
      }
    }>('SELECT app.export_site_content($1) AS archive', [input.sourceSiteId])
  ).rows[0]!.archive
  const source: SiteArchive = {
      format: SITE_ARCHIVE_FORMAT,
      version: SITE_ARCHIVE_VERSION,
      exported_at: new Date().toISOString(),
      content: exported.content,
      objects: [],
    },
    copy = nationalCopyContent(source, input.bringWords, input.bringStories)
  const objectIds = new Set([
    ...copy.content.media.map(row => row.id),
    ...(copy.content.site_assets?.map(row => row.id) ?? []),
    ...(copy.content.site_files?.map(row => row.id) ?? []),
  ])
  let bytes = Buffer.byteLength(JSON.stringify(copy))
  for (const object of exported.objects) {
    if (!objectIds.has(object.media_id)) continue
    const data = await media.get(object.object_key)
    if (!data || createHash('sha256').update(data).digest('hex') !== object.sha256)
      throw new DomainError(
        'invalid_state',
        'A photo or file in the source site is unavailable. Recover it before copying the site.',
      )
    bytes += Math.ceil(data.byteLength / 3) * 4 + 200
    if (bytes > MAX_SITE_ARCHIVE_BYTES)
      throw new DomainError(
        'invalid_state',
        'This site is too large to copy with all its content. Turn off words or stories, or start from page templates.',
      )
    copy.objects.push({
      media_id: object.media_id,
      kind: object.kind,
      sha256: object.sha256,
      base64: Buffer.from(data).toString('base64'),
    })
  }
  const portable = structuredClone(copy),
    globalIds = new Set(source.content.section_defs.filter(def => def.scope === 'global').map(def => def.id))
  // The portable importer isolates definitions and cannot apply global-library
  // layout controls to those temporary copies. Restore them after repinning,
  // within this same private transaction; the source and public pages stay intact.
  for (const version of portable.content.page_versions)
    for (const section of version.content) if (globalIds.has(section.section_def_id)) delete section.appearance
  const siteId = await importSiteArchiveInTransaction(
    client,
    requestId,
    { name: input.name, slug: input.slug },
    portable,
    media,
  )
  // Same-installation copies keep using the parent's global sections. The
  // portable importer isolates its source, so repin current drafts normally.
  const globals = new Map(
    source.content.section_defs
      .filter(def => def.scope === 'global')
      .map(def => [importedId(requestId, def.id), def.id]),
  )
  const pages = (
    await client.query(
      'SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.archived_at IS NULL',
      [siteId],
    )
  ).rows
  for (const page of pages) {
    const sourcePage = copy.content.pages.find(sourcePage => importedId(requestId, sourcePage.id) === page.id),
      sourceVersion = copy.content.page_versions.find(version => version.id === sourcePage?.draft_version_id)
    const content = page.content.map((section: { section_def_id: string }, index: number) =>
      globals.has(section.section_def_id)
        ? {
            ...section,
            section_def_id: globals.get(section.section_def_id),
            ...(sourceVersion?.content[index]?.appearance
              ? { appearance: sourceVersion.content[index]!.appearance }
              : {}),
          }
        : section,
    )
    if (JSON.stringify(content) !== JSON.stringify(page.content))
      await client.query('SELECT app.save_page_draft($1,$2,$3,$4,$5,$6)', [
        page.id,
        page.revision,
        JSON.stringify(content),
        JSON.stringify(page.meta),
        'checkpoint',
        'Connected to shared national sections',
      ])
  }
  return { siteId, hostname }
}
