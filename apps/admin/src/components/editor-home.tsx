import { GuardedLink as Link } from './guarded-link.tsx'
import { AppShell } from './app-shell.tsx'
import { navigationFor, type NavigationAccess } from './nav.ts'
import { PageHeader, Card, ButtonLink, TextLink } from './ui/index.ts'
import type { SiteRow } from '../lib/queries.ts'
import type { WorkspacePage } from '../lib/workspace-queries.ts'
import type { editorialStoryHome } from '../lib/editor-home.ts'
import shared from './workspace.module.css'
import workspaceFormsStyles from './workspace-styles/workspace-forms.module.css'
import recordTableStyles from './workspace-styles/record-table.module.css'
import siteSummaryStyles from './workspace-styles/site-summary.module.css'
type StoryHome = Awaited<ReturnType<typeof editorialStoryHome>>
export function EditorHome({
  email,
  role,
  access,
  site,
  pages,
  stories,
  storyError,
  reviewCount,
  siteNotice,
}: {
  email: string
  role: string
  access: NavigationAccess
  site: SiteRow
  pages: WorkspacePage[]
  stories: StoryHome
  storyError: boolean
  reviewCount: number
  siteNotice?: string
}) {
  const siteRole = access.memberships.get(site.id),
    full = siteRole === 'editor' || siteRole === 'contributor',
    canCreate = full,
    canSchedule = siteRole === 'editor',
    scoped = !access.memberships.has(site.id),
    base = '/sites/' + site.id,
    assigned = pages.filter(
      page =>
        page.site_id === site.id &&
        !page.slug.startsWith('stories/') &&
        !stories?.articlePaths.includes('/' + page.slug),
    ),
    drafts = assigned.filter(page => page.draft_version_id !== page.published_version_id),
    chapterSetup =
      site.chapters_enabled &&
      ([...(access.divisionScopes?.values() ?? [])].some(scope => scope.siteId === site.id) ||
        [...(access.pageScopes?.values() ?? [])].some(scope => scope.siteId === site.id && scope.role === 'editor')),
    pageTask = scoped && assigned.length === 1 ? assigned[0] : null,
    gap = stories?.gaps[0],
    attention = Boolean(storyError || stories?.missing || gap || drafts.length || reviewCount)
  return (
    <AppShell email={email} role={role} groups={navigationFor(site, access)}>
      <main
        id="main"
        className={'wrap wrap-wide ' + shared.page + ' ' + workspaceFormsStyles.compactForm + ' ' + shared.denseStack}
        data-layout="compact"
      >
        <PageHeader
          title="Home"
          density="compact"
          showWayfinding={false}
          sub={
            <>
              <TextLink href={base}>{site.name}</TextLink>
              <span>Starts from what you’re here to do.</span>
            </>
          }
        />
        {siteNotice && <p role="status">{siteNotice}</p>}
        <div className={shared.threeColumns} aria-label="Your tasks">
          {full && site.has_stories && (
            <Link
              className={siteSummaryStyles.task}
              data-density="compact"
              aria-label={canCreate ? 'Add a story' : 'Update stories'}
              href={base + (canCreate ? '/stories/new' : '/stories')}
            >
              <strong>{canCreate ? 'Add a story' : 'Update stories'}</strong>
              <span>
                {canCreate ? 'Write it, tag it, and pick a day.' : 'Edit and tag the stories you can work on.'}
              </span>
            </Link>
          )}
          {full && !site.has_stories && site.has_content_lists && (
            <Link
              className={siteSummaryStyles.task}
              data-density="compact"
              aria-label="Update lists"
              href={base + '/content'}
            >
              <strong>Update lists</strong>
              <span>Keep the lists you work on up to date.</span>
            </Link>
          )}
          <Link
            className={siteSummaryStyles.task}
            data-density="compact"
            aria-label={pageTask ? 'Edit ' + pageTask.title : scoped ? 'Your assigned pages' : 'Edit a page'}
            href={pageTask ? '/pages/' + pageTask.id : base + '/pages'}
          >
            <strong>{pageTask ? 'Edit ' + pageTask.title : scoped ? 'Your assigned pages' : 'Edit a page'}</strong>
            <span>Open the real page and click what you want to change.</span>
          </Link>
          {full && site.has_stories && canSchedule && (
            <Link
              className={siteSummaryStyles.task}
              data-density="compact"
              aria-label="See what’s coming up"
              href={base + '/stories?view=soon'}
            >
              <strong>See what’s coming up</strong>
              <span>
                {stories
                  ? stories.scheduled +
                    ' ' +
                    (stories.scheduled === 1 ? 'story scheduled' : 'stories scheduled') +
                    ' this month.'
                  : 'See saved story schedules.'}
              </span>
            </Link>
          )}
          {!canSchedule && (
            <Link
              className={siteSummaryStyles.task}
              data-density="compact"
              aria-label="Follow your requests"
              href="/inbox"
            >
              <strong>Follow your requests</strong>
              <span>See the drafts you sent for approval.</span>
            </Link>
          )}
          {chapterSetup && (
            <Link className={siteSummaryStyles.task} data-density="compact" href={base + '/chapters'}>
              <strong>Set up chapters</strong>
              <span>Choose page sections and invite chapter volunteers.</span>
            </Link>
          )}
        </div>
        <Card title="Needs attention" density="compact">
          <ul className={siteSummaryStyles.rowList}>
            {storyError && (
              <li>
                <div className={recordTableStyles.rowCopy}>
                  <strong>Story tasks could not be loaded</strong>
                  <span className={recordTableStyles.meta}>
                    Your saved stories remain available. Try Home again or open Stories.
                  </span>
                </div>
                <ButtonLink variant="secondary" size="s" href={base + '/stories'}>
                  Open Stories
                </ButtonLink>
              </li>
            )}
            {stories && stories.missing > 0 && (
              <li>
                <div className={recordTableStyles.rowCopy}>
                  <strong>
                    {stories.missing} {stories.missing === 1 ? 'story needs' : 'stories need'} tags
                  </strong>
                  <span className={recordTableStyles.meta}>Tag them so they show on the right pages.</span>
                </div>
                <ButtonLink variant="secondary" size="s" href={base + '/stories?status=untagged'}>
                  Tag stories
                </ButtonLink>
              </li>
            )}
            {gap && (
              <li>
                <div className={recordTableStyles.rowCopy}>
                  <strong>{gap.label} has no stories in the last 13 months</strong>
                  <span className={recordTableStyles.meta}>The page shows its “no stories yet” line.</span>
                </div>
                <ButtonLink
                  variant="secondary"
                  size="s"
                  href={base + '/stories?view=gaps&main=' + encodeURIComponent(gap.id)}
                >
                  See gaps
                </ButtonLink>
              </li>
            )}
            {reviewCount > 0 && (
              <li>
                <div className={recordTableStyles.rowCopy}>
                  <strong>
                    {reviewCount} {reviewCount === 1 ? 'submission needs' : 'submissions need'} your review
                  </strong>
                  <span className={recordTableStyles.meta}>Read the proposed changes and leave your decision.</span>
                </div>
                <ButtonLink variant="secondary" size="s" href="/inbox">
                  Review
                </ButtonLink>
              </li>
            )}
            {drafts.length > 0 && (
              <li>
                <div className={recordTableStyles.rowCopy}>
                  <strong>
                    {drafts.length} {drafts.length === 1 ? 'page has' : 'pages have'} saved work not live
                  </strong>
                  <span className={recordTableStyles.meta}>
                    {scoped ? 'Only your assigned pages are included.' : 'Open a page to continue its saved draft.'}
                  </span>
                </div>
                <ButtonLink variant="secondary" size="s" href={base + '/pages'}>
                  Open pages
                </ButtonLink>
              </li>
            )}
            {!attention && (
              <li>
                <div className={recordTableStyles.rowCopy}>
                  <strong>Nothing needs your attention</strong>
                  <span className={recordTableStyles.meta}>Start with one of your tasks above.</span>
                </div>
              </li>
            )}
          </ul>
        </Card>
      </main>
    </AppShell>
  )
}
