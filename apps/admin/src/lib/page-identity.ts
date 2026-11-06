import type { Queryable } from '@cms/platform'
import { DomainError, type PageIdentity } from '@cms/domain'

export function validPageIdentity(value: unknown): value is PageIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const identity = value as PageIdentity
  return (
    Object.keys(identity).every(key => key === 'title' || key === 'address') &&
    typeof identity.title === 'string' &&
    identity.title === identity.title.trim() &&
    identity.title.length > 0 &&
    identity.title.length <= 200 &&
    typeof identity.address === 'string' &&
    identity.address.length <= 160 &&
    (identity.address === '' || /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(identity.address))
  )
}
/** The existing command owns authorization, locking, address uniqueness and CAS.
 * Unchanged identity needs no administrative permission for a content save. */
export async function savePageIdentity(
  client: Queryable,
  pageId: string,
  expectedRevision: number | string,
  identity: PageIdentity,
) {
  if (!validPageIdentity(identity))
    throw new DomainError('invalid_state', 'Enter a page name and a valid page address.')
  const head = (
    await client.query<{ title: string; slug: string }>('SELECT title,slug FROM pages WHERE id=$1', [pageId])
  ).rows[0]
  if (!head) throw new DomainError('not_found', 'This page is unavailable.')
  if (head.title === identity.title && head.slug === identity.address) return expectedRevision
  return (
    await client.query<{ revision: string }>('SELECT revision FROM app.rename_page($1,$2,$3,$4)', [
      pageId,
      expectedRevision,
      identity.title,
      identity.address,
    ])
  ).rows[0]!.revision
}
