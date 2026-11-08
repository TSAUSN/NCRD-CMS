'use client'
import { useState } from 'react'
import { TextLink as Link } from '../../../../components/ui/index.ts'
import {
  Workbench,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Badge,
  Field,
  Disclosure,
} from '../../../../components/ui/index.ts'
import { PageComparison } from '../../../../components/page-comparison.tsx'
import { RestoreButton } from './restore-button.tsx'
import { comparisonText, type VersionChange } from '../../../../lib/version-comparison.ts'
import type { ReleasePresentation } from '../../../../lib/release-copy.ts'
import shared from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import reviewWorkbenchStyles from '../../../../components/workspace-styles/review-workbench.module.css'
import workspacePreviewStyles from '../../../../components/workspace-styles/workspace-preview.module.css'
import ownedStyles from './native-history-styles.module.css'

type Version = {
  id: string
  revision: string
  label: string
  when: string
  kind: string
  note: string
  mine: boolean
  current: boolean
  live: boolean
  published: boolean
  href: string
}
type Props = {
  pageId: string
  pageTitle: string
  revision: string
  archived: boolean
  usesResponsiveMenu: boolean
  wholeSiteHref: string | null
  versions: Version[]
  selected: Version | null
  compared: Version | null
  comparisonOptions: Version[]
  automatic: boolean
  toggleHref: string
  newerHref: string | null
  olderHref: string | null
  before: string | null
  closeComparisonHref: string
  presentation: ReleasePresentation | null
  changes: VersionChange[]
  canInspect: boolean
}
export function NativeHistory(props: Props) {
  const [author, setAuthor] = useState('all')
  const [kind, setKind] = useState('all')
  const [onlyChanges, setOnlyChanges] = useState(false)
  const rows = props.versions.filter(
    row =>
      (author === 'all' || (author === 'you' && row.mine) || (author === 'others' && !row.mine)) &&
      (kind === 'all' ||
        (kind === 'published' && row.published) ||
        (kind === 'automatic' && row.kind === 'autosave') ||
        (kind === 'saved' && row.kind !== 'autosave')),
  )
  const selected = props.selected
  const compared = props.compared
  const queue = (
    <>
      <div className={reviewWorkbenchStyles.queueHeading}>
        <h1>Page history</h1>
        <p>{props.pageTitle}</p>
        <nav data-appearance="segmented" className={shared.areaNav} aria-label="History scope">
          <span aria-current="page">This page</span>
          {props.wholeSiteHref && <Link href={props.wholeSiteHref}>Whole site</Link>}
        </nav>
      </div>
      <div className={ownedStyles.historyFilters}>
        <Field density="compact" labelHidden id="history-author" label="Filter versions by author">
          <select value={author} onChange={event => setAuthor(event.target.value)}>
            <option value="all">Everyone</option>
            <option value="you">You</option>
            <option value="others">Other editors</option>
          </select>
        </Field>
        <Field density="compact" labelHidden id="history-kind" label="Filter versions by kind">
          <select value={kind} onChange={event => setKind(event.target.value)}>
            <option value="all">Any change</option>
            <option value="saved">Saved versions</option>
            <option value="published">Published versions</option>
            <option value="automatic">Automatic saves</option>
          </select>
        </Field>
        <Link href={props.toggleHref}>{props.automatic ? 'Hide automatic saves' : 'Show automatic saves'}</Link>
        {(author !== 'all' || kind !== 'all') && <p>Filters apply to the versions loaded here.</p>}
      </div>
      <aside aria-label="Versions">
        {props.newerHref && (
          <div className={ownedStyles.historyFilters}>
            <Link href={props.newerHref}>Newer versions</Link>
          </div>
        )}
        <ol className={reviewWorkbenchStyles.queueItems}>
          {rows.map(row => (
            <li key={row.id}>
              <Link href={row.href} aria-current={row.id === selected?.id ? 'true' : undefined}>
                <span className={recordTableStyles.summaryAction}>
                  <strong className={recordTableStyles.singleLine} title={row.note || 'Version ' + row.revision}>
                    {row.note || 'Version ' + row.revision}
                  </strong>
                  <Badge tone={row.live ? 'live' : row.current ? 'pending' : 'neutral'}>{row.label}</Badge>
                </span>
                <small
                  title={'Version ' + row.revision + ' · ' + (row.mine ? 'You' : 'Another editor') + ' · ' + row.when}
                >
                  Version {row.revision} · {row.mine ? 'You' : 'Another editor'}
                </small>
                <small>{row.when}</small>
              </Link>
            </li>
          ))}
        </ol>
        {!rows.length && (
          <div className={ownedStyles.historyFilters}>
            <p>{props.versions.length ? 'No loaded versions match these filters.' : 'No saved versions yet.'}</p>
            {props.versions.length > 0 && (
              <Button
                variant="secondary"
                onClick={() => {
                  setAuthor('all')
                  setKind('all')
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        )}
        {props.olderHref && (
          <div className={ownedStyles.historyFilters}>
            <Link href={props.olderHref}>Older versions</Link>
          </div>
        )}
      </aside>
    </>
  )
  return (
    <Workbench density="compact" storageKey="cms.history.queue-width" queueLabel="Version list" queue={queue}>
      <div className={reviewWorkbenchStyles.workbenchHeader}>
        <div>
          <p className={recordTableStyles.meta}>
            {props.pageTitle} · {compared ? 'Comparing saved versions' : 'Saved version'}
          </p>
          <h2>
            {selected
              ? 'Version ' +
                selected.revision +
                (compared ? ' → ' + (compared.current ? 'Current draft' : 'Version ' + compared.revision) : '')
              : 'No saved versions yet'}
          </h2>
          {props.presentation && (
            <p
              className={recordTableStyles.meta + ' ' + recordTableStyles.singleLine}
              title={props.presentation.summary}
            >
              {props.presentation.summary === 'No page changes' && props.changes.length
                ? 'Other saved details changed'
                : props.presentation.summary}
            </p>
          )}
        </div>
        <div className={workspaceFormsStyles.actions} role="group" aria-label="History actions">
          <ButtonLink variant="secondary" href={'/pages/' + props.pageId}>
            {props.archived ? 'Back to saved page' : 'Back to editor'}
          </ButtonLink>
          {compared && (
            <Button variant="secondary" onClick={() => setOnlyChanges(value => !value)}>
              {onlyChanges ? 'Show page previews' : 'Show only changes'}
            </Button>
          )}
          {selected && !selected.current && !props.archived && (
            <RestoreButton
              tone="primary"
              pageId={props.pageId}
              sourceVersionId={selected.id}
              revision={props.revision}
            />
          )}
        </div>
      </div>
      {props.archived && (
        <p role="status">This site is archived. Saved versions and comparisons are read-only; restoring is disabled.</p>
      )}
      {selected ? (
        <>
          <Disclosure className={ownedStyles.historyCompare} title="Compare with another version">
            <form action={'/pages/' + props.pageId + '/history'} method="get" className={workspaceFormsStyles.actions}>
              <input type="hidden" name="version" value={selected.id} />
              {props.automatic && <input type="hidden" name="automatic" value="1" />}
              {props.before && <input type="hidden" name="before" value={props.before} />}
              <Field density="compact" labelHidden id="compare-version" label="Compare this version with">
                <select id="compare-version" name="compare" defaultValue={compared?.id ?? ''} required>
                  <option value="" disabled>
                    Choose another saved version
                  </option>
                  {props.comparisonOptions.map(row => (
                    <option key={row.id} value={row.id}>
                      Version {row.revision} · {row.label} · {row.when}
                    </option>
                  ))}
                </select>
              </Field>
              <Button variant="secondary" type="submit" disabled={!props.comparisonOptions.length}>
                Compare versions
              </Button>
              {compared && <Link href={props.closeComparisonHref}>Close comparison</Link>}
            </form>
          </Disclosure>
          {(!onlyChanges || !compared) && props.usesResponsiveMenu && (
            <p className={recordTableStyles.meta}>
              History shows a static version with the compact menu. To check how the current menu fits on desktop, open
              Preview from the page editor.
            </p>
          )}
          {(!onlyChanges || !compared) && (
            <div data-compare={!!compared || undefined} className={ownedStyles.historyPreviews}>
              <div className={reviewWorkbenchStyles.panel}>
                <div className={workspacePreviewStyles.previewCaption + ' ' + recordTableStyles.summaryAction}>
                  <span
                    className={recordTableStyles.singleLine}
                    title={'Version ' + selected.revision + ' · ' + selected.label}
                  >
                    Version {selected.revision} · {selected.label}
                  </span>
                  <Link href={'/preview/' + selected.id + '?readonly=1'} target="_blank" rel="noopener">
                    Open preview
                  </Link>
                </div>
                <PageComparison
                  width={1280}
                  viewportHeight={720}
                  title={'Preview of version ' + selected.revision}
                  source={'/preview/' + selected.id + '?readonly=1'}
                />
              </div>
              {compared && (
                <div className={reviewWorkbenchStyles.panel}>
                  <div className={workspacePreviewStyles.previewCaption + ' ' + recordTableStyles.summaryAction}>
                    <span className={recordTableStyles.singleLine} title={compared.when}>
                      {compared.current ? 'Current draft' : 'Version ' + compared.revision} · {compared.when}
                    </span>
                    <Link href={'/preview/' + compared.id + '?readonly=1'} target="_blank" rel="noopener">
                      Open preview
                    </Link>
                  </div>
                  <PageComparison
                    width={1280}
                    viewportHeight={720}
                    title={'Comparison preview of version ' + compared.revision}
                    source={'/preview/' + compared.id + '?readonly=1'}
                  />
                </div>
              )}
            </div>
          )}
          {compared && (
            <Card title="What changed" density="compact">
              {props.presentation?.cells.length ? (
                <div className={recordTableStyles.tableWrap}>
                  <table
                    data-density="content"
                    data-layout="details"
                    className={recordTableStyles.table + ' ' + ownedStyles.historyChanges}
                  >
                    <caption className={selectionControlsStyles.visuallyHidden}>
                      Saved field values in the two selected versions
                    </caption>
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Version {selected.revision}</th>
                        <th>{compared.current ? 'Current draft' : 'Version ' + compared.revision}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {props.presentation.cells.map((cell, index) => (
                        <tr key={index}>
                          <th scope="row">{cell.label}</th>
                          <td>
                            <SavedValue value={cell.before} />
                          </td>
                          <td>
                            <SavedValue value={cell.after} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={ownedStyles.historyMessage}>
                  {props.changes.length
                    ? 'Other saved details changed. The page previews show the selected versions.'
                    : 'These versions have the same page details and section content.'}
                </p>
              )}
            </Card>
          )}
          {props.canInspect && compared && props.changes.length > 0 && (
            <StoredVersionFields
              selectedRevision={selected.revision}
              comparedRevision={compared.revision}
              changes={props.changes}
            />
          )}
          <p className={recordTableStyles.meta}>
            Restoring makes a new draft from the selected version. Nothing in history is deleted. Shared content keeps
            its own history.
          </p>
          {selected.current && (
            <p className={recordTableStyles.meta}>
              This is already the current draft. Choose an earlier version to compare or restore.
            </p>
          )}
        </>
      ) : (
        <EmptyState title="No saved versions yet">
          {props.archived
            ? 'This archived page has no saved versions to display.'
            : 'Make a change in the editor and save it; the version will appear here.'}
        </EmptyState>
      )}
    </Workbench>
  )
}

function SavedValue({ value }: { value: string }) {
  if (value.length <= 180) return value
  const preview = value.slice(0, 180).replace(/\s+\S*$/, '')
  return (
    <Disclosure title={preview + '…'}>
      <p>{value}</p>
    </Disclosure>
  )
}

function StoredVersionFields({
  selectedRevision,
  comparedRevision,
  changes,
}: {
  selectedRevision: string
  comparedRevision: string
  changes: VersionChange[]
}) {
  return (
    <Disclosure className={ownedStyles.historyCompare} title="All saved fields">
      <p>Sections are compared by position here. Moving one can also appear as field changes.</p>
      <div data-scroll="bounded" className={recordTableStyles.tableWrap}>
        <table
          data-density="content"
          data-layout="stored"
          className={recordTableStyles.table + ' ' + ownedStyles.historyChanges}
        >
          <thead>
            <tr>
              <th>Field</th>
              <th>Version {selectedRevision}</th>
              <th>Version {comparedRevision}</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change, index) => (
              <tr key={index}>
                <th scope="row" title={change.label}>
                  {change.label}
                </th>
                <td>
                  <pre tabIndex={0} aria-label={'Stored value in version ' + selectedRevision}>
                    {comparisonText(change.before)}
                  </pre>
                </td>
                <td>
                  <pre tabIndex={0} aria-label={'Stored value in version ' + comparedRevision}>
                    {comparisonText(change.after)}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Disclosure>
  )
}
