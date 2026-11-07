import { NativeHistory } from './native-history.tsx'
import { historyPresentation } from '../../../../lib/history-presentation.ts'
import shared from '../../../../components/workspace.module.css'
import { ScriptlessPreview } from '../../../../components/scriptless-preview.tsx'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import { notFound } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell.tsx'
import { IconChevronLeft, IconClock } from '../../../../components/icons.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader } from '../../../../components/shell.tsx'
import {
  getDraft,
  getPage,
  getPageHistoryVersion,
  getSite,
  listPageHistory,
  roleLabel,
  type PageHistoryRow,
} from '../../../../lib/queries.ts'
import { currentSession } from '../../../../lib/session.ts'
import { compareVersions, comparisonText } from '../../../../lib/version-comparison.ts'
import { RestoreButton } from './restore-button.tsx'

export const dynamic = 'force-dynamic'

function historyLabel(version: PageHistoryRow): string {
  if (version.is_live_now) return 'Live now'
  if (version.is_current_draft) return 'Current draft'
  if (version.was_published) return 'Published before'
  if (version.was_restored) return 'Restored version'
  if (version.kind === 'checkpoint') return 'Saved draft'
  if (version.kind === 'autosave') return 'Automatic save'
  return 'Saved version'
}

function when(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/New_York',
  }).format(date)
}

function historyHref(
  pageId: string,
  options: {
    version?: string
    compare?: string | undefined
    includeAutosaves: boolean
    before?: string | null
  },
): string {
  const params = new URLSearchParams()
  if (options.version) params.set('version', options.version)
  if (options.compare && options.compare !== options.version) params.set('compare', options.compare)
  if (options.includeAutosaves) params.set('automatic', '1')
  if (options.before) params.set('before', String(options.before))
  const query = params.toString()
  return `/pages/${pageId}/history${query ? `?${query}` : ''}`
}

const MAX_REVISION = 9_223_372_036_854_775_807n

/** A URL cursor stays an exact Postgres bigint instead of passing through JS numbers. */
function revisionCursor(value: string | undefined): string | null {
  if (!value || !/^[1-9]\d{0,18}$/.test(value)) return null
  return BigInt(value) <= MAX_REVISION ? value : null
}

export default async function PageHistory({
  params,
  searchParams,
}: {
  params: Promise<{ pageId: string }>
  searchParams: Promise<{ version?: string; compare?: string; automatic?: string; before?: string }>
}) {
  const session = await currentSession()
  if (!session) notFound()
  const { pageId } = await params
  const requested = await searchParams
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (
    !uuid.test(pageId) ||
    (requested.version && !uuid.test(requested.version)) ||
    (requested.compare && requested.compare !== 'none' && !uuid.test(requested.compare))
  )
    notFound()
  const before = revisionCursor(requested.before)
  const includeAutosaves = requested.automatic === '1'

  const page = await getPage(session.principal.userId, pageId)
  if (!page) notFound()
  const site = await getSite(session.principal.userId, page.site_id)
  if (!site) notFound()

  const [history, role] = await Promise.all([
    listPageHistory(session.principal.userId, pageId, {
      includeAutosaves,
      beforeRevision: before,
    }),
    roleLabel(session.principal.userId),
  ])
  const requestedVersion = requested.version
    ? await getPageHistoryVersion(session.principal.userId, pageId, requested.version)
    : null
  const selected = requestedVersion ?? history.items[0] ?? null
  if (requested.version && !requestedVersion) notFound()
  const comparisonId =
    requested.compare === 'none'
      ? null
      : (requested.compare ??
        (!site.original_design && selected && page.draft_version_id !== selected.id ? page.draft_version_id : null))
  const compared =
    comparisonId && comparisonId !== selected?.id
      ? await getPageHistoryVersion(session.principal.userId, pageId, comparisonId)
      : null
  if (requested.compare && requested.compare !== 'none' && requested.compare !== selected?.id && !compared) notFound()
  const [beforeVersion, afterVersion] =
    selected && compared
      ? await Promise.all([
          getDraft(session.principal.userId, compared.id),
          getDraft(session.principal.userId, selected.id),
        ])
      : [null, null]
  const changes = beforeVersion && afterVersion ? compareVersions(beforeVersion, afterVersion) : []
  const comparisonOptions = history.items.filter(version => version.id !== selected?.id)
  if (compared && !comparisonOptions.some(version => version.id === compared.id)) comparisonOptions.push(compared)
  const remainsVisibleWithoutAutosaves =
    selected !== null &&
    (selected.kind !== 'autosave' || selected.is_current_draft || selected.is_live_now || selected.was_published)
  const toggledVersion = !includeAutosaves || remainsVisibleWithoutAutosaves ? selected?.id : undefined

  if (!site.original_design) {
    const version = (row: PageHistoryRow) => ({
      id: row.id,
      revision: row.revision,
      label: historyLabel(row),
      when: when(row.created_at),
      kind: row.kind,
      note: row.note,
      mine: row.authored_by_me,
      current: row.is_current_draft,
      live: row.is_live_now,
      published: row.was_published,
      href: historyHref(pageId, { version: row.id, compare: compared?.id, includeAutosaves, before }),
    })
    const presentation =
      beforeVersion && afterVersion
        ? await historyPresentation(session.principal.userId, site.id, afterVersion, beforeVersion)
        : null
    const nativeChanges = beforeVersion && afterVersion ? compareVersions(afterVersion, beforeVersion) : []
    return (
      <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
        <main id="main">
          <NativeHistory
            pageId={pageId}
            pageTitle={page.title}
            revision={page.revision}
            archived={site.status === 'archived'}
            wholeSiteHref={
              session.principal.isSuperAdmin || session.principal.memberships.has(site.id)
                ? '/sites/' + site.id + '/publishing?tab=history'
                : null
            }
            versions={history.items.map(version)}
            selected={selected ? version(selected) : null}
            compared={compared ? version(compared) : null}
            comparisonOptions={comparisonOptions.map(version)}
            automatic={includeAutosaves}
            toggleHref={historyHref(pageId, {
              version: toggledVersion,
              compare: requested.compare === 'none' ? 'none' : compared?.id,
              includeAutosaves: !includeAutosaves,
              before,
            })}
            newerHref={before !== null ? historyHref(pageId, { includeAutosaves }) : null}
            olderHref={
              history.nextBefore !== null ? historyHref(pageId, { includeAutosaves, before: history.nextBefore }) : null
            }
            before={before}
            closeComparisonHref={
              historyHref(pageId, { version: selected?.id, includeAutosaves, before }) +
              (selected ? '&' : '?') +
              'compare=none'
            }
            presentation={presentation}
            changes={nativeChanges}
            canInspect={session.principal.isSuperAdmin}
          />
        </main>
      </AppShell>
    )
  }

  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className="wrap history-page">
        <PageHeader
          crumbs={[
            { label: 'Sites', href: '/' },
            { label: site.name, href: `/sites/${site.id}` },
            { label: page.title, href: `/pages/${page.id}` },
            { label: 'History' },
          ]}
          title="Page history"
          lede={
            site.status === 'archived'
              ? 'This site is archived. Saved versions and comparisons are read-only; restoring is disabled.'
              : 'Open an earlier version or turn it into a new draft. Restoring never changes the live page.'
          }
          actions={
            <Link className="btn secondary" href={`/pages/${page.id}`}>
              <IconChevronLeft size={15} /> {site.status === 'archived' ? 'Back to saved page' : 'Back to editor'}
            </Link>
          }
        />

        <div className="history-toolbar">
          <p>
            <IconClock size={16} /> Restoring makes a new draft. Earlier versions stay in history.
          </p>
          <Link
            className="btn secondary small"
            href={historyHref(pageId, {
              version: toggledVersion,
              compare: compared?.id,
              includeAutosaves: !includeAutosaves,
              before,
            })}
          >
            {includeAutosaves ? 'Hide automatic saves' : 'Show automatic saves'}
          </Link>
        </div>

        {selected ? (
          <div className={'history-layout ' + shared.timelineLayout}>
            <aside className={'history-list ' + shared.timelineRail} aria-label="Versions">
              {before !== null && (
                <Link className="btn secondary small history-newer" href={historyHref(pageId, { includeAutosaves })}>
                  Newer versions
                </Link>
              )}
              <ol>
                {history.items.map(version => {
                  const active = version.id === selected.id
                  return (
                    <li key={version.id}>
                      <Link
                        className={active ? 'is-active' : ''}
                        aria-current={active ? 'page' : undefined}
                        href={historyHref(pageId, {
                          version: version.id,
                          compare: compared?.id,
                          includeAutosaves,
                          before,
                        })}
                      >
                        <span className="history-version-head">
                          <strong>Version {version.revision}</strong>
                          <span className={`chip ${version.is_live_now ? 'chip-published' : 'chip-draft'}`}>
                            {historyLabel(version)}
                          </span>
                        </span>
                        <span>{when(version.created_at)}</span>
                        <small>{version.authored_by_me ? 'You' : 'Another editor'}</small>
                      </Link>
                    </li>
                  )
                })}
              </ol>
              {history.nextBefore !== null && (
                <Link
                  className="btn secondary small history-older"
                  href={historyHref(pageId, {
                    includeAutosaves,
                    before: history.nextBefore,
                  })}
                >
                  Older versions
                </Link>
              )}
            </aside>

            <section className={'history-detail ' + shared.workspaceContent} aria-labelledby="selected-version-title">
              <div className="history-detail-head">
                <div>
                  <p className="eyebrow">{historyLabel(selected)}</p>
                  <h2 id="selected-version-title">Version {selected.revision}</h2>
                  <p className="muted">
                    {when(selected.created_at)} · {selected.authored_by_me ? 'You' : 'Another editor'}
                  </p>
                </div>
                {site.status === 'archived' ? (
                  <span className="history-current">Read-only · Archived site</span>
                ) : selected.is_current_draft ? (
                  <span className="history-current">This is already the current draft</span>
                ) : (
                  <RestoreButton pageId={page.id} sourceVersionId={selected.id} revision={page.revision} />
                )}
              </div>
              {selected.note && <p className="history-note">{selected.note}</p>}
              <form className="history-compare-form" action={`/pages/${pageId}/history`} method="get">
                <input type="hidden" name="version" value={selected.id} />
                {includeAutosaves && <input type="hidden" name="automatic" value="1" />}
                {before && <input type="hidden" name="before" value={before} />}
                <label htmlFor="compare-version">Compare this version with</label>
                <select id="compare-version" name="compare" defaultValue={compared?.id ?? ''} required>
                  <option value="" disabled>
                    Choose another saved version
                  </option>
                  {comparisonOptions.map(version => (
                    <option key={version.id} value={version.id}>
                      Version {version.revision} · {historyLabel(version)} · {when(version.created_at)}
                    </option>
                  ))}
                </select>
                <button className="secondary" type="submit" disabled={!comparisonOptions.length}>
                  Compare versions
                </button>
                {compared && (
                  <Link
                    className="btn ghost small"
                    href={historyHref(pageId, {
                      version: selected.id,
                      includeAutosaves,
                      before,
                    })}
                  >
                    Close comparison
                  </Link>
                )}
              </form>
              <div className={compared ? 'history-preview-pair' : undefined}>
                {compared && (
                  <div className="history-preview-frame">
                    <div className={'history-preview-bar ' + shared.previewCaption}>
                      Comparison · Version {compared.revision}
                    </div>
                    <ScriptlessPreview
                      title={`Comparison preview of version ${compared.revision}`}
                      loading="lazy"
                      src={`/preview/${compared.id}?readonly=1`}
                    />
                  </div>
                )}
                <div className="history-preview-frame">
                  <div className={'history-preview-bar ' + shared.previewCaption}>
                    Read-only preview{compared && ` · Version ${selected.revision}`}
                  </div>
                  <ScriptlessPreview
                    title={`Preview of version ${selected.revision}`}
                    src={`/preview/${selected.id}?readonly=1`}
                  />
                </div>
              </div>
              {compared && (
                <section aria-labelledby="version-changes-title" className="version-changes">
                  <h3 id="version-changes-title">
                    Version {compared.revision} → Version {selected.revision}
                  </h3>
                  <p>
                    {changes.length === 0
                      ? 'These versions have the same page details and section content.'
                      : `${changes.length} changed ${changes.length === 1 ? 'field' : 'fields'}. Sections are compared by position, so moving a section can also appear as field changes.`}
                  </p>
                  {changes.length > 0 && (
                    <div className="version-table-scroll">
                      <table>
                        <caption className="sr-only">Saved field values in the two selected versions</caption>
                        <thead>
                          <tr>
                            <th scope="col">Field</th>
                            <th scope="col">Version {compared.revision}</th>
                            <th scope="col">Version {selected.revision}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {changes.map((change, index) => (
                            <tr key={`${index}-${change.label}`}>
                              <th scope="row">{change.label}</th>
                              <td>
                                <pre>{comparisonText(change.before)}</pre>
                              </td>
                              <td>
                                <pre>{comparisonText(change.after)}</pre>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
            </section>
          </div>
        ) : (
          <div className="empty-state">
            <IconClock size={22} />
            <h2>No saved versions yet</h2>
            <p>
              {site.status === 'archived'
                ? 'This archived page has no saved versions to display.'
                : 'Make a change in the editor and save it; the version will appear here.'}
            </p>
            {before !== null && (
              <Link className="btn secondary" href={historyHref(pageId, { includeAutosaves })}>
                Return to the newest versions
              </Link>
            )}
          </div>
        )}
      </main>
    </AppShell>
  )
}
