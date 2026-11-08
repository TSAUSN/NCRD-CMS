import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import type { PageHistoryRow } from '../../../../lib/queries.ts'
import versionHistoryStyles from '../../../../components/workspace-styles/version-history.module.css'
import { historyHref, historyLabel, historyTime } from './history-display.ts'

export function OriginalHistoryTimeline({
  pageId,
  selectedId,
  comparedId,
  versions,
  includeAutosaves,
  before,
  nextBefore,
}: {
  pageId: string
  selectedId: string
  comparedId?: string
  versions: PageHistoryRow[]
  includeAutosaves: boolean
  before: string | null
  nextBefore: string | null
}) {
  return (
    <aside className={'history-list ' + versionHistoryStyles.timelineRail} aria-label="Versions">
      {before !== null && (
        <Link className="btn secondary small history-newer" href={historyHref(pageId, { includeAutosaves })}>
          Newer versions
        </Link>
      )}
      <ol>
        {versions.map(version => {
          const active = version.id === selectedId
          return (
            <li key={version.id}>
              <Link
                className={active ? 'is-active' : ''}
                aria-current={active ? 'page' : undefined}
                href={historyHref(pageId, {
                  version: version.id,
                  compare: comparedId,
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
                <span>{historyTime(version.created_at)}</span>
                <small>{version.authored_by_me ? 'You' : 'Another editor'}</small>
              </Link>
            </li>
          )
        })}
      </ol>
      {nextBefore !== null && (
        <Link
          className="btn secondary small history-older"
          href={historyHref(pageId, {
            includeAutosaves,
            before: nextBefore,
          })}
        >
          Older versions
        </Link>
      )}
    </aside>
  )
}
