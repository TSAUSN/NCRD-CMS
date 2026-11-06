import { asUser } from '@cms/platform'
import type { ReadinessFinding } from '@cms/domain'

/** An exception is consent to the displayed findings, not to future ones. */
export function scheduleFindingsReviewed(
  current: ReadinessFinding[],
  reviewed: ReadinessFinding[] | undefined,
): boolean {
  return current
    .filter(finding => finding.severity === 'blocking')
    .every(
      finding =>
        Array.isArray(reviewed) &&
        reviewed.some(
          seen =>
            seen &&
            seen.rule === finding.rule &&
            seen.severity === finding.severity &&
            seen.message === finding.message &&
            seen.detail === finding.detail,
        ),
    )
}

export function schedulingConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return env['SCHEDULING_ENABLED'] === 'true' && env['SCHEDULING_MONITORING_READY'] === 'true'
}
export async function schedulingAvailable(userId: string): Promise<boolean> {
  if (!schedulingConfigured()) return false
  return asUser(
    { userId },
    async client =>
      (await client.query<{ available: boolean }>('SELECT app.scheduling_available() AS available')).rows[0]
        ?.available === true,
  )
}
export type ScheduleRow = {
  item_type?: 'page' | 'release'
  id: string
  item_id: string
  version_id: string
  action: 'publish' | 'unpublish'
  run_at: Date
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  last_error: string | null
  attempt_count: number
  title: string
  path: string
  revision: string
  override_reason: string | null
  retry_of_id: string | null
  retried_as_id: string | null
  retried_as_status: string | null
}
export function listSiteSchedules(userId: string, siteId: string): Promise<ScheduleRow[]> {
  return asUser(
    { userId },
    async client =>
      (
        await client.query<ScheduleRow>(
          `
    SELECT s.item_type,s.id,s.item_id,s.version_id,s.action,s.run_at,s.status,s.last_error,s.attempt_count,s.override_reason,s.retry_of_id,
      retry.id AS retried_as_id,retry.status AS retried_as_status,
      CASE WHEN s.item_type='release' THEN 'Selected changes ('||jsonb_array_length(r.snapshot)||')' ELSE v.page_title END AS title,
      COALESCE(v.revision::text,'') AS revision,COALESCE(app.page_path(v.page_slug),'/') AS path
    FROM scheduled_actions s LEFT JOIN page_versions v ON s.item_type='page' AND v.id=s.version_id AND v.page_id=s.item_id
    LEFT JOIN site_releases r ON s.item_type='release' AND r.id=s.item_id AND r.site_id=s.site_id
    LEFT JOIN scheduled_actions retry ON retry.retry_of_id=s.id
    WHERE s.site_id=$1 AND (s.item_type='page' AND v.id IS NOT NULL OR s.item_type='release' AND r.id IS NOT NULL) ORDER BY (s.status IN ('pending','running')) DESC,s.run_at DESC LIMIT 100
  `,
          [siteId],
        )
      ).rows,
  )
}
