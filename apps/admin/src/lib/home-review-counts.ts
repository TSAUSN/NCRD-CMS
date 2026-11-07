import 'server-only'
import { asUser } from '@cms/platform'

export type HomeReviewCounts = { pages: Map<string, number>; lists: Map<string, number> }

/** Same review queues and limits as the inbox, without sending full snapshots
 * just to render the Home counters. */
export function homeReviewCounts(userId: string): Promise<HomeReviewCounts> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<{ kind: 'pages' | 'lists'; site_id: string; count: number }>(
      `SELECT 'pages' AS kind, site_id, count(*)::int AS count
         FROM app.review_queue(NULL::uuid,false,100,NULL::uuid,NULL::uuid)
        WHERE can_review GROUP BY site_id
       UNION ALL
       SELECT 'lists' AS kind, (review->>'siteId')::uuid AS site_id, count(*)::int AS count
         FROM app.collection_review_queue(NULL::uuid,NULL::uuid,NULL::uuid) AS review
        WHERE review->>'status'='open' AND review->>'canReview'='true'
        GROUP BY review->>'siteId'`,
    )
    const result: HomeReviewCounts = { pages: new Map(), lists: new Map() }
    for (const row of rows) result[row.kind].set(row.site_id, row.count)
    return result
  })
}
