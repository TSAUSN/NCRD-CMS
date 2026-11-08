import type { Principal } from '@cms/domain'
import type { WorkspacePage } from '../../../lib/workspace-queries.ts'
import type { CollectionWorkspace } from '../../../lib/collection-queries.ts'
import type { ReviewSubmission } from '../../../lib/review-queries.ts'
import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import { reviewDate } from '../../../lib/review-time.ts'
import { overviewPerson } from '../../../lib/overview-people.ts'
import { listPeople } from '../../../lib/people.ts'
import { roleDisplayName } from '../../../lib/role-display.ts'
import { personRoles } from '../../../lib/people-access.ts'
import { ButtonLink, Card, TextLink } from '../../../components/ui/index.ts'
import { StatusChip, pageStatus } from '../../../components/status.tsx'
import { IconAlert, IconCheck, IconClock, IconMail, IconPage, IconPeople } from '../../../components/icons.tsx'
import shared from '../../../components/workspace.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../components/workspace-styles/site-summary.module.css'
import ownedStyles from './native-site-overview-styles.module.css'

export async function NativeSiteSummary({
  siteId,
  editorCanvasOrigin,
  principal,
  pages,
  lists,
  reviews,
  canManagePages,
  active,
  scoped,
  changed,
}: {
  siteId: string
  editorCanvasOrigin: string | null
  principal: Principal
  pages: WorkspacePage[]
  lists: CollectionWorkspace | null
  reviews: ReviewSubmission[]
  canManagePages: boolean
  active: boolean
  scoped: boolean
  changed: WorkspacePage[]
}) {
  const base = '/sites/' + siteId
  const samples = pages.filter(page => page.live_samples)
  const people = principal.isSuperAdmin
    ? (await listPeople(principal.userId)).filter(
        person =>
          person.status === 'active' &&
          overviewPerson(person) &&
          (person.super_admin ||
            person.memberships.some(m => m.siteId === siteId) ||
            person.pageAssignments.some(p => p.siteId === siteId && p.enabled) ||
            person.divisionAssignments.some(d => d.siteId === siteId)),
      )
    : []
  const accessRole =
    principal.memberships.get(siteId) ??
    ([...(principal.divisionScopes?.values() ?? [])].some(scope => scope.siteId === siteId) ? 'editor' : 'contributor')
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
          headerActions={<Link href={'/activity?site=' + siteId}>Site activity</Link>}
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
                      href={list.readerKey === 'stories' ? base + '/stories' : base + '/content?collection=' + list.id}
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
                        memberships: person.memberships.filter(m => m.siteId === siteId),
                        pageAssignments: person.pageAssignments.filter(p => p.siteId === siteId && p.enabled),
                        divisionAssignments: person.divisionAssignments.filter(d => d.siteId === siteId),
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
  )
}
