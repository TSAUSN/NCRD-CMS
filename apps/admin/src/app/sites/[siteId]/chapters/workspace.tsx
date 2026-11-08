'use client'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { type ChapterSetup, chapterUsesLinkedPage, chapterDestinationLabel } from '@cms/schema'
import { chapterRowsAfterSave } from '../../../../lib/chapter-rows-after-save.ts'
import type { ChapterRow, ChapterDivision } from '../../../../lib/chapters.ts'
import { DetailPanel } from '../../../../components/ui/detail-panel.tsx'
import { ButtonLink } from '../../../../components/ui/button-link.tsx'
import { Button } from '../../../../components/ui/button.tsx'
import { Card } from '../../../../components/ui/card.tsx'
import { SegmentedControl } from '../../../../components/ui/controls.tsx'
import { type StatusLabel } from '../../../../components/ui/status-pill.tsx'
import { TextLink as Link, Badge, SearchField, ListDetail, EmptyState } from '../../../../components/ui/index.ts'
import type { ChapterEditor } from '../../../../lib/local-chapter-mail.ts'
import { loadChapterEditorsAction } from './actions.ts'
import workspace from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../../components/workspace-styles/site-summary.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import { ChapterForm } from './chapter-form.tsx'
import { ChapterInvite } from './chapter-invite.tsx'
import { chapterSectionLabels } from './chapter-section-labels.ts'

function status(row: ChapterRow): StatusLabel {
  return !row.pagePublished
    ? 'Draft'
    : row.pageChanged || JSON.stringify(row.config) !== JSON.stringify(row.publishedConfig)
      ? 'Live · changes not published'
      : 'Live'
}
function ChapterStatus({ row }: { row: ChapterRow }) {
  const linked = chapterUsesLinkedPage(row.config.destination),
    label = linked ? (row.config.destination === 'division' ? 'Division’s page' : 'Own website') : status(row)
  return (
    <Badge tone={linked ? 'info' : label === 'Live' ? 'live' : label === 'Draft' ? 'neutral' : 'pending'} title={label}>
      {label === 'Live · changes not published' ? 'Changes not live' : label}
    </Badge>
  )
}

export function ChaptersWorkspace({
  siteId,
  rows,
  localInvitations = false,
  canAdd = true,
  divisions = [],
  defaultMode = 'division',
  canAssignDivision = true,
  native = false,
  headerActionsId,
}: {
  native?: boolean
  headerActionsId?: string
  siteId: string
  rows: ChapterRow[]
  localInvitations?: boolean
  canAdd?: boolean
  divisions?: ChapterDivision[]
  defaultMode?: ChapterSetup['updateMode']
  canAssignDivision?: boolean
}) {
  const [inviting, setInviting] = useState<ChapterRow | null>(null),
    [selected, setSelected] = useState<ChapterRow | null | undefined>(),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [message, setMessage] = useState(''),
    [accessRevision, setAccessRevision] = useState(0)
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null),
    [inspected, setInspected] = useState<string | null | undefined>()
  useEffect(() => setHeaderTarget(headerActionsId ? document.getElementById(headerActionsId) : null), [headerActionsId])
  const [savedRows, setSavedRows] = useState<ChapterRow[]>([]),
    currentRows = chapterRowsAfterSave(rows, savedRows)
  // A fresh RLS result replaces temporary acknowledgements, including revoked access.
  useEffect(() => setSavedRows([]), [rows])
  const shown = currentRows.filter(
    row =>
      row.config.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'all' ||
        row.config.destination === filter ||
        (filter === 'draft' &&
          (!row.publishedConfig || (!chapterUsesLinkedPage(row.config.destination) && !row.pagePublished)))),
  )
  const details = native && inspected !== null ? (shown.find(row => row.id === inspected) ?? shown[0] ?? null) : null,
    add = canAdd && <Button onClick={() => setSelected(null)}>+ Add a chapter</Button>
  return (
    <div className={workspace.denseStack + ' ' + workspaceFormsStyles.compactForm}>
      {headerTarget && createPortal(add, headerTarget)}
      <div className={workspaceFormsStyles.listToolbar}>
        <SearchField
          id="chapter-search"
          label="Find a chapter"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="City or chapter name"
        />
        {!headerActionsId && add}
        <SegmentedControl
          appearance="pills"
          label="Chapter filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All ' + currentRows.length },
            { value: 'page', label: 'Chapter pages' },
            { value: 'division', label: 'Division’s page' },
            { value: 'external', label: 'Own website' },
            { value: 'unlisted', label: 'Not listed' },
            { value: 'draft', label: 'Drafts' },
          ]}
        />
      </div>
      {message && <p role="status">{message}</p>}
      <ListDetail
        panelFrame
        label="Chapter details"
        storageKey="cms.chapters.detail-width"
        panel={
          details ? (
            <div
              inert={selected !== undefined || Boolean(inviting) ? true : undefined}
              aria-hidden={selected !== undefined || Boolean(inviting) || undefined}
            >
              <ChapterDetails
                key={details.id + '-' + accessRevision}
                row={details}
                divisions={divisions}
                localInvitations={localInvitations}
                onClose={() => setInspected(null)}
                onSetup={() => setSelected(details)}
                onInvite={() => setInviting(details)}
              />
            </div>
          ) : undefined
        }
      >
        <Card density="compact" data-responsive="records" className={recordTableStyles.tableWrap}>
          <table
            data-density="content"
            data-layout="directory"
            className={recordTableStyles.table}
            aria-label="Chapters"
          >
            <thead>
              <tr>
                <th>Chapter</th>
                <th data-col="status">Page</th>
                <th data-col="owner" data-priority="secondary">
                  Updated by
                </th>
                <th data-priority="extra">{native ? 'Today it links to' : 'Find a chapter links to'}</th>
                {!native && (
                  <th>
                    <span className={recordTableStyles.meta}>Setup</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map(row => (
                <tr
                  key={row.id}
                  data-chapter-id={row.id}
                  data-revision={row.revision}
                  data-selected={details?.id === row.id || undefined}
                >
                  <td>
                    <Button
                      variant="tertiary"
                      title={row.config.name}
                      className={recordTableStyles.tableTitle + ' ' + recordTableStyles.singleLine}
                      onClick={() => (native ? setInspected(row.id) : setSelected(row))}
                    >
                      {row.config.name}
                    </Button>
                    {currentRows.filter(other => other.config.name === row.config.name).length > 1 && (
                      <span
                        className={recordTableStyles.meta + ' ' + recordTableStyles.singleLine}
                        title={row.config.externalUrl ?? '/chapters/' + row.slug}
                      >
                        {row.config.externalUrl ?? '/chapters/' + row.slug}
                      </span>
                    )}
                  </td>
                  <td>
                    <ChapterStatus row={row} />
                  </td>
                  <td data-priority="secondary">
                    {row.config.updateMode === 'division' ? 'Division web team' : 'Chapter editors'}
                  </td>
                  <td data-priority="extra">
                    <span className={recordTableStyles.singleLine} title={native ? publicDestination(row) : undefined}>
                      {native
                        ? publicDestination(row)
                        : row.config.destination === 'division'
                          ? 'Their division’s page ↗'
                          : row.config.destination === 'external'
                            ? 'Their own website ↗'
                            : row.config.destination === 'unlisted'
                              ? 'Not listed yet'
                              : row.pagePublished
                                ? 'This chapter page'
                                : 'This chapter page, after publishing'}
                    </span>
                  </td>
                  {!native && (
                    <td>
                      <div className={workspaceFormsStyles.actions}>
                        <Button variant="secondary" onClick={() => setSelected(row)}>
                          Set up
                        </Button>
                        {localInvitations &&
                          row.config.updateMode === 'chapter-editors' &&
                          row.config.pageId &&
                          !chapterUsesLinkedPage(row.config.destination) && (
                            <Button variant="secondary" onClick={() => setInviting(row)}>
                              Invite a volunteer
                            </Button>
                          )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <EmptyState title="No chapters match.">Try another name or add a chapter.</EmptyState>}
        </Card>
      </ListDetail>
      {inviting && (
        <ChapterInvite
          row={inviting}
          siteId={siteId}
          onClose={() => setInviting(null)}
          onSaved={text => {
            setMessage(text)
            setAccessRevision(value => value + 1)
          }}
        />
      )}
      {selected !== undefined && (
        <ChapterForm
          key={selected?.id ?? 'new'}
          row={selected}
          siteId={siteId}
          divisions={divisions}
          defaultMode={defaultMode}
          canAssignDivision={canAssignDivision}
          onClose={() => setSelected(undefined)}
          onSaved={(row, text) => {
            setSavedRows(previous => [...previous.filter(saved => saved.id !== row.id), row])
            setMessage(text)
            setSelected(undefined)
          }}
        />
      )}
    </div>
  )
}
function publicDestination(row: ChapterRow) {
  const live = row.publishedConfig
  if (!live) return 'Not published yet'
  return live.destination === 'unlisted'
    ? 'Not listed'
    : live.destination === 'division'
      ? 'Their division’s page ↗'
      : live.destination === 'external'
        ? 'Their own website ↗'
        : row.pagePublished
          ? 'This chapter page'
          : 'No published chapter page'
}
function ChapterDetails({
  row,
  divisions,
  localInvitations,
  onClose,
  onSetup,
  onInvite,
}: {
  row: ChapterRow
  divisions: ChapterDivision[]
  localInvitations: boolean
  onClose: () => void
  onSetup: () => void
  onInvite: () => void
}) {
  const [people, setPeople] = useState<ChapterEditor[] | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setPeople(null)
    setError('')
    void loadChapterEditorsAction(row.id)
      .then(result => {
        if (!active) return
        if (result.ok) setPeople(result.people)
        else setError(result.message)
      })
      .catch(() => {
        if (active) setError('The chapter editors could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [row.id, attempt])
  const division = divisions.find(item => item.id === row.divisionId),
    page = row.config.pageId && !chapterUsesLinkedPage(row.config.destination),
    canInviteHere = row.config.updateMode === 'chapter-editors' && page
  return (
    <DetailPanel
      title={row.config.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onSetup}>
            Set up
          </Button>
          {page && (
            <ButtonLink variant="secondary" href={'/pages/' + row.config.pageId}>
              Open chapter page
            </ButtonLink>
          )}
          {chapterUsesLinkedPage(row.config.destination) && row.config.externalUrl && (
            <ButtonLink variant="secondary" href={row.config.externalUrl} target="_blank" rel="noopener noreferrer">
              Open saved address
            </ButtonLink>
          )}
        </>
      }
    >
      <div className={listInspectorStyles.formStack}>
        <ChapterStatus row={row} />
        <dl className={listInspectorStyles.factList}>
          <div>
            <dt>Today it links to</dt>
            <dd>{publicDestination(row)}</dd>
          </div>
          <div>
            <dt>Saved destination</dt>
            <dd>{chapterDestinationLabel(row.config.destination)}</dd>
          </div>
          <div>
            <dt>Page updated by</dt>
            <dd>
              {row.config.updateMode === 'division' ? 'Division web team makes changes' : 'Chapter editors sign in'}
            </dd>
          </div>
          <div>
            <dt>Point of contact</dt>
            <dd>
              {row.config.contact.name} · {row.config.contact.role}
              <span
                className={recordTableStyles.singleLine + ' ' + recordTableStyles.meta}
                title={row.config.contact.email}
              >
                {row.config.contact.email}
              </span>
            </dd>
          </div>
          <div>
            <dt>Changes approved by</dt>
            <dd>
              {division ? division.name + ' web team' : 'Site administrators'}
              {division && <span className={recordTableStyles.meta}>Site administrators can approve as backup.</span>}
            </dd>
          </div>
        </dl>
        {chapterUsesLinkedPage(row.config.destination) && (
          <p className={recordTableStyles.meta}>
            Saved address:{' '}
            <span className={recordTableStyles.singleLine} title={row.config.externalUrl ?? undefined}>
              {row.config.externalUrl}
            </span>
            Address not checked automatically.
          </p>
        )}
        {!chapterUsesLinkedPage(row.config.destination) && (
          <section className={listInspectorStyles.formStack}>
            <h3 className={workspace.sectionHeading}>Sections on the page</h3>
            <div className={listInspectorStyles.tagList}>
              {Object.entries(chapterSectionLabels)
                .filter(([key]) => row.config.sections[key as keyof typeof row.config.sections])
                .map(([key, label]) => (
                  <Badge key={key}>{label}</Badge>
                ))}
            </div>
          </section>
        )}
        <section className={listInspectorStyles.formStack}>
          <h3 className={workspace.sectionHeading}>Who can change this page</h3>
          {error ? (
            <>
              <p role="alert">{error}</p>
              <Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>
                Try again
              </Button>
            </>
          ) : people === null ? (
            <p role="status">Loading chapter editors…</p>
          ) : people.length ? (
            <ul className={siteSummaryStyles.rowList}>
              {people.map(person => (
                <li key={person.id}>
                  <div className={recordTableStyles.rowCopy}>
                    <strong className={recordTableStyles.singleLine} title={person.name}>
                      {person.name}
                    </strong>
                    <span className={recordTableStyles.singleLine + ' ' + recordTableStyles.meta} title={person.email}>
                      {person.email}
                    </span>
                  </div>
                  <Badge>{person.enabled ? 'Assigned chapter editor' : 'Access paused'}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p>No chapter editors are assigned.</p>
          )}
          <p className={recordTableStyles.meta}>
            {division
              ? division.name + ' web staff and site administrators retain their existing access.'
              : 'Site administrators retain their existing access.'}
          </p>
          {canInviteHere &&
            (localInvitations ? (
              <Button variant="secondary" onClick={onInvite}>
                Invite a volunteer
              </Button>
            ) : (
              <p className={recordTableStyles.meta}>
                Chapter invitations aren’t available on this installation. Ask a site administrator to arrange access
                before assigning volunteers to update this page.
              </p>
            ))}
        </section>
        <p className={recordTableStyles.meta}>
          Saved setup can differ from what visitors see. Set up changes stay in draft until reviewed and published.
        </p>
      </div>
    </DetailPanel>
  )
}
