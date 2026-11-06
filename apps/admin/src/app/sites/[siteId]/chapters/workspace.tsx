'use client'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import { useRouter } from 'next/navigation'
import { ChapterSetup, chapterUsesLinkedPage, chapterDestinationLabel } from '@cms/schema'
import { chapterRowsAfterSave } from '../../../../lib/chapter-rows-after-save.ts'
import type { ChapterRow, ChapterDivision } from '../../../../lib/chapters.ts'
import { DetailPanel } from '../../../../components/ui/detail-panel.tsx'
import { ButtonLink } from '../../../../components/ui/button-link.tsx'
import { Button } from '../../../../components/ui/button.tsx'
import { Field } from '../../../../components/ui/field.tsx'
import { Card } from '../../../../components/ui/card.tsx'
import { Drawer, Dialog } from '../../../../components/ui/dialog.tsx'
import { SegmentedControl, ProgressSteps } from '../../../../components/ui/controls.tsx'
import { type StatusLabel } from '../../../../components/ui/status-pill.tsx'
import { TextLink as Link, Badge, SearchField, ListDetail, Note, EmptyState } from '../../../../components/ui/index.ts'
import type { ChapterEditor } from '../../../../lib/local-chapter-mail.ts'
import { saveChapterAction, inviteChapterEditorAction, loadChapterEditorsAction } from './actions.ts'
import workspace from '../../../../components/workspace.module.css'
const sectionLabels = {
  paragraph: 'Chapter paragraph',
  social: 'Social links',
  socialFirst: 'Show social links near the top',
  events: 'This year’s events',
  board: 'Board',
  photos: 'Photos',
  memberLogin: 'Member login link',
} as const
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
    <div className={workspace.denseStack + ' ' + workspace.compactForm}>
      {headerTarget && createPortal(add, headerTarget)}
      <div className={workspace.listToolbar}>
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
        <Card density="compact" data-responsive="records" className={workspace.tableWrap}>
          <table data-density="content" data-layout="directory" className={workspace.table} aria-label="Chapters">
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
                    <span className={workspace.meta}>Setup</span>
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
                      className={workspace.tableTitle + ' ' + workspace.singleLine}
                      onClick={() => (native ? setInspected(row.id) : setSelected(row))}
                    >
                      {row.config.name}
                    </Button>
                    {currentRows.filter(other => other.config.name === row.config.name).length > 1 && (
                      <span
                        className={workspace.meta + ' ' + workspace.singleLine}
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
                    <span className={workspace.singleLine} title={native ? publicDestination(row) : undefined}>
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
                      <div className={workspace.actions}>
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
    invite = localInvitations && row.config.updateMode === 'chapter-editors' && page
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
      <div className={workspace.formStack}>
        <ChapterStatus row={row} />
        <dl className={workspace.factList}>
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
              <span className={workspace.singleLine + ' ' + workspace.meta} title={row.config.contact.email}>
                {row.config.contact.email}
              </span>
            </dd>
          </div>
          <div>
            <dt>Changes approved by</dt>
            <dd>
              {division ? division.name + ' web team' : 'Site administrators'}
              {division && <span className={workspace.meta}>Site administrators can approve as backup.</span>}
            </dd>
          </div>
        </dl>
        {chapterUsesLinkedPage(row.config.destination) && (
          <p className={workspace.meta}>
            Saved address:{' '}
            <span className={workspace.singleLine} title={row.config.externalUrl ?? undefined}>
              {row.config.externalUrl}
            </span>
            Address not checked automatically.
          </p>
        )}
        {!chapterUsesLinkedPage(row.config.destination) && (
          <section className={workspace.formStack}>
            <h3 className={workspace.sectionHeading}>Sections on the page</h3>
            <div className={workspace.tagList}>
              {Object.entries(sectionLabels)
                .filter(([key]) => row.config.sections[key as keyof typeof row.config.sections])
                .map(([key, label]) => (
                  <Badge key={key}>{label}</Badge>
                ))}
            </div>
          </section>
        )}
        <section className={workspace.formStack}>
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
            <ul className={workspace.rowList}>
              {people.map(person => (
                <li key={person.id}>
                  <div className={workspace.rowCopy}>
                    <strong className={workspace.singleLine} title={person.name}>
                      {person.name}
                    </strong>
                    <span className={workspace.singleLine + ' ' + workspace.meta} title={person.email}>
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
          <p className={workspace.meta}>
            {division
              ? division.name + ' web staff and site administrators retain their existing access.'
              : 'Site administrators retain their existing access.'}
          </p>
          {invite && (
            <Button variant="secondary" onClick={onInvite}>
              Invite a volunteer
            </Button>
          )}
        </section>
        <p className={workspace.meta}>
          Saved setup can differ from what visitors see. Set up changes stay in draft until reviewed and published.
        </p>
      </div>
    </DetailPanel>
  )
}

function ChapterForm({
  row,
  siteId,
  onClose,
  onSaved,
  divisions,
  defaultMode,
  canAssignDivision,
}: {
  row: ChapterRow | null
  siteId: string
  divisions: ChapterDivision[]
  defaultMode: ChapterSetup['updateMode']
  canAssignDivision: boolean
  onClose: () => void
  onSaved: (row: ChapterRow, message: string) => void
}) {
  const router = useRouter(),
    [config, setConfig] = useState<ChapterSetup>(
      row?.config ?? {
        ...ChapterSetup.parse({
          name: '[Chapter name]',
          destination: 'page',
          pageId: null,
          externalUrl: null,
          contact: { name: '[Name]', role: '[Role]', email: 'chapter@example.test' },
          sections: {},
        }),
        name: '',
        updateMode: defaultMode,
      },
    ),
    [divisionId, setDivisionId] = useState(
      row ? (row.divisionId ?? '') : divisions.length === 1 ? divisions[0]!.id : '',
    ),
    [step, setStep] = useState(0),
    [pending, start] = useTransition(),
    [error, setError] = useState(''),
    errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (error && !pending) errorRef.current?.focus()
  }, [error, pending])
  const change = <K extends keyof ChapterSetup>(key: K, value: ChapterSetup[K]) => {
    setError('')
    setConfig(previous => ({ ...previous, [key]: value }))
  }
  const divisionPage = config.destination === 'division'
  const contacts = (
    <>
      <h3 className={workspace.sectionHeading}>{divisionPage ? 'Who to ask about it' : 'Point of contact'}</h3>
      <p className={workspace.meta}>
        {divisionPage
          ? 'There’s no chapter page to edit on this site. January and July reminders go to the contact below, asking them to check the address still works.'
          : 'One contact receives the January and July checks. These details are private.'}
      </p>
      {(['name', 'role', 'email'] as const).map(key => (
        <Field
          density="compact"
          key={key}
          id={'chapter-contact-' + key}
          label={key === 'name' ? 'Contact name' : key === 'role' ? 'Contact role' : 'Contact email'}
          required
        >
          <input
            type={key === 'email' ? 'email' : 'text'}
            value={config.contact[key]}
            maxLength={key === 'email' ? 254 : 120}
            onChange={event => change('contact', { ...config.contact, [key]: event.target.value })}
          />
        </Field>
      ))}
    </>
  )
  const initial = useRef(JSON.stringify({ config, divisionId })),
    signature = JSON.stringify({ config, divisionId }),
    dirty = signature !== initial.current
  const persist = async (): Promise<{ ok: boolean; message?: string }> => {
    setError('')
    if (!row && !canAssignDivision && !divisionId) {
      const message = 'Choose the division that will review this chapter.'
      setError(message)
      return { ok: false, message }
    }
    const parsed = ChapterSetup.safeParse({
      ...config,
      externalUrl: chapterUsesLinkedPage(config.destination) ? config.externalUrl : null,
    })
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path.join('.'),
        message =
          field === 'externalUrl'
            ? 'Use the full https address for the ' + (divisionPage ? 'division page.' : 'chapter website.')
            : field === 'name'
              ? 'Add a chapter name.'
              : field === 'contact.email'
                ? 'Enter a valid contact email address.'
                : 'Add the required contact name, role and email. Your entries are still here.'
      setError(message)
      return { ok: false, message }
    }
    const slug =
      row?.slug ??
      config.name
        .toLowerCase()
        .replace(/\bchapter\b/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    try {
      const outcome = await saveChapterAction({
        siteId,
        id: row?.id ?? null,
        revision: row?.revision ?? '0',
        slug,
        config: parsed.data,
        divisionId: divisionId || null,
      })
      if (!outcome.ok) {
        setError(outcome.message)
        return outcome
      }
      initial.current = signature
      router.refresh()
      onSaved(outcome.row, outcome.message)
      return { ok: true }
    } catch {
      const message =
        'The save could not be confirmed. Your entries are still here; retry after checking the connection.'
      setError(message)
      return { ok: false, message }
    }
  }
  const save = () =>
      start(async () => {
        await persist()
      }),
    readGuard = () => ({
      dirty,
      pending,
      draft: {
        label: config.name || 'New chapter',
        saved: false,
        saveDraft: () =>
          new Promise<{ ok: boolean; message?: string }>(resolve => start(async () => resolve(await persist()))),
        discard: () => {
          initial.current = signature
        },
      },
    })
  useNavigationGuard(readGuard)
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const close = () => {
    if (requestLocalDraftNavigation(readGuard, onClose)) onClose()
  }
  const divisionChoice = divisions.length > 0 && (
    <Field
      density="compact"
      id="chapter-division"
      label="Division web team"
      help="This team reviews chapter submissions."
    >
      <select
        value={divisionId}
        disabled={Boolean(row) && !canAssignDivision}
        onChange={event => setDivisionId(event.target.value)}
      >
        {canAssignDivision ? (
          <option value="">National team only</option>
        ) : (
          <option value="" disabled>
            Choose a division
          </option>
        )}
        {divisions.map(division => (
          <option key={division.id} value={division.id}>
            {division.name}
          </option>
        ))}
      </select>
    </Field>
  )
  const ChapterDialog = row ? Drawer : Dialog
  return (
    <ChapterDialog
      density="compact"
      size={row ? 'standard' : 'large'}
      title={row ? 'Set up ' + row.config.name : 'Add a chapter'}
      onClose={close}
      pending={pending}
      footer={
        <div className={workspace.actions}>
          <Button variant="secondary" disabled={pending} onClick={close}>
            Cancel
          </Button>
          {!divisionPage && step > 0 && (
            <Button variant="secondary" disabled={pending} onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {divisionPage ? (
            <Button loading={pending} onClick={save}>
              Save draft
            </Button>
          ) : step < 2 ? (
            <Button
              onClick={() => {
                if (
                  step === 0 &&
                  (!config.name.trim() ||
                    (config.destination === 'external' && !/^https:\/\//.test(config.externalUrl ?? '')))
                ) {
                  setError('Add a chapter name and, for an own website, its full https address.')
                  return
                }
                setError('')
                setStep(step + 1)
              }}
            >
              Continue
            </Button>
          ) : (
            <Button loading={pending} onClick={save}>
              Save chapter
            </Button>
          )}
        </div>
      }
    >
      <div className={workspace.formStack + ' ' + workspace.compactForm}>
        {!divisionPage && (
          <>
            <ProgressSteps steps={['Chapter', 'Sections', 'People']} current={step} label="Chapter setup steps" />
            <p className={workspace.meta}>
              Step {step + 1} of 3 · {['Chapter', 'Sections', 'People'][step]}
            </p>
          </>
        )}
        {error && (
          <p role="alert" ref={errorRef} tabIndex={-1}>
            {error}
          </p>
        )}
        {step === 0 && (
          <>
            <Field density="compact" id="chapter-name" label="Chapter name" required>
              <input value={config.name} maxLength={160} onChange={event => change('name', event.target.value)} />
            </Field>
            <div role="radiogroup" aria-labelledby="chapter-destination-label" className={workspace.denseStack}>
              <strong id="chapter-destination-label">Where does this chapter send visitors?</strong>
              <div className={workspace.choiceRows}>
                {(['page', 'division', 'external', 'unlisted'] as const).map(destination => (
                  <label key={destination}>
                    <input
                      type="radio"
                      name="chapter-destination"
                      aria-label={chapterDestinationLabel(destination)}
                      checked={config.destination === destination}
                      onChange={() => {
                        change('destination', destination)
                        setStep(0)
                      }}
                    />
                    <span>
                      <strong>{chapterDestinationLabel(destination)}</strong>
                      <br />
                      <span className={workspace.meta}>
                        {destination === 'page'
                          ? 'A page on this site, from the chapter template.'
                          : destination === 'division'
                            ? 'A page on a Salvation Army division site. Their division keeps it up to date.'
                            : destination === 'external'
                              ? 'Outside The Salvation Army’s sites.'
                              : 'Not listed until it is ready.'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {chapterUsesLinkedPage(config.destination) && (
              <Field
                density="compact"
                id="chapter-website"
                label={divisionPage ? 'Page address' : 'Chapter website'}
                help="Use the full https address."
                required
              >
                <input
                  type="url"
                  value={config.externalUrl ?? ''}
                  onChange={event => change('externalUrl', event.target.value)}
                />
              </Field>
            )}
            {divisionPage && (
              <>
                <p className={workspace.meta}>
                  Address not checked automatically. Check the saved page address before publishing.
                </p>
                {divisionChoice}
                {contacts}
              </>
            )}
            <p className={workspace.meta}>
              New chapter pages stay in draft until reviewed and published. Chapters with their own website need no CMS
              page.
            </p>
            {config.pageId && !chapterUsesLinkedPage(config.destination) && (
              <Link href={'/pages/' + config.pageId}>Open chapter page</Link>
            )}
          </>
        )}
        {!divisionPage && step === 1 && (
          <>
            {config.destination === 'external' ? (
              <p>The chapter maintains its own website. Page sections apply if a CMS page is added later.</p>
            ) : (
              <>
                <h3 className={workspace.sectionHeading}>Sections on this page</h3>
                <div className={workspace.formStack}>
                  {Object.entries(sectionLabels).map(([key, label]) => (
                    <label className={workspace.checkRow} key={key}>
                      <input
                        type="checkbox"
                        checked={config.sections[key as keyof typeof config.sections]}
                        onChange={event => change('sections', { ...config.sections, [key]: event.target.checked })}
                        disabled={key === 'socialFirst' && !config.sections.social}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <Field density="compact" id="chapter-board-display" label="Board layout">
                  <select
                    value={config.boardDisplay}
                    onChange={event => change('boardDisplay', event.target.value as ChapterSetup['boardDisplay'])}
                  >
                    <option value="all">Everyone</option>
                    <option value="first-eight">First 8, then Show all</option>
                  </select>
                </Field>
                <Note>What is Echelon and Join us are shared sections. Site editors keep them consistent.</Note>
              </>
            )}
          </>
        )}
        {!divisionPage && step === 2 && (
          <>
            {divisionChoice}
            <Field density="compact" id="chapter-update-mode" label="How the page gets updated">
              <select
                value={config.updateMode}
                onChange={event => change('updateMode', event.target.value as ChapterSetup['updateMode'])}
              >
                <option value="division">Division web team makes changes</option>
                <option value="chapter-editors">Chapter editors sign in; the division approves</option>
              </select>
            </Field>
            {contacts}
          </>
        )}
      </div>
    </ChapterDialog>
  )
}

function ChapterInvite({
  row,
  siteId,
  onClose,
  onSaved,
}: {
  row: ChapterRow
  siteId: string
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [people, setPeople] = useState<ChapterEditor[]>([]),
    [error, setError] = useState(''),
    [pending, start] = useTransition()
  useEffect(() => {
    let active = true
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
  }, [row.id])
  const invite = () => {
    setError('')
    if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      setError('Add the volunteer’s name and email address.')
      return
    }
    start(async () => {
      try {
        const result = await inviteChapterEditorAction({ chapterId: row.id, revision: row.revision, email, name })
        if (!result.ok) {
          setError(result.message)
          return
        }
        onSaved(result.message)
        onClose()
      } catch {
        setError('The invitation could not be confirmed. Retry after checking the connection.')
      }
    })
  }
  return (
    <Drawer
      density="compact"
      title={'Invite an editor for ' + row.config.name}
      onClose={onClose}
      pending={pending}
      footer={
        <Button loading={pending} onClick={invite}>
          Invite chapter editor
        </Button>
      }
    >
      <div className={workspace.formStack}>
        <p>
          They can edit only {row.config.name}, then send their changes to the division for approval. Shared sections
          stay with the site team.
        </p>
        <p className={workspace.meta}>This local demo records the sign-in link. No email is sent. </p>
        {error && <p role="alert">{error}</p>}
        <Field density="compact" id="volunteer-name" label="Volunteer name" required>
          <input value={name} maxLength={120} autoComplete="name" onChange={event => setName(event.target.value)} />
        </Field>
        <Field density="compact" id="volunteer-email" label="Volunteer email" required>
          <input
            type="email"
            value={email}
            maxLength={254}
            autoComplete="email"
            onChange={event => setEmail(event.target.value)}
          />
        </Field>
        <h3 className={workspace.sectionHeading}>Chapter editors</h3>
        {people.length ? (
          <ul>
            {people.map(person => (
              <li key={person.id}>
                {person.name} · {person.email}
                {!person.enabled ? ' · Access paused' : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p>No chapter editors yet.</p>
        )}
      </div>
    </Drawer>
  )
}
