import { asUser } from '@cms/platform'

export type ActivityParams = Record<string, string | string[] | undefined>
export type ActivityFilters = {
  site: string
  actor: string
  actorType: string
  action: string
  from: string
  to: string
  before: string
}
export type ActivityRow = {
  id: string
  site_id: string | null
  site_name: string | null
  actor_id: string | null
  actor_type: string
  actor_name: string
  action: string
  item_type: string
  item_id: string | null
  before_ref: string | null
  after_ref: string | null
  detail: unknown
  created_at: Date
  cursor_time: string
}
export type ActivityOptions = { actors: { id: string; name: string }[]; actions: string[] }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
function validDate(value: string): boolean {
  return DATE.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}
export function parseActivityFilters(params: ActivityParams): { filters: ActivityFilters; error: string | null } {
  const filters = Object.fromEntries(
    ['site', 'actor', 'actorType', 'action', 'from', 'to', 'before'].map(key => [
      key,
      typeof params[key] === 'string' ? params[key] : '',
    ]),
  ) as ActivityFilters
  let error: string | null = null
  if (Object.values(params).some(Array.isArray)) error = 'Choose one value for each filter.'
  else if ([filters.site, filters.actor].some(value => value && !UUID.test(value)))
    error = 'Choose a site and person from the filter lists.'
  else if (filters.actorType && !['user', 'system', 'scheduler', 'migration'].includes(filters.actorType))
    error = 'Choose a valid actor type.'
  else if (filters.action.length > 120 || (filters.action && !/^[a-z0-9_.-]+$/.test(filters.action)))
    error = 'Choose a valid activity action.'
  else if (
    [filters.from, filters.to].some(value => value && !validDate(value)) ||
    (filters.from && filters.to && filters.from > filters.to)
  )
    error = 'Choose a valid date range, with the start before the end.'
  else if (filters.before && !parseActivityCursor(filters.before))
    error = 'This history position is invalid. Clear the filters to start again.'
  return { filters, error }
}
export function parseActivityCursor(value: string): { time: string; id: string } | null {
  const [time, id, ...rest] = value.split('~')
  if (
    rest.length ||
    !time ||
    !id ||
    !/^[1-9][0-9]{0,18}$/.test(id) ||
    BigInt(id) > 9223372036854775807n ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(time) ||
    !Number.isFinite(Date.parse(time)) ||
    new Date(time).toISOString() !== `${time.slice(0, 23)}Z`
  )
    return null
  return { time, id }
}
export function activityHref(filters: ActivityFilters, before = ''): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...filters, before })) if (value) query.set(key, value)
  return `/activity${query.size ? `?${query}` : ''}`
}
const ACTIVITY_LABELS: Record<string, string> = {
  'asset.import': 'Imported a site file',
  'collection.create': 'Created a collection',
  'collection.entries.publish': 'Published collection records',
  'collection.entries.save': 'Saved collection records',
  'collection.schema.publish': 'Published collection fields',
  'collection.schema.save': 'Saved collection fields',
  'collection.review.submitted': 'Submitted a collection for review',
  'collection.review.approved': 'Approved a collection review',
  'collection.review.rejected': 'Returned a collection review',
  'collection.review.comment_added': 'Commented on a collection review',
  'collection.review.comment_resolved': 'Resolved a review comment',
  'collection.review.comment_reopened': 'Reopened a review comment',
  'document.upload': 'Uploaded a document',
  'document.organize': 'Organized a document',
  'domain.add': 'Connected a domain',
  'domain.check': 'Checked a domain',
  'domain.primary': 'Made a domain primary',
  'domain.remove': 'Removed a domain',
  'domain.status': 'Updated a domain’s status',
  'global_elements.save': 'Saved the header & footer',
  'global_elements.publish': 'Published the header & footer',
  'global_elements.revert': 'Reverted the header & footer to live',
  'global_role.set': 'Changed a person’s CMS role',
  'membership.set': 'Changed a person’s site access',
  'media.delete': 'Deleted media',
  'media.restore': 'Restored media',
  'media.upload.begin': 'Started an upload',
  'media.upload.finalize': 'Finished an upload',
  'migration.v1.media': 'Imported V1 images',
  'migration.v1.reference_draft': 'Imported a V1 reference page',
  'migration.v1.release_note': 'Recorded a V1 import note',
  'migration.v1.review': 'Reviewed a V1 import',
  'migration.v1.stage': 'Staged a V1 import',
  'navigation.save': 'Saved the menu',
  'navigation.publish': 'Published the menu',
  'navigation.backfill': 'Filled the menu from pages',
  'navigation.auto_sync': 'Added a page to the menu automatically',
  'navigation.auto_sync_skipped': 'Left the menu unchanged',
  'page.create': 'Created a page',
  'page.save': 'Saved a page draft',
  'page.save_draft': 'Saved a page draft',
  'page.rename': 'Renamed a page',
  'page.publish': 'Published a page',
  'page.unpublish': 'Unpublished a page',
  'page.archive': 'Archived a page',
  'page.restore': 'Restored a page as a draft',
  'page.restore_archived': 'Restored an archived page',
  'page.approve_trusted_code': 'Approved a page’s custom code',
  'recipe.save': 'Saved a page template',
  'recipe.use': 'Used a page template',
  'recipe.rename': 'Renamed a page template',
  'recipe.share': 'Shared a page template',
  'recipe.retire': 'Retired a page template',
  'recipe.restore': 'Restored a page template',
  'release.plan': 'Prepared a site release',
  'release.publish': 'Published a site release',
  'release.cancel': 'Cancelled a site release',
  'release.recovery.prepare': 'Prepared a release recovery',
  'release.recovery.unpublish': 'Took a release back offline',
  'schedule.create': 'Scheduled a page action',
  'schedule.cancel': 'Cancelled a schedule',
  'schedule.retry': 'Rescheduled a failed action',
  'schedule.failed': 'A scheduled action failed',
  'schedule.blocked': 'Stopped a schedule on readiness checks',
  'section_def.version': 'Saved a section version',
  'section_def.placement': 'Changed where a section can be used',
  'section_def.active': 'Made a section available',
  'section_def.retired': 'Retired a section',
  'section_def.revalidate': 'Rechecked a section against current rules',
  'section_def.thumbnail': 'Updated a section’s picture',
  'section_def.thumbnail_retry': 'Retried a section’s picture',
  'section_request.create': 'Requested a custom section',
  'section_request.respond': 'Answered a section request',
  'site.create': 'Created a site',
  'site.settings': 'Changed site settings',
  'site.archive': 'Archived a site',
  'site.export': 'Exported site content',
  'site.import': 'Imported site content',
  'submission.approve': 'Approved a submitted version',
  'submission.reject': 'Returned a submission',
  'submission.superseded': 'Replaced a submission with a newer one',
  'theme.save': 'Saved the design',
  'theme.publish': 'Published the design',
  'theme.revert_to_live': 'Reverted the design to live',
  'user.provision': 'Added a person',
  'user.add': 'Added a person without sending an invitation',
  'user.invite': 'Invited a person',
  'user.invite_resend': 'Resent an invitation',
  'user.update': 'Updated a person',
  'user.set_status': 'Changed a person’s account status',
  'user.attach_auth_subject': 'Linked a sign-in to a person',
}
/** A plain-language name for every recorded action; an unknown one still reads as words. */
export function activityLabel(action: string): string {
  if (ACTIVITY_LABELS[action]) return ACTIVITY_LABELS[action]
  const words = action.replaceAll('.', ' ').replaceAll('_', ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : action
}
export async function getActivity(
  userId: string,
  filters: ActivityFilters,
): Promise<{ rows: ActivityRow[]; next: string | null }> {
  const cursor = filters.before ? parseActivityCursor(filters.before) : null
  const until = filters.to ? new Date(Date.parse(filters.to) + 86_400_000).toISOString() : null
  return asUser({ userId }, async client => {
    const rows = (
      await client.query<ActivityRow>('SELECT * FROM app.activity_feed($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        filters.site || null,
        filters.actor || null,
        filters.actorType || null,
        filters.action || null,
        filters.from || null,
        until,
        cursor?.time || null,
        cursor?.id || null,
        51,
      ])
    ).rows
    const page = rows.slice(0, 50)
    const last = page.at(-1)
    // Preserve PostgreSQL microseconds: converting the cursor through a JS Date
    // would skip rows recorded in the same millisecond as the page boundary.
    return { rows: page, next: rows.length > 50 && last ? `${last.cursor_time}~${last.id}` : null }
  })
}
export function getActivityOptions(userId: string, siteId: string | null): Promise<ActivityOptions> {
  return asUser(
    { userId },
    async client =>
      (await client.query<{ options: ActivityOptions }>('SELECT app.activity_options($1) AS options', [siteId]))
        .rows[0]!.options,
  )
}
