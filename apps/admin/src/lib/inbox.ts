import { asUser } from '@cms/platform'

export type SectionRequest = {
  id: string
  site_id: string
  site_name: string
  title: string
  body: string
  status: 'open' | 'in_progress' | 'completed' | 'declined'
  revision: string
  requested_by_name: string
  response: string
  responded_by_name: string | null
  created_at: Date
  updated_at: Date
  can_manage: boolean
}
export type InboxSnapshot = {
  reviews: number
  collectionReviews?: number
  requests: number
  operations: number
  items: {
    kind: 'domain' | 'delivery' | 'schedule'
    id: string
    siteId: string | null
    siteName: string | null
    title: string
    error: string
    occurredAt: string
    canRetryThumbnail?: boolean
    retryId?: string | null
    retryStatus?: string | null
  }[]
}
export function listSectionRequests(userId: string, siteId: string | null = null): Promise<SectionRequest[]> {
  return asUser(
    { userId },
    async client => (await client.query<SectionRequest>('SELECT * FROM app.section_request_feed($1)', [siteId])).rows,
  )
}
export function getInboxSnapshot(userId: string): Promise<InboxSnapshot> {
  return asUser(
    { userId },
    async client =>
      (await client.query<{ snapshot: InboxSnapshot }>('SELECT app.inbox_snapshot() AS snapshot')).rows[0]!.snapshot,
  )
}
export function inboxCount(snapshot: Pick<InboxSnapshot, 'reviews' | 'requests' | 'operations'>): number {
  return snapshot.reviews + snapshot.requests + snapshot.operations
}
