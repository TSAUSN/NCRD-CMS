import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { asUser, type MediaStore } from '@cms/platform'
import type { SectionInstance } from '@cms/schema'
import type { DemoPhoto } from './sawso-demo.ts'
import { corePageDefinitions } from './core-pages.ts'
import { releaseCandidates } from './releases.ts'
import { sawsoSection, sawsoMediaPhoto, type SawsoMediaMap } from './sawso-pages.ts'
import {
  createPostgresAdminMediaUploadRepository,
  createPostgresMediaUploadStatusRepository,
} from './media-upload-repository.ts'

export type SawsoOwnerContent = {
  format: 'sawso-owner-content-v1'
  review: string
  stories: { key: string; title: string; body: string; problem?: string; sourceKind: string; url: string }[]
  team: { name: string; role: string; body: string; image: string }[]
  reports: { title: string; body: string; image: string; url: string; label: string }[]
  financial: { body: string; source: string }
  illustration: { source: string; alt: string } | null
  privacy: string
}
const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Explicit owner capture import, through the usual Media and versioned commands.
 * It never fetches a live URL or overwrites an author's unpublished work. */
export async function applySawsoOwnerContent(
  userId: string,
  content: SawsoOwnerContent,
  photos: DemoPhoto[],
  media: MediaStore,
  processUpload: (id: string) => Promise<void>,
) {
  if (
    content.format !== 'sawso-owner-content-v1' ||
    content.stories.length !== 34 ||
    content.privacy !== 'https://www.salvationarmyusa.org/usn/privacypolicy'
  )
    throw Error('Review the owner content capture before importing it.')
  const site = await asUser(
    { userId },
    async c => (await c.query("SELECT id FROM sites WHERE slug='sawso' AND archived_at IS NULL")).rows[0],
  )
  if (!site) throw Error('Start the existing SAWSO demo first.')
  const local: SawsoMediaMap = {}
  const uploads = createPostgresAdminMediaUploadRepository()
  const statuses = createPostgresMediaUploadStatusRepository()
  const mediaProblems: { source: string; problem: string }[] = []
  for (const photo of photos) {
    try {
      const found = await asUser(
        { userId },
        async c =>
          (
            await c.query(
              "SELECT id,alt_text,focal FROM media WHERE site_id=$1 AND source=$2 AND status='ready' AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
              [site.id, photo.source],
            )
          ).rows[0],
      )
      if (found) {
        local[photo.source] = found
        continue
      }
      const bytes = Buffer.from(photo.base64, 'base64')
      if (
        bytes.toString('base64') !== photo.base64 ||
        createHash('sha256').update(bytes).digest('hex') !== photo.content_hash
      )
        throw Error('The captured image checksum changed.')
      const upload = await uploads.begin(userId, {
        siteId: site.id,
        originalName: photo.original_name,
        declaredMime: photo.mime_type,
        declaredBytes: bytes.length,
        altText: photo.alt_text,
        decorative: false,
        focal: photo.focal,
        folder: 'SAWSO reviewed-source content',
        attribution: photo.attribution,
        source: photo.source,
        tags: photo.tags,
      })
      const receipt = await uploads.claimReceipt(upload.intentId, upload.uploadToken)
      if (!receipt) throw Error('The normal Media upload receipt is unavailable.')
      await media.put(receipt.uploadObjectKey, bytes, photo.mime_type)
      await uploads.markReceived(receipt, photo.mime_type, bytes.length)
      await processUpload(upload.intentId)
      const state = await statuses.read(userId, upload.intentId)
      if (state?.status !== 'ready' || !state.asset) throw Error('Normal Media processing did not finish.')
      local[photo.source] = {
        id: state.asset.id,
        alt_text: state.asset.altText,
        focal: state.asset.focal ?? photo.focal,
      }
    } catch (error) {
      mediaProblems.push({ source: photo.source, problem: error instanceof Error ? error.message : String(error) })
    }
  }
  return asUser({ userId }, async c => {
    const protectedRows = (
      await c.query(
        "SELECT p.id,p.slug,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.archived_at IS NULL AND (p.slug='ways-we-help' OR p.slug LIKE 'ways-we-help/%') ORDER BY p.slug",
        [site.id],
      )
    ).rows
    if (protectedRows.length !== 9) throw Error('The nine approved ministry/hub pages must already exist.')
    const protectedHash = hash(protectedRows)
    const collection = (
      await c.query(
        "SELECT id,entry_revision,published_entry_revision,draft_schema_version_id,published_schema_version_id FROM collections WHERE site_id=$1 AND reader_key='stories'",
        [site.id],
      )
    ).rows[0]
    const entries = (
      await c.query(
        'SELECT e.id,e.stable_key,e.draft_version_id,e.published_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.id',
        [collection.id],
      )
    ).rows
    const releaseKeys = new Set<string>()
    const collectionPrivate =
      collection.entry_revision !== collection.published_entry_revision ||
      collection.draft_schema_version_id !== collection.published_schema_version_id
    const changedStories: string[] = []
    const skippedStories: { title: string; reason: string }[] = []
    const rows = entries.map(entry => {
      const captured = content.stories.find(s => s.key === entry.stable_key)
      if (collectionPrivate) {
        skippedStories.push({ title: entry.values.title, reason: 'Preserved the list’s existing unpublished work.' })
        return { id: entry.id, stableKey: entry.stable_key, values: entry.values }
      }
      if (!captured || captured.problem || !captured.body.trim()) {
        skippedStories.push({ title: entry.values.title, reason: captured?.problem ?? 'No captured article text.' })
        return { id: entry.id, stableKey: entry.stable_key, values: entry.values }
      }
      if (captured.body.length > 100000) {
        skippedStories.push({
          title: entry.values.title,
          reason: 'The full captured article exceeds the 100,000-character rich-text field; no text was truncated.',
        })
        return { id: entry.id, stableKey: entry.stable_key, values: entry.values }
      }
      if (entry.values.title !== captured.title)
        throw Error('The captured story title no longer matches the owned list.')
      if (entry.values.body === captured.body && !entry.values.body_is_sample)
        return { id: entry.id, stableKey: entry.stable_key, values: entry.values }
      if (
        entry.draft_version_id !== entry.published_version_id ||
        (entry.values.body && !entry.values.body_is_sample)
      ) {
        skippedStories.push({
          title: entry.values.title,
          reason: 'Preserved existing authored text or unpublished work.',
        })
        return { id: entry.id, stableKey: entry.stable_key, values: entry.values }
      }
      changedStories.push(captured.title)
      return {
        id: entry.id,
        stableKey: entry.stable_key,
        values: { ...entry.values, body: captured.body, body_is_sample: false },
      }
    })
    if (changedStories.length) {
      await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        collection.id,
        collection.entry_revision,
        JSON.stringify(rows),
      ])
      releaseKeys.add('collection_entries:' + collection.id)
    }
    const defs = await corePageDefinitions(c)
    const pages: string[] = []
    const skippedPages: string[] = []
    async function save(slug: string, sections: SectionInstance[]) {
      const old = (
        await c.query(
          'SELECT p.id,p.revision,p.draft_version_id,p.published_version_id,v.note,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug=$2 AND p.archived_at IS NULL FOR UPDATE OF p',
          [site.id, slug],
        )
      ).rows[0]
      if (!old) throw Error('The sample page is unavailable: ' + slug)
      if (isDeepStrictEqual(old.content, sections)) return
      if (
        old.draft_version_id !== old.published_version_id ||
        !['SAWSO approved public pages', 'Owner-supplied SAWSO content capture'].includes(old.note)
      ) {
        skippedPages.push(slug)
        return
      }
      await c.query("SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint',$5)", [
        old.id,
        old.revision,
        JSON.stringify(sections),
        JSON.stringify(old.meta),
        'Owner-supplied SAWSO content capture',
      ])
      pages.push(slug)
      releaseKeys.add('page:' + old.id)
    }
    const pageHeader = (heading: string) => sawsoSection(defs, 'page-header', heading, { heading, intro: '' })
    const picture = (source: string) => sawsoMediaPhoto(local, source)
    await save('our-team', [
      pageHeader('Meet Our Team'),
      ...content.team.map(person =>
        sawsoSection(defs, 'text-image', person.name, {
          heading: person.name,
          body: (person.role ? '<p><em>' + escape(person.role) + '</em></p>' : '') + person.body,
          photo: picture(person.image),
          ...(local[person.image] ? {} : { __cms_sample_fields: ['photo'] }),
        }),
      ),
    ])
    await save('annual-reports', [
      pageHeader('Annual Reports'),
      ...content.reports.map(report =>
        sawsoSection(defs, 'text-image', report.title, {
          heading: report.title,
          body: report.body + '<p><a href="' + escape(report.url) + '">' + escape(report.label) + '</a></p>',
          photo: picture(report.image),
          ...(local[report.image] ? {} : { __cms_sample_fields: ['photo'] }),
        }),
      ),
    ])
    if (content.financial.body.trim())
      await save('financial-accountability', [
        pageHeader('Financial Accountability'),
        sawsoSection(defs, 'text-block', 'Financial Accountability', { heading: '', body: content.financial.body }),
      ])
    let illustrationChanged = false
    if (content.illustration && local[content.illustration.source]) {
      const home = (
        await c.query(
          "SELECT p.id,p.revision,p.draft_version_id,p.published_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug='' AND p.archived_at IS NULL FOR UPDATE OF p",
          [site.id],
        )
      ).rows[0]
      const section = home.content.find((s: SectionInstance) => s.values.heading === 'How We Meet Global Needs') as
        | SectionInstance
        | undefined
      if (section && home.draft_version_id === home.published_version_id) {
        const next = picture(content.illustration.source)
        if (!isDeepStrictEqual(section.values.photo, next)) {
          section.values.photo = next
          section.values.photo_note = ''
          const fields = (section.values.__cms_sample_fields as string[] | undefined)?.filter(f => f !== 'photo') ?? []
          if (fields.length) section.values.__cms_sample_fields = fields
          else delete section.values.__cms_sample_fields
          await c.query("SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint',$5)", [
            home.id,
            home.revision,
            JSON.stringify(home.content),
            JSON.stringify(home.meta),
            'Use captured original Global Needs illustration',
          ])
          illustrationChanged = true
          releaseKeys.add('page:' + home.id)
        }
      }
    }
    const globals = (
      await c.query(
        'SELECT g.kind,g.revision,g.draft_version_id,g.published_version_id,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
        [site.id],
      )
    ).rows
    const header = globals.find(g => g.kind === 'header')!
    const footer = globals.find(g => g.kind === 'footer')!
    let privacyChanged = false
    if (
      header.draft_version_id === header.published_version_id &&
      footer.draft_version_id === footer.published_version_id &&
      typeof footer.content.component?.values.base === 'string'
    ) {
      const before = footer.content.component.values.base
      const after = before.replace('href="/privacy"', 'href="' + content.privacy + '"')
      if (after !== before) {
        footer.content.component.values.base = after
        await c.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
          site.id,
          header.revision,
          footer.revision,
          JSON.stringify(header.content),
          JSON.stringify(footer.content),
        ])
        privacyChanged = true
        releaseKeys.add('frame:' + site.id)
      }
    }
    const after = (
      await c.query(
        "SELECT p.id,p.slug,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.archived_at IS NULL AND (p.slug='ways-we-help' OR p.slug LIKE 'ways-we-help/%') ORDER BY p.slug",
        [site.id],
      )
    ).rows
    if (hash(after) !== protectedHash) throw Error('Approved ministry/hub text changed; import rolled back.')
    const releaseItems = (await releaseCandidates(c, site.id)).filter(item => releaseKeys.has(item.key))
    return {
      siteId: site.id,
      releaseItems,
      changedStories,
      skippedStories,
      pages,
      skippedPages,
      illustrationChanged,
      privacyChanged,
      mediaReady: Object.keys(local).length,
      mediaProblems,
      protectedPages: 9,
      protectedHash,
      review: content.review,
    }
  })
}
