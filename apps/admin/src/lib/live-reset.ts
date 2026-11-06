import { savePageIdentity } from './page-identity.ts'
import type { Queryable } from '@cms/platform'
import { DomainError, type EditorDocument, type EditorSection } from '@cms/domain'
export type LiveResetRequest = {
  pageId: string
  expectedRevision: number
  expectedLiveVersionId: string
  sectionIndex?: number
  liveSectionIndex?: number
}
/** Locked page head and source pointer. Both paths use the existing narrow commands. */
export async function resetFromLive(client: Queryable, input: LiveResetRequest) {
  const page = (
    await client.query<{
      revision: string
      published_version_id: string
      content: EditorSection[]
      meta: EditorDocument['meta']
      kind: string
      live_content: EditorSection[]
      live_meta: EditorDocument['meta']
      title: string
      slug: string
      live_title: string
      live_slug: string
    }>(
      `
    SELECT p.revision,p.published_version_id,p.title,p.slug,d.content,d.meta,d.kind,l.content AS live_content,l.meta AS live_meta,l.page_title AS live_title,l.page_slug AS live_slug
    FROM pages p JOIN page_versions d ON d.id=p.draft_version_id JOIN page_versions l ON l.id=p.published_version_id
    WHERE p.id=$1 AND p.archived_at IS NULL FOR UPDATE OF p`,
      [input.pageId],
    )
  ).rows[0]
  if (!page) throw new DomainError('not_found', 'This page has no live version to restore.')
  if (Number(page.revision) !== input.expectedRevision || page.published_version_id !== input.expectedLiveVersionId)
    throw new DomainError('stale_revision', 'The page changed. Reload before resetting it.', Number(page.revision))
  const wholePage = input.sectionIndex === undefined
  if (
    !wholePage &&
    (!Number.isSafeInteger(input.sectionIndex) ||
      !Number.isSafeInteger(input.liveSectionIndex) ||
      !page.content[input.sectionIndex!] ||
      !page.live_content[input.liveSectionIndex!])
  )
    throw new DomainError('invalid_state', 'Choose the live section to restore.')
  let revision = page.revision
  if (page.kind !== 'checkpoint')
    revision = (
      await client.query<{ revision: string }>('SELECT revision FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
        input.pageId,
        revision,
        JSON.stringify(page.content),
        JSON.stringify(page.meta),
        'checkpoint',
        wholePage ? 'Before discarding unpublished changes' : 'Before resetting a section to live',
      ])
    ).rows[0]!.revision
  const content = structuredClone(wholePage ? page.live_content : page.content)
  if (!wholePage) content[input.sectionIndex!] = structuredClone(page.live_content[input.liveSectionIndex!]!)
  const meta = wholePage ? page.live_meta : page.meta
  const identity = { title: wholePage ? page.live_title : page.title, address: wholePage ? page.live_slug : page.slug }
  if (wholePage) revision = String(await savePageIdentity(client, input.pageId, revision, identity))
  const saved = (
    await client.query<{ version_id: string; revision: string }>(
      'SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5,$6)',
      [
        input.pageId,
        revision,
        JSON.stringify(content),
        JSON.stringify(meta),
        'checkpoint',
        wholePage ? 'Discarded unpublished changes; restored live page' : 'Reset a section to its live version',
      ],
    )
  ).rows[0]!
  return {
    revision: Number(saved.revision),
    versionId: saved.version_id,
    document: { sections: content, meta, identity },
    wholePage,
  }
}
