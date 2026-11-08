import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import type { Principal } from '@cms/domain'
import type { SiteRow, listArchivedPages } from '../../../lib/queries.ts'
import type { WorkspacePage } from '../../../lib/workspace-queries.ts'
import type { CollectionWorkspace } from '../../../lib/collection-queries.ts'
import type { ReviewSubmission } from '../../../lib/review-queries.ts'
import { contentCounts } from '../../../lib/content-counts.ts'
import { editorialPosture } from '../../../lib/editorial-posture.ts'
import { AppShell } from '../../../components/app-shell.tsx'
import { navigationFor } from '../../../components/nav.ts'
import { PageHeader } from '../../../components/shell.tsx'
import { ButtonLink, TextLink } from '../../../components/ui/index.ts'
import { StatusChip, siteStatus } from '../../../components/status.tsx'
import { IconAlert, IconBrush, IconCollection, IconExternal, IconPage } from '../../../components/icons.tsx'
import { SiteHostingNotice } from '../../../components/site-hosting-notice.tsx'
import { NativeSiteSummary } from './native-site-summary.tsx'
import { ArchivedPages } from './archived-pages.tsx'
import { NativeNewPage } from './native-new-page.tsx'
import { PagesTable } from './pages-table.tsx'
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
export function NativeSiteOverview({
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
  const base = '/sites/' + site.id
  const active = site.status !== 'archived'
  const scoped = !principal.isSuperAdmin && !principal.memberships.has(site.id)
  const canAdmin = principal.isSuperAdmin || principal.memberships.get(site.id) === 'site_admin'
  const home = pages.find(page => page.slug === '')
  const first = scoped ? pages[0] : home
  const published = pages.filter(page => page.published_version_id).length
  const changed = pages.filter(page => editorialPosture(page).hasUnpublishedChanges)
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

        <NativeSiteSummary
          siteId={site.id}
          editorCanvasOrigin={editorCanvasOrigin}
          principal={principal}
          pages={pages}
          lists={lists}
          reviews={reviews}
          canManagePages={canManagePages}
          active={active}
          scoped={scoped}
          changed={changed}
        />
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

        {canManagePages && <ArchivedPages pages={archivedPages} />}
      </main>
    </AppShell>
  )
}
