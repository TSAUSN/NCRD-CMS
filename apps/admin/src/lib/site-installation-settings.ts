/**
 * Installation defaults for legacy review sites. A site's declared national
 * template always takes precedence; the fallback only supports older data.
 */
const DEFAULT_WORKSPACE_ORDER = ['sawso', 'echelon-chapters', 'bt2027-r8']
const DEFAULT_LEGACY_TEMPLATE_SITES = ['sawso', 'echelon-chapters']
const DEFAULT_LEGACY_STORY_SITES = ['sawso']
const SITE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function siteSlugs(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined) return fallback
  const slugs = value
    .split(',')
    .map(slug => slug.trim())
    .filter(Boolean)
  if (slugs.some(slug => slug.length > 63 || !SITE_SLUG.test(slug))) return fallback
  return [...new Set(slugs)]
}

const workspaceOrder = siteSlugs(process.env.CMS_WORKSPACE_SITE_ORDER, DEFAULT_WORKSPACE_ORDER)
const legacyTemplateSites = siteSlugs(process.env.CMS_NATIONAL_TEMPLATE_LEGACY_SITES, DEFAULT_LEGACY_TEMPLATE_SITES)
const legacyStorySites = new Set(siteSlugs(process.env.CMS_STORIES_LEGACY_SOURCE_SITES, DEFAULT_LEGACY_STORY_SITES))

export function hasLegacyStorySource(slug: string): boolean {
  return legacyStorySites.has(slug)
}

export const primaryWorkspaceSlug = workspaceOrder[0]

const sqlSlugs = (slugs: string[]) => slugs.map(slug => "'" + slug + "'")

export const SITE_ORDER_SQL = workspaceOrder.length
  ? `CASE s.slug ${sqlSlugs(workspaceOrder)
      .map((slug, index) => `WHEN ${slug} THEN ${index}`)
      .join(' ')} ELSE ${workspaceOrder.length} END,s.name`
  : 's.name'

/** Same eligibility for the navigation link and the template review command. */
export function nationalTemplateEligibilitySql(tokens?: 'v.tokens'): string {
  const declared = tokens
    ? `${tokens}#>>'{presentation,template,id}'='national'`
    : `EXISTS(SELECT 1 FROM themes th JOIN theme_versions tv ON tv.id=th.draft_version_id WHERE th.site_id=s.id AND tv.tokens#>>'{presentation,template,id}'='national')`
  return legacyTemplateSites.length
    ? `(s.slug IN (${sqlSlugs(legacyTemplateSites).join(',')}) OR ${declared})`
    : `(${declared})`
}
