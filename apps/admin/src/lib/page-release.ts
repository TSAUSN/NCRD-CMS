import { asUser, type Queryable } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { planSiteRelease, type ReleaseItem } from './releases.ts'

/** Resolve one owned saved page on the server; never accept a client release list. */
export async function pageReleaseSelection(client: Queryable, pageId: string, revision: string, versionId: string) {
  const head = (
    await client.query<{
      id: string
      site_id: string
      title: string
      revision: string
      draft_version_id: string | null
      published_version_id: string | null
      initial_release_required: boolean
      can_publish: boolean
    }>(
      `SELECT p.id,p.site_id,p.title,p.revision,p.draft_version_id,p.published_version_id,
              s.initial_release_required,app.can_publish(p.site_id) AS can_publish
       FROM pages p JOIN sites s ON s.id=p.site_id
       WHERE p.id=$1 AND p.archived_at IS NULL AND s.status<>'archived'`,
      [pageId],
    )
  ).rows[0]
  if (!head) throw new DomainError('not_found', 'This page is unavailable.')
  if (!head.can_publish) throw new DomainError('not_authorized', 'Your role cannot schedule this page.')
  if (String(head.revision) !== revision || head.draft_version_id !== versionId)
    throw new DomainError('stale_revision', 'The saved page changed. Review the latest draft before scheduling.')
  if (head.initial_release_required) return { firstSiteReview: true as const, siteId: String(head.site_id) }
  if (head.id !== pageId || !head.draft_version_id || head.draft_version_id === head.published_version_id)
    throw new DomainError(
      'invalid_state',
      'There are no saved page changes to schedule. Edit the page and save a draft first.',
    )
  // The locked planner still resolves the selection against the site's
  // candidates. The page editor only needs the one requested head here.
  const page: ReleaseItem = {
    key: 'page:' + head.id,
    type: 'page',
    id: head.id,
    label: head.title,
    revision: String(head.revision),
    versionId: head.draft_version_id,
    unpublished: head.published_version_id === null,
  }
  return { firstSiteReview: false as const, siteId: head.site_id, page }
}
export async function preparePageRelease(
  userId: string,
  pageId: string,
  revision: string,
  versionId: string,
  requestId: string,
) {
  const selected = await asUser({ userId }, client => pageReleaseSelection(client, pageId, revision, versionId))
  if (selected.firstSiteReview) return selected
  // The release engine checks the saved pins and permissions again under its locks.
  const release = await planSiteRelease(userId, requestId, selected.siteId, [selected.page])
  return { firstSiteReview: false as const, siteId: selected.siteId, release }
}

/** Read the exact saved difference without creating a publication or review record. */
export async function readPageSavedReview(userId: string, pageId: string, revision: string, versionId: string) {
  const head = await asUser(
    { userId },
    async client =>
      (
        await client.query(
          "SELECT p.site_id,p.title,p.revision,p.draft_version_id,app.can_publish(p.site_id) AS can_publish FROM pages p JOIN sites s ON s.id=p.site_id WHERE p.id=$1 AND p.archived_at IS NULL AND s.status<>'archived'",
          [pageId],
        )
      ).rows[0],
  )
  if (!head) throw new DomainError('not_found', 'This page is unavailable.')
  if (!head.can_publish) throw new DomainError('not_authorized', 'Your role cannot publish this page.')
  if (String(head.revision) !== revision || head.draft_version_id !== versionId)
    throw new DomainError('stale_revision', 'The saved page changed. Review the latest draft before publishing.')
  const { releasePresentations } = await import('./release-presentation.ts')
  const key = 'page:' + pageId
  const presentation = (
    await releasePresentations(
      userId,
      head.site_id,
      [{ key, type: 'page', id: pageId, label: head.title, revision, versionId }],
      true,
    )
  )[key]
  if (!presentation) throw new DomainError('not_found', 'The saved page could not be read. Save and try again.')
  return { title: String(head.title), revision, versionId, presentation }
}
