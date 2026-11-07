import 'server-only'
import { asUser } from '@cms/platform'
import { SITE_CHOICE_SQL } from './site-summary.ts'

type SiteChoice = { id: string; name: string }

/** The site picker needs names and IDs, under the caller's existing site policy. */
export function listSiteChoices(userId: string): Promise<SiteChoice[]> {
  return asUser({ userId }, async client => (await client.query<SiteChoice>(SITE_CHOICE_SQL)).rows)
}
