import { reviewDate } from '../../../lib/review-time.ts'
import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import type { Principal } from '@cms/domain'
import type { SiteRow, listArchivedPages } from '../../../lib/queries.ts'
import type { WorkspacePage } from '../../../lib/workspace-queries.ts'
import type { CollectionWorkspace } from '../../../lib/collection-queries.ts'
import type { ReviewSubmission } from '../../../lib/review-queries.ts'
import { overviewPerson } from '../../../lib/overview-people.ts'
import { contentCounts } from '../../../lib/content-counts.ts'
import { listPeople } from '../../../lib/people.ts'
import { roleDisplayName } from '../../../lib/role-display.ts'
import { personRoles } from '../../../lib/people-access.ts'
import { editorialPosture } from '../../../lib/editorial-posture.ts'
import { AppShell } from '../../../components/app-shell.tsx'
import { navigationFor } from '../../../components/nav.ts'
import { PageHeader } from '../../../components/shell.tsx'
import { ButtonLink, Card, Disclosure, TextLink } from '../../../components/ui/index.ts'
import { StatusChip, pageStatus, siteStatus } from '../../../components/status.tsx'
import {
  IconAlert,
  IconBrush,
  IconCheck,
  IconClock,
  IconCollection,
  IconExternal,
  IconMail,
  IconPage,
  IconPeople,
} from '../../../components/icons.tsx'
import { SiteHostingNotice } from '../../../components/site-hosting-notice.tsx'
import { NativeNewPage } from './native-new-page.tsx'
import { PagesTable } from './pages-table.tsx'
import { PageManagement } from './page-management.tsx'
import shared from '../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../components/workspace-styles/site-summary.module.css'
import selectionControlsStyles from '../../../components/workspace-styles/selection-controls.module.css'
import versionHistoryStyles from '../../../components/workspace-styles/version-history.module.css'
import ownedStyles from './native-site-overview-styles.module.css'

type Props = {
  site: SiteRow
  editorCanvasOrigin: string | null
  principal: Principal
  email: string
  role: string
  pages: WorkspacePage[]
  storyCount?: number
  archivedPages: Awaited<ReturnType<typeof listArchivedPages>>
  lists: CollectionWorkspace | null
  reviews: ReviewSubmission[]
  canManagePages: boolean
  liveOrigin: string | null
  created?: string
  error?: string
}
/** The native workboard reads existing authorized records; it never publishes or refreshes a source. */
export async function NativeSiteOverview({
  site,
  editorCanvasOrigin,
  principal,
  email,
  role,
  pages,
  storyCount = 0,
  archivedPages,
  lists,
  reviews,
  canManagePages,
  liveOrigin,
  created,
  error,
}: Props) {
  const base = '/sites/' + site.id,
    active = site.status !== 'archived',
    scoped = !principal.isSuperAdmin && !principal.memberships.has(site.id),
    canAdmin = principal.isSuperAdmin || principal.memberships.get(site.id) === 'site_admin',
    home = pages.find(page => page.slug === ''),
    first = scoped ? pages[0] : home,
    published = pages.filter(page => page.published_version_id).length,
    changed = pages.filter(page => editorialPosture(page).hasUnpublishedChanges),
    samples = pages.filter(page => page.live_samples)
  const people = principal.isSuperAdmin
    ? (await listPeople(principal.userId)).filter(
        person =>
          person.status === 'active' &&
          overviewPerson(person) &&
          (person.super_admin ||
            person.memberships.some(m => m.siteId === site.id) ||
            person.pageAssignments.some(p => p.siteId === site.id && p.enabled) ||
            person.divisionAssignments.some(d => d.siteId === site.id)),
      )
    : []
  const accessRole =
    principal.memberships.get(site.id) ??
    ([...(principal.divisionScopes?.values() ?? [])].some(scope => scope.siteId === site.id) ? 'editor' : 'contributor')
  const changedLists =
    lists?.collections.filter(
      list => list.changedEntries > 0 || list.draftSchemaVersionId !== list.publishedSchemaVersionId,
    ) ?? []
  const attention = [
    ...(reviews.length
      ? [
          {
            key: 'reviews',
            title: reviews.length + ' ' + (reviews.length === 1 ? 'page is' : 'pages are') + ' in review',
            detail: 'Saved changes are waiting for approval.',
            href: '/inbox',
            action: 'Review submissions',
          },
        ]
      : []),
    ...(changed.length
      ? [
          {
            key: 'changes',
            title: changed.length + ' ' + (changed.length === 1 ? 'page has' : 'pages have') + ' changes not live',
            detail: 'Saved drafts stay private until approved publication.',
            href: canManagePages ? base + '/publishing' : '/pages/' + changed[0]!.id,
            action: canManagePages ? 'Review changes' : 'Open page',
          },
        ]
      : []),
    ...(changedLists.length
      ? [
          {
            key: 'lists',
            title:
              changedLists.length + ' ' + (changedLists.length === 1 ? 'list has' : 'lists have') + ' changes not live',
            detail: 'Saved list items or fields differ from their published version.',
            href: base + '/content',
            action: 'Open Lists',
          },
        ]
      : []),
    ...(samples.length
      ? [
          {
            key: 'samples',
            title: samples.length + ' ' + (samples.length === 1 ? 'page has' : 'pages have') + ' sample content live',
            detail: 'Replace the marked samples with reviewed content.',
            href: '/pages/' + samples[0]!.id,
            action: 'Replace samples',
          },
        ]
      : []),
  ]
  return (
    <AppShell email={email} role={role} groups={navigationFor(site, principal)}>
      <main
        id="main"
        className={
          'wrap ' + shared.page + ' ' + workspaceFormsStyles.compactForm + ' ' + versionHistoryStyles.documentStack
        }
        data-layout="compact"
      >
        <PageHeader
          title={site.name}
          showWayfinding={false}
          sub={
            <>
              {active ? (
                <StatusChip
                  status={siteStatus({
                    ...site,
                    published_count: String(published),
                    changed_count: String(changed.length),
                  })}
                />
              ) : (
                <span className="chip chip-neutral">Archived</span>
              )}
              <span className={recordTableStyles.meta}>
                {site.primary_hostname ?? site.staging_hostname ?? 'No public address'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{contentCounts(pages.length, storyCount)}</span>
            </>
          }
          actions={
            <>
              {liveOrigin && published > 0 && (
                <ButtonLink variant="secondary" href={liveOrigin} target="_blank" rel="noopener">
                  <IconExternal size={15} />
                  View the site
                </ButtonLink>
              )}
              {active && first && (
                <ButtonLink editorCanvasOrigin={editorCanvasOrigin} href={'/pages/' + first.id}>
                  {scoped ? 'Edit ' + first.title : 'Edit home page'}
                </ButtonLink>
              )}
            </>
          }
        />
        {!site.primary_hostname && active && <SiteHostingNotice status={site.hosting_status} />}
        {site.initial_release_required && (
          <p className="notice notice-ok" role="status">
            <span className="notice-body">
              Your new site is private until you publish it. Open a page to change its words and photos.{' '}
              {canManagePages ? (
                <>
                  Review the first publication in <TextLink href={base + '/publishing'}>Publish</TextLink>.
                </>
              ) : (
                <>Send your saved draft for approval.</>
              )}
            </span>
          </p>
        )}
        {!active && (
          <p className="notice" role="status">
            This site is archived and is not available at its public addresses. Its content and history are retained
            here.
          </p>
        )}
        {created && (
          <p className="notice notice-ok" role="status">
            “{created}” was created as a draft. It is not on the live site until you publish it.
          </p>
        )}
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {active && (
          <section aria-label="Quick actions">
            <h2 className={selectionControlsStyles.visuallyHidden}>Quick actions</h2>
            <div className={siteSummaryStyles.quickActions}>
              {canManagePages && <NativeNewPage siteId={site.id} canAdmin={canAdmin} pages={pages} asTask />}
              {canManagePages && (
                <Link className={siteSummaryStyles.task} href={base + '/pages'}>
                  <span className={siteSummaryStyles.taskIcon}>
                    <IconPage size={18} />
                  </span>
                  <strong>Manage pages</strong>
                </Link>
              )}
              {!scoped && (
                <Link className={siteSummaryStyles.task} href={base + '/content'}>
                  <span className={siteSummaryStyles.taskIcon} data-tone="live">
                    <IconCollection size={18} />
                  </span>
                  <strong>Update lists</strong>
                </Link>
              )}
              {canAdmin && (
                <Link className={siteSummaryStyles.task} href={base + '/design'}>
                  <span className={siteSummaryStyles.taskIcon} data-tone="review">
                    <IconBrush size={18} />
                  </span>
                  <strong>Change site look</strong>
                </Link>
              )}
              {scoped && first && (
                <Link
                  className={siteSummaryStyles.task}
                  editorCanvasOrigin={editorCanvasOrigin}
                  href={'/pages/' + first.id}
                >
                  <span className={siteSummaryStyles.taskIcon}>
                    <IconPage size={18} />
                  </span>
                  <strong>Edit {first.title}</strong>
                </Link>
              )}
            </div>
          </section>
        )}
        <div className={ownedStyles.summaryColumns}>
          <div className={shared.denseStack}>
            <Card
              title="Needs attention"
              density="compact"
              headerActions={
                <span className={recordTableStyles.meta}>
                  {attention.length} {attention.length === 1 ? 'item' : 'items'}
                </span>
              }
            >
              <ul className={siteSummaryStyles.rowList}>
                {!attention.length && (
                  <li>
                    <span className={siteSummaryStyles.taskIcon}>
                      <IconCheck size={18} />
                    </span>
                    <div className={recordTableStyles.rowCopy}>
                      {active
                        ? 'No saved page or list changes need attention.'
                        : 'This site is archived. Its saved history is retained.'}
                    </div>
                  </li>
                )}
                {attention.map(item => (
                  <li key={item.key}>
                    <span
                      className={siteSummaryStyles.taskIcon}
                      data-tone={item.key === 'reviews' ? 'review' : item.key === 'samples' ? 'pending' : undefined}
                    >
                      {item.key === 'reviews' ? (
                        <IconMail size={18} />
                      ) : item.key === 'changes' ? (
                        <IconClock size={18} />
                      ) : (
                        <IconAlert size={18} />
                      )}
                    </span>
                    <div className={recordTableStyles.rowCopy}>
                      <strong>{item.title}</strong>
                      <span className={recordTableStyles.meta}>{item.detail}</span>
                    </div>
                    <ButtonLink variant="secondary" href={item.href}>
                      {item.action}
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            </Card>
            <Card
              title="Recent changes"
              density="compact"
              headerActions={<Link href={'/activity?site=' + site.id}>Site activity</Link>}
            >
              <ul className={siteSummaryStyles.rowList}>
                {[...pages]
                  .sort((a, b) => Date.parse(b.edited_at) - Date.parse(a.edited_at))
                  .slice(0, 4)
                  .map(page => (
                    <li key={page.id}>
                      <span className={siteSummaryStyles.taskIcon}>
                        <IconPage size={18} />
                      </span>
                      <div className={recordTableStyles.rowCopy}>
                        <Link
                          editorCanvasOrigin={editorCanvasOrigin}
                          href={'/pages/' + page.id}
                          aria-label={'Open recent change: ' + page.title}
                        >
                          {page.title}
                        </Link>
                        <time className={recordTableStyles.meta} dateTime={page.edited_at}>
                          {page.edited_by} · {reviewDate(page.edited_at)}
                        </time>
                      </div>
                      <StatusChip status={pageStatus(page)} />
                    </li>
                  ))}
                {!pages.length && (
                  <li>
                    <div className={recordTableStyles.rowCopy}>
                      No page changes to show.<Link href={base + '/pages'}>Open Pages</Link>
                    </div>
                  </li>
                )}
              </ul>
            </Card>
          </div>
          <div className={shared.denseStack}>
            {!scoped && (
              <Card title="Lists" density="compact" headerActions={<Link href={base + '/content'}>Open Lists</Link>}>
                <ul className={siteSummaryStyles.rowList}>
                  {lists?.collections.map(list => (
                    <li key={list.id}>
                      <div className={recordTableStyles.rowCopy}>
                        <Link
                          href={
                            list.readerKey === 'stories' ? base + '/stories' : base + '/content?collection=' + list.id
                          }
                        >
                          <strong>{list.name}</strong>
                        </Link>
                        <span className={recordTableStyles.meta}>
                          {list.totalEntries} {list.totalEntries === 1 ? 'item' : 'items'} · {list.changedEntries} with
                          changes not live
                        </span>
                      </div>
                    </li>
                  ))}
                  {!lists?.collections.length && (
                    <li>
                      <div className={recordTableStyles.rowCopy}>
                        No lists yet.<Link href={base + '/content'}>Open Lists to get started</Link>
                      </div>
                    </li>
                  )}
                </ul>
              </Card>
            )}
            <Card
              title={principal.isSuperAdmin ? 'People' : 'Your access'}
              density="compact"
              headerActions={principal.isSuperAdmin ? <Link href="/people">Manage</Link> : undefined}
            >
              <ul className={siteSummaryStyles.rowList}>
                {principal.isSuperAdmin ? (
                  people.slice(0, 4).map(person => (
                    <li key={person.id}>
                      <span className={siteSummaryStyles.taskIcon} data-tone="review">
                        <IconPeople size={18} />
                      </span>
                      <div className={recordTableStyles.rowCopy}>
                        <strong
                          className={recordTableStyles.singleLine}
                          title={person.id === principal.userId ? 'You' : person.display_name}
                        >
                          {person.id === principal.userId ? 'You' : person.display_name}
                        </strong>
                        <span className={recordTableStyles.meta}>
                          {personRoles({
                            ...person,
                            memberships: person.memberships.filter(m => m.siteId === site.id),
                            pageAssignments: person.pageAssignments.filter(p => p.siteId === site.id && p.enabled),
                            divisionAssignments: person.divisionAssignments.filter(d => d.siteId === site.id),
                          })}
                        </span>
                      </div>
                    </li>
                  ))
                ) : (
                  <li>
                    <div className={recordTableStyles.rowCopy}>
                      <strong>
                        {roleDisplayName(accessRole)}
                        {scoped ? (accessRole === 'editor' ? ' · division' : ' · assigned pages') : ''}
                      </strong>
                      <Link href="/people">View your access</Link>
                    </div>
                  </li>
                )}
                {people.length > 4 && (
                  <li>
                    <TextLink href="/people">View all {people.length} people with access</TextLink>
                  </li>
                )}
              </ul>
            </Card>
          </div>
        </div>
        <section aria-labelledby="site-pages-title">
          <h2 id="site-pages-title">Pages</h2>
          <PagesTable
            compactActions
            editorCanvasOrigin={editorCanvasOrigin}
            pages={pages}
            canManage={active && canManagePages}
            liveOrigin={liveOrigin}
          />
        </section>
        {canManagePages && archivedPages.length > 0 && (
          <Disclosure title={<>Archived pages ({archivedPages.length})</>} className="archived-pages">
            <p>These pages can be restored with their full history.</p>
            <ul className="archived-list">
              {archivedPages.map(page => (
                <li className="archived-row" key={page.id}>
                  <div>
                    <strong>{page.title}</strong>
                    <p>
                      <span className="mono">{page.slug ? '/' + page.slug : '/'}</span> · Full history retained
                    </p>
                  </div>
                  <PageManagement
                    pageId={page.id}
                    title={page.title}
                    slug={page.slug}
                    revision={page.revision}
                    live={false}
                    archived
                  />
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </main>
    </AppShell>
  )
}
