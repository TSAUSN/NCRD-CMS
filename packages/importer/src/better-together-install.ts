import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { SiteFileBundle, parseSiteArchive, type SiteArchive, type SiteFileView } from '@cms/schema'
import { registerReviewedSiteFile } from '../../platform/src/site-files.ts'
import type { MediaStore } from '../../platform/src/ports.ts'
import type { Queryable } from '../../platform/src/publication.ts'

/** Merge page-specific ordered bindings without changing either page's order.
 * Shared files may have different neighbours; a cycle is refused, never guessed. */
export function mergeBetterTogetherBindings<T extends { fileId: string; pages: string[] }>(left: T[], right: T[]): T[] {
  const rows = [...left, ...right]
  const key = (row: T) => JSON.stringify({ ...row, pages: [] })
  const items = new Map<string, T>()
  const edges = new Map<string, Set<string>>()
  for (const row of rows) {
    const id = key(row)
    const old = items.get(id)
    items.set(id, {
      ...row,
      pages: old
        ? !old.pages.length || !row.pages.length
          ? []
          : [...new Set([...old.pages, ...row.pages])]
        : [...row.pages],
    })
    if (!edges.has(id)) edges.set(id, new Set())
  }
  const pages = new Set(rows.flatMap(row => row.pages))
  pages.add('*')
  for (const source of [left, right])
    for (const page of pages) {
      const active = source.filter(row => !row.pages.length || row.pages.includes(page)).map(key)
      for (let i = 1; i < active.length; i++)
        if (active[i - 1] !== active[i]) edges.get(active[i - 1]!)!.add(active[i]!)
    }
  const result: T[] = []
  const pending = new Set(items.keys())
  while (pending.size) {
    const next = [...pending].find(id => ![...pending].some(other => edges.get(other)!.has(id)))
    if (!next) throw new Error('The original file loading orders conflict. Keep those files separately named.')
    result.push(items.get(next)!)
    pending.delete(next)
  }
  return result
}

/** Add missing BT marketing pages only. Existing drafts are never replaced.
 * The caller owns a Super Admin transaction and an explicit file/layout review.
 * All writes use the existing narrow app commands; ordinary release follows. */
export async function installBetterTogetherPages(input: {
  client: Queryable
  store: MediaStore
  siteId: string
  archives: SiteArchive[]
  reviewed: boolean
}) {
  const { client, store, siteId } = input
  if (!input.reviewed) throw new Error('Review each original page, file, size and source before installation.')
  const actor = (await client.query('SELECT app.is_super_admin() AS allowed')).rows[0]
  if (!actor?.allowed) throw new Error('Only a Super Admin can install reviewed original pages.')
  await client.query('SELECT app.lock_release_site($1)', [siteId])
  const head = (
    await client.query(
      'SELECT h.revision,v.bundle FROM site_file_heads h JOIN site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
      [siteId],
    )
  ).rows[0]
  if (!head?.bundle?.original)
    throw new Error('Install the reviewed BT2027 homepage before adding its marketing pages.')
  let bundle = SiteFileBundle.parse(head.bundle)
  const receipts = (
    await client.query('SELECT id,kind,name,source,sha256,bytes FROM site_files WHERE site_id=$1', [siteId])
  ).rows as SiteFileView[]
  const fingerprint = (file: Pick<SiteFileView, 'kind' | 'name' | 'source' | 'sha256'>) =>
    JSON.stringify([file.kind, file.name, file.source, file.sha256])
  const savedFiles = new Map(receipts.map(file => [fingerprint(file), file.id]))
  const created: { id: string; slug: string; title: string }[] = []
  const existing: string[] = []
  for (const value of input.archives) {
    const archive = parseSiteArchive(value)
    const page = archive.content.pages[0]!
    const pageVersion = archive.content.page_versions[0]!
    if (
      archive.content.pages.length !== 1 ||
      ![
        'exhibitors',
        'hotel-information',
        'kansas-city',
        'sponsorship',
        'registration-faqs',
        'privacy-policy',
        'manifesto',
        'workshops',
      ].includes(page.slug)
    )
      throw new Error('Choose one of the eight BT2027 marketing pages.')
    if ((await client.query('SELECT id FROM pages WHERE site_id=$1 AND slug=$2', [siteId, page.slug])).rows.length) {
      existing.push(page.slug)
      continue
    }
    const id = String(
      (await client.query('SELECT app.create_page($1,$2,$3) AS id', [siteId, page.slug, page.title])).rows[0]!.id,
    )
    const ids = new Map<string, string>([[page.id, id]])
    for (const file of archive.content.site_files ?? []) {
      const key = fingerprint(file)
      let saved = savedFiles.get(key)
      if (!saved) {
        const object = archive.objects.find(object => object.media_id === file.id && object.kind === 'site-file')
        if (!object) throw new Error('A reviewed file has no exact bytes.')
        const bytes = Buffer.from(object.base64, 'base64')
        const receipt = await registerReviewedSiteFile({
          client,
          store,
          siteId,
          kind: file.kind,
          name: file.name,
          source: file.source,
          bytes,
        })
        if (receipt.sha256 !== file.sha256 || receipt.bytes !== file.bytes)
          throw new Error('The reviewed page file changed.')
        saved = receipt.id
        savedFiles.set(key, saved)
      }
      ids.set(file.id, saved)
    }
    for (const definition of archive.content.section_defs) {
      const version = archive.content.section_def_versions.find(version => version.section_def_id === definition.id)!
      const slug = definition.slug
      const compiled = compileSection({
        sourceHtml: version.source_html,
        sourceCss: version.source_css,
        slots: version.slots,
        scopeSelector: sectionScopeSelector(slug)!,
      })
      if (compiled.blocking.length || compiled.carriesTrustedCode)
        throw new Error('Revalidate the original section before installing it.')
      const saved = (
        await client.query(
          'SELECT section_def_id,version FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
          [
            slug,
            definition.name.slice(0, 200),
            'Better Together',
            version.source_html,
            '',
            compiled.css,
            JSON.stringify(compiled.ast),
            JSON.stringify(version.slots),
            compiled.renderHash,
            compiled.ast.policyVersion,
            compiled.ast.cssPolicyVersion,
            'Original offline BT2027 marketing page; reviewed files carry behavior.',
            false,
            'legacy',
            null,
            null,
            'site',
            siteId,
          ],
        )
      ).rows[0]!
      if (Number(saved.version) !== 1)
        throw new Error('An existing layout uses this name. Preserve it and choose a new import name.')
      ids.set(definition.id, String(saved.section_def_id))
    }
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3,$4,$5)', [
      id,
      JSON.stringify(
        pageVersion.content.map(section => ({ ...section, section_def_id: ids.get(section.section_def_id)! })),
      ),
      JSON.stringify(pageVersion.meta),
      'checkpoint',
      'Original offline BT2027 marketing page',
    ])
    const files = archive.content.site_file_versions![0]!.bundle
    const map = (value: string) => {
      const result = ids.get(value)
      if (!result) throw new Error('A reviewed identity is missing.')
      return result
    }
    const paths = [...(bundle.paths ?? [])]
    for (const path of files.paths ?? []) {
      const fileId = map(path.fileId)
      const prior = paths.find(row => row.path === path.path)
      if (prior && prior.fileId !== fileId) throw new Error('Two different reviewed files use ' + path.path)
      if (!prior) paths.push({ ...path, fileId })
    }
    bundle = SiteFileBundle.parse({
      ...bundle,
      files: [...new Set([...bundle.files, ...files.files.map(map)])],
      paths,
      scripts: mergeBetterTogetherBindings(
        bundle.scripts,
        files.scripts.map(row => ({ ...row, fileId: map(row.fileId), pages: row.pages.map(map) })),
      ),
      styles: mergeBetterTogetherBindings(
        bundle.styles,
        files.styles.map(row => ({ ...row, fileId: map(row.fileId), pages: row.pages.map(map) })),
      ),
      original: {
        version: 1,
        definitions: [
          ...bundle.original!.definitions,
          ...files.original!.definitions.map(pin => ({ ...pin, section_def_id: map(pin.section_def_id) })),
        ],
        pages: [
          ...bundle.original!.pages,
          ...files.original!.pages.map(page => ({ ...page, pageId: map(page.pageId) })),
        ],
      },
    })
    created.push({ id, slug: page.slug, title: page.title })
  }
  if (created.length)
    await client.query('SELECT * FROM app.save_site_file_bundle($1,$2,$3)', [
      siteId,
      head.revision,
      JSON.stringify(bundle),
    ])
  return { created, existing, files: bundle.files.length, scripts: bundle.scripts.length, styles: bundle.styles.length }
}
