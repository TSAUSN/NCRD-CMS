import { GeneralSettingsWorkspace } from './general-workspace.tsx'
import { getSiteSettingsWorkspace } from '../../../../lib/site-settings.ts'
import { SettingsNavigation } from '../../../../components/settings-navigation.tsx'
import { StoriesSettings, type StoriesPolicy } from './stories-settings.tsx'
import workspace from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import { localChapterMailOrigin } from '../../../../lib/local-chapter-mail.ts'
import { ChapterChecks } from './chapter-checks.tsx'
import { chapterWorkspaceOptions, chapterTeams } from '../../../../lib/chapters.ts'
import { ChapterSettings } from './chapter-settings.tsx'
import { notFound } from 'next/navigation'
import { asUser } from '@cms/platform'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader, siteAreaTabs } from '../../../../components/shell.tsx'
import { getSite, roleLabel } from '../../../../lib/queries.ts'
import { currentSession } from '../../../../lib/session.ts'
import { ContentExport } from './content-export.tsx'
import { Card } from '../../../../components/ui/card.tsx'
import { TextLink as Link, Disclosure } from '../../../../components/ui/index.ts'
import { SiteSettingsForm, ArchiveSite } from './settings-form.tsx'

export const dynamic = 'force-dynamic'
export default async function SiteSettings({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [details, role] = await Promise.all([
    asUser(
      { userId: session.principal.userId },
      async client =>
        (
          await client.query<{ revision: string; kind: string }>('SELECT revision,kind FROM sites WHERE id=$1', [
            siteId,
          ])
        ).rows[0]!,
    ),
    roleLabel(session.principal.userId),
  ])
  const canManage = session.principal.isSuperAdmin || session.principal.memberships.get(siteId) === 'site_admin'
  const native = !site.original_design
  if (native && !canManage) notFound()
  const tab = native ? ((await searchParams).tab ?? 'general') : 'legacy'
  if (native && !['general', 'publishing', 'reviews', 'advanced'].includes(tab)) notFound()
  if (tab === 'general') {
    const initial = await getSiteSettingsWorkspace(session.principal.userId, siteId)
    return (
      <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
        <main id="main" className={'wrap wrap-wide ' + workspace.page + ' ' + workspaceFormsStyles.compactForm}>
          <GeneralSettingsWorkspace
            key={siteId}
            siteId={siteId}
            siteName={site.name}
            chapters={Boolean(site.chapters_enabled)}
            archived={site.status === 'archived'}
            initial={initial}
          />
        </main>
      </AppShell>
    )
  }
  const storiesPolicy =
    canManage && !site.original_design && site.status !== 'archived'
      ? await asUser({ userId: session.principal.userId }, async client => {
          const row = (
            await client.query(
              `SELECT c.id,c.revision,c.entry_revision,v.sort,c.draft_schema_version_id IS DISTINCT FROM c.published_schema_version_id AS changed FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.site_id=$1 AND c.reader_key='stories'`,
              [siteId],
            )
          ).rows[0]
          return row
            ? ({
                collectionId: String(row.id),
                revision: String(row.revision),
                entryRevision: String(row.entry_revision),
                publishUnreviewed: row.sort?.stories?.publishUnreviewed !== false,
                configured: Boolean(row.sort?.stories),
                changed: Boolean(row.changed),
              } satisfies StoriesPolicy)
            : null
        })
      : null
  const chapterOptions =
    canManage && site.chapters_enabled ? await chapterWorkspaceOptions(session.principal.userId, siteId) : null
  const teams = chapterOptions ? await chapterTeams(session.principal.userId, siteId) : []
  if (native)
    return (
      <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
        <main id="main" className={'wrap wrap-wide ' + workspace.page + ' ' + workspaceFormsStyles.compactForm}>
          <div className={workspace.denseStack} data-layout="compact">
            <PageHeader
              title="Settings"
              density="compact"
              showWayfinding={false}
              sub={site.name + ' · rules for the whole site. Each section explains when its changes take effect.'}
            />
            {site.status === 'archived' && (
              <p role="status">This site is archived. Its settings remain available in History.</p>
            )}
            <div className={workspace.workspaceSplit} data-layout="compact">
              <SettingsNavigation
                siteId={siteId}
                current={
                  tab === 'publishing' ? 'Publishing & approval' : tab === 'reviews' ? 'Review reminders' : 'Advanced'
                }
              />
              <div className={workspace.denseStack}>
                {tab === 'publishing' && chapterOptions && (
                  <ChapterSettings
                    actorId={session.principal.userId}
                    siteId={siteId}
                    revision={chapterOptions.revision}
                    defaultMode={chapterOptions.defaultMode}
                    teams={teams}
                  />
                )}
                {tab === 'publishing' &&
                  site.status !== 'archived' &&
                  (chapterOptions ? (
                    <Disclosure title="Stories settings">
                      <div>
                        <StoriesSettings siteId={siteId} policy={storiesPolicy} />
                      </div>
                    </Disclosure>
                  ) : (
                    <StoriesSettings siteId={siteId} policy={storiesPolicy} />
                  ))}
                {tab === 'reviews' &&
                  (chapterOptions && localChapterMailOrigin() ? (
                    <ChapterChecks
                      isSuperAdmin={session.principal.isSuperAdmin}
                      actorId={session.principal.userId}
                      siteId={siteId}
                      revision={chapterOptions.revision}
                      checksEnabled={chapterOptions.checksEnabled}
                      remindersEnabled={chapterOptions.reviewRemindersEnabled}
                      year={new Date().getFullYear() + 1}
                    />
                  ) : (
                    <Card title="Review reminders" density="editor">
                      <p>Chapter review reminders are not set up for this site.</p>
                      <p>Review dates for individual pages stay on each page.</p>
                    </Card>
                  ))}
                {tab === 'advanced' && (
                  <>
                    <Card density="settings" title="Address & domains">
                      <dl className="facts">
                        <div>
                          <dt>Kind</dt>
                          <dd>
                            {details.kind === 'event'
                              ? 'Event site'
                              : details.kind === 'resource'
                                ? 'Resource site'
                                : 'Website'}
                          </dd>
                        </div>
                        <div>
                          <dt>Preview address</dt>
                          <dd>
                            {site.staging_hostname ? (
                              <span className="mono">{site.staging_hostname}</span>
                            ) : (
                              'Not set up'
                            )}
                            <p className="hint">
                              Shows published pages before the site has its own address. Search engines are asked to
                              ignore it.
                            </p>
                          </dd>
                        </div>
                      </dl>
                      <p>
                        <Link href={'/sites/' + siteId + '/domains'}>Manage site addresses</Link>
                      </p>
                    </Card>
                    <Card density="settings" title="People on this site">
                      <p>People with access can keep this site up to date. A site administrator manages their roles.</p>
                      <p>
                        <Link href="/people">View people and access</Link>
                      </p>
                    </Card>
                    {session.principal.isSuperAdmin && (
                      <Card density="settings" title="Site scripts and files">
                        <p>
                          Review self-hosted files, their sources and where they run. Approved changes publish through
                          the site release.
                        </p>
                        <p>
                          <Link href={'/sites/' + siteId + '/scripts'}>Manage site scripts and files</Link>
                        </p>
                      </Card>
                    )}
                    <ContentExport siteId={siteId} chaptersEnabled={site.chapters_enabled} />
                    {site.status !== 'archived' && (
                      <ArchiveSite siteId={siteId} name={site.name} revision={details.revision} />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </main>
      </AppShell>
    )
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap ' + workspaceFormsStyles.compactForm}>
        <PageHeader
          title="Settings"
          crumbs={[
            { label: 'Sites', href: '/' },
            { label: site.name, href: `/sites/${siteId}` },
            { label: 'Settings' },
          ]}
          lede="The site's name, its addresses and a downloadable copy of its content."
          tabs={siteAreaTabs(siteId, 'settings', 'settings')}
        />
        {canManage && !site.original_design && (
          <SettingsNavigation siteId={siteId} current="General" chapters={site.chapters_enabled} />
        )}
        <SiteSettingsForm
          siteId={siteId}
          name={site.name}
          revision={details.revision}
          archived={site.status === 'archived'}
          canManage={canManage}
        />
        <span id="publishing-approval" />
        {canManage && !site.original_design && site.status !== 'archived' && (
          <StoriesSettings siteId={siteId} policy={storiesPolicy} />
        )}
        {chapterOptions && (
          <ChapterSettings
            actorId={session.principal.userId}
            siteId={siteId}
            revision={chapterOptions.revision}
            defaultMode={chapterOptions.defaultMode}
            teams={teams}
          />
        )}
        <span id="review-reminders" />
        {chapterOptions && localChapterMailOrigin() && (
          <ChapterChecks
            isSuperAdmin={session.principal.isSuperAdmin}
            actorId={session.principal.userId}
            siteId={siteId}
            revision={chapterOptions.revision}
            checksEnabled={chapterOptions.checksEnabled}
            remindersEnabled={chapterOptions.reviewRemindersEnabled}
            year={new Date().getFullYear() + 1}
          />
        )}
        {canManage && site.status !== 'archived' && (
          <Card density="settings" title="Redirects">
            <p>
              Keep old links working by sending visitors to their new page on this site. Add a redirect or import
              addresses from a spreadsheet.
            </p>
            <p>
              <Link href={'/sites/' + siteId + '/redirects'}>Manage redirects</Link>
            </p>
          </Card>
        )}
        <Card density="settings" title="Address & domains">
          <dl className="facts">
            <div>
              <dt>Kind</dt>
              <dd>
                {details.kind === 'event' ? 'Event site' : details.kind === 'resource' ? 'Resource site' : 'Website'}
              </dd>
            </div>
            <div>
              <dt>Preview address</dt>
              <dd>
                {site.staging_hostname ? <span className="mono">{site.staging_hostname}</span> : 'Not set up'}
                <p className="hint">
                  Shows published pages before the site has its own address. Search engines are asked to ignore it.
                </p>
              </dd>
            </div>
          </dl>
          <p>
            <Link href={`/sites/${siteId}/domains`}>Manage site addresses</Link>
          </p>
        </Card>
        <Card density="settings" title="People on this site">
          <p>People with access can keep this site up to date. A site administrator manages their roles.</p>
          <p>
            <Link href="/people">View people and access</Link>
          </p>
        </Card>
        {session.principal.isSuperAdmin && (
          <Card density="settings" title="Site scripts and files">
            <p>
              Review self-hosted files, their sources and where they run. Approved changes publish through the site
              release.
            </p>
            <p>
              <Link href={`/sites/${siteId}/scripts`}>Manage site scripts and files</Link>
            </p>
          </Card>
        )}
        {canManage && <ContentExport siteId={siteId} chaptersEnabled={site.chapters_enabled} />}
        {canManage && site.status !== 'archived' && (
          <ArchiveSite siteId={siteId} name={site.name} revision={details.revision} />
        )}
      </main>
    </AppShell>
  )
}
