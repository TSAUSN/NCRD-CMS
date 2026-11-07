'use client'

import { createPortal } from 'react-dom'
import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from 'react'
import {
  Button,
  Card,
  CardContent,
  Field,
  EmptyState,
  DetailPanel,
  SearchField,
  Disclosure,
  TextLink,
  Badge,
  ListDetail,
  ActionNote,
} from '../../components/ui/index.ts'
import { requestLocalDraftNavigation } from '../../components/navigation-guard.ts'
import { useBrowserSetup } from '../../components/use-browser-setup.ts'
import type { NavigationGuardState } from '../../lib/navigation-guard.ts'
import { personAccessSummary, personRoles } from '../../lib/people-access.ts'
import workspace from '../../components/workspace.module.css'
import workspaceFormsStyles from '../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../components/workspace-styles/record-table.module.css'
import listInspectorStyles from '../../components/workspace-styles/list-inspector.module.css'
import ownedStyles from './people-workspace-styles.module.css'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '../../components/confirm.tsx'
import type { PersonRow, SiteAssignment } from '../../lib/people.ts'
import { addPerson, invitePerson, resendInvitation, updatePerson, type PeopleResult } from './actions.ts'

type Site = { id: string; name: string; archived: boolean }
type Selection = PersonRow | 'invite' | null

export function PeopleWorkspace({
  people,
  sites,
  currentUserId,
  localMail,
  invitationsEnabled = true,
  headerActionsId,
}: {
  headerActionsId?: string
  people: PersonRow[]
  sites: Site[]
  currentUserId: string
  localMail: boolean
  invitationsEnabled?: boolean
}) {
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null)
  useEffect(() => setHeaderTarget(headerActionsId ? document.getElementById(headerActionsId) : null), [headerActionsId])
  const router = useRouter(),
    [refreshing, startRefresh] = useTransition()
  const [search, setSearch] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [selection, setSelection] = useState<Selection>(null)
  const editorLeave = useRef<() => NavigationGuardState>(() => ({ dirty: false, pending: false }))
  const [notice, setNotice] = useState<string | null>(null)
  const [actionBusy, setBusy] = useState(false),
    busyRef = useRef(false)
  const busy = actionBusy || refreshing
  function changeBusy(value: boolean) {
    busyRef.current = value
    setBusy(value)
  }
  const filtered = people.filter(
    person =>
      `${person.email} ${person.display_name} ${person.pageAssignments.map(item => item.title).join(' ')} ${person.divisionAssignments.map(item => item.name).join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!siteFilter ||
        person.super_admin ||
        person.memberships.some(item => item.siteId === siteFilter) ||
        person.pageAssignments.some(item => item.siteId === siteFilter) ||
        person.divisionAssignments.some(item => item.siteId === siteFilter)),
  )
  function select(next: Selection) {
    if (busyRef.current || refreshing) return
    const proceed = () => {
      setSelection(next)
      setNotice(null)
    }
    if (requestLocalDraftNavigation(() => editorLeave.current(), proceed)) proceed()
  }
  const invite = (
    <Button
      disabled={busy}
      aria-label={invitationsEnabled ? 'Invite a person' : 'Add a person'}
      aria-describedby={!invitationsEnabled ? 'invitation-email-status' : undefined}
      onClick={() => select('invite')}
    >
      {invitationsEnabled ? 'Invite someone' : 'Add person'}
    </Button>
  )
  return (
    <div className={workspace.denseStack + ' ' + workspaceFormsStyles.compactForm}>
      {headerTarget && createPortal(invite, headerTarget)}
      {notice && (
        <p className="notice notice-ok" role="status">
          {notice}
        </p>
      )}
      {!invitationsEnabled && (
        <p className="notice" id="invitation-email-status">
          Invitation emails are off. Add a person to grant site access without sending an invitation. They still need
          the normal sign-in email; ask the operator to confirm sign-in delivery before adding real editors.
        </p>
      )}
      <div className={workspaceFormsStyles.listToolbar}>
        <SearchField
          id="people-search"
          label="Find a person"
          value={search}
          disabled={busy}
          onChange={event => setSearch(event.target.value)}
          placeholder="Name, email, chapter or division"
        />
        <div className={workspaceFormsStyles.actions}>
          <Field density="compact" labelHidden id="people-site" label="Showing people for">
            <select value={siteFilter} disabled={busy} onChange={event => setSiteFilter(event.target.value)}>
              <option value="">All sites</option>
              {sites
                .filter(site => !site.archived)
                .map(site => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
            </select>
          </Field>
          {!headerActionsId && invite}
          <span className={recordTableStyles.meta} role="status">
            {filtered.length
              ? `${filtered.length} ${filtered.length === 1 ? 'person' : 'people'}`
              : 'No people match your search.'}
          </span>
        </div>
      </div>
      <ListDetail
        label="Account panel"
        storageKey="cms.people-panel"
        panelFrame
        panel={
          selection && (
            <PersonEditor
              key={selection === 'invite' ? 'invite' : `${selection.id}:${selection.revision}`}
              person={selection === 'invite' ? null : selection}
              sites={sites}
              currentUserId={currentUserId}
              invitationsEnabled={invitationsEnabled}
              onBusy={changeBusy}
              leaveRef={editorLeave}
              onCancel={() => select(null)}
              onSaved={message => {
                setSelection(null)
                setNotice(message)
                startRefresh(() => router.refresh())
              }}
            />
          )
        }
      >
        <div className={workspace.denseStack}>
          <section aria-label="People" data-responsive="records" className={recordTableStyles.tableWrap}>
            {filtered.length === 0 ? (
              <EmptyState title="No people match">Try another name or choose All sites.</EmptyState>
            ) : (
              <table
                aria-label="People and access"
                className={recordTableStyles.table}
                data-density="content"
                data-layout="directory"
                data-status-width="wide"
              >
                <thead>
                  <tr>
                    <th>Person</th>
                    <th data-priority="secondary">Role</th>
                    <th data-priority="extra">Can edit</th>
                    <th data-col="status">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(person => (
                    <tr
                      key={person.id}
                      data-selected={selection !== null && selection !== 'invite' && selection.id === person.id}
                    >
                      <td>
                        <div className={recordTableStyles.rowCopy}>
                          <Button
                            className={recordTableStyles.tableTitle}
                            variant="tertiary"
                            size="s"
                            disabled={busy}
                            aria-label={'Edit access for ' + person.email}
                            title={person.display_name || person.email}
                            onClick={() => select(person)}
                          >
                            <span className={listInspectorStyles.itemLabel}>{person.display_name || person.email}</span>
                          </Button>
                          <span
                            className={recordTableStyles.singleLine + ' ' + recordTableStyles.meta}
                            title={person.email}
                          >
                            {person.email}
                          </span>
                        </div>
                      </td>
                      <td data-priority="secondary">
                        <Badge truncate title={personRoles(person)}>
                          {personRoles(person)}
                        </Badge>
                      </td>
                      <td data-priority="extra">
                        <span className={recordTableStyles.singleLine} title={personAccessSummary(person)}>
                          {personAccessSummary(person)}
                        </span>
                        {person.pageAssignments.some(item => !item.enabled) && (
                          <span
                            className={recordTableStyles.singleLine + ' ' + recordTableStyles.meta}
                            title="Chapter access paused"
                          >
                            Chapter access paused
                          </span>
                        )}
                      </td>
                      <td data-col="status">
                        <div className={recordTableStyles.rowCopy}>
                          <Badge tone={person.status === 'disabled' ? 'neutral' : person.accepted ? 'live' : 'pending'}>
                            {person.status === 'disabled'
                              ? 'Deactivated'
                              : person.accepted
                                ? 'Active'
                                : 'Not signed in yet'}
                          </Badge>
                          {person.invitation_status && (
                            <span
                              className={recordTableStyles.singleLine + ' ' + recordTableStyles.meta}
                              role="status"
                              title={invitationMessage(person, localMail)}
                            >
                              {invitationMessage(person, localMail)}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <Card title="Access at a glance" density="compact">
            <CardContent>
              <div className={workspace.equalColumns}>
                {[
                  ['Super admin', 'Every site, including code and the shared section library.'],
                  ['Admin', 'Pages and shared building blocks on their assigned sites.'],
                  ['Site editor', 'Edits and publishes the pages their access allows.'],
                  ['Content creator', 'Prepares drafts and submits changes for approval.'],
                ].map(([name, description]) => (
                  <div key={name} className={recordTableStyles.rowCopy}>
                    <strong>{name}</strong>
                    <p className={recordTableStyles.meta}>{description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Disclosure title="Chapter access and account help">
            <p>
              For a chapter volunteer, open the chapter’s setup and choose <strong>Invite a volunteer</strong>. This
              gives access to that chapter page. Division editors keep their assigned approval work.
            </p>
            <p>Review reminders are managed in the chapter site's Settings for January and July.</p>
            <p>Deactivating an account stops access across all its sites. It keeps the person's work and history.</p>
          </Disclosure>
        </div>
      </ListDetail>
    </div>
  )
}

function PersonEditor({
  person,
  sites,
  currentUserId,
  invitationsEnabled,
  leaveRef,
  onCancel,
  onSaved,
  onBusy,
}: {
  person: PersonRow | null
  sites: Site[]
  currentUserId: string
  invitationsEnabled: boolean
  leaveRef: { current: () => NavigationGuardState }
  onCancel: () => void
  onSaved: (message: string) => void
  onBusy: (busy: boolean) => void
}) {
  const router = useRouter(),
    formId = useId()
  const [result, setResult] = useState<PeopleResult | null>(null)
  const [pending, startTransition] = useTransition()
  const inFlight = useRef(false)
  const [confirm, setConfirm] = useState(false)
  const initial = {
    name: person?.display_name ?? '',
    email: person?.email ?? '',
    status: person?.status ?? 'active',
    memberships: person?.memberships ?? [],
    revision: person?.revision ?? '0',
  }
  const setup = useBrowserSetup({
    storageKey: 'cms.people-access.' + currentUserId + '.' + (person?.id ?? 'invite'),
    initial,
    label: person ? 'Account access choices' : invitationsEnabled ? 'Invitation choices' : 'New person choices',
    pending: () => pending || inFlight.current,
    read: value => {
      const data = value as typeof initial
      if (
        !data ||
        typeof data.name !== 'string' ||
        data.name.length > 200 ||
        typeof data.email !== 'string' ||
        data.email.length > 254 ||
        !['active', 'disabled'].includes(data.status) ||
        typeof data.revision !== 'string' ||
        !/^\d{1,30}$/.test(data.revision) ||
        !Array.isArray(data.memberships) ||
        data.memberships.length > 1000
      )
        return null
      const memberships: SiteAssignment[] = []
      for (const item of data.memberships) {
        if (
          !item ||
          typeof item.siteId !== 'string' ||
          item.siteId.length !== 36 ||
          !['contributor', 'editor', 'site_admin'].includes(item.role) ||
          memberships.some(existing => existing.siteId === item.siteId)
        )
          return null
        memberships.push({ siteId: item.siteId, role: item.role })
      }
      return { name: data.name, email: data.email, status: data.status, memberships, revision: data.revision }
    },
  })
  const { name, email, status, memberships, revision } = setup.value,
    busy = pending || setup.loading
  const availableSites = sites.filter(
      site => !site.archived || person?.memberships.some(item => item.siteId === site.id),
    ),
    unavailable = memberships.some(item => !availableSites.some(site => site.id === item.siteId))
  useLayoutEffect(() => {
    leaveRef.current = setup.leaveState
    return () => {
      leaveRef.current = () => ({ dirty: false, pending: false })
    }
  }, [leaveRef, setup.leaveState])
  function change(value: Partial<typeof initial>) {
    setResult(null)
    setup.setValue(previous => ({ ...previous, ...value }))
  }

  function run(action: () => Promise<PeopleResult>, close = true) {
    if (inFlight.current || setup.loading) return
    inFlight.current = true
    onBusy(true)
    setResult(null)
    startTransition(async () => {
      try {
        const outcome = await action()
        setResult(outcome)
        if (outcome.ok) {
          setConfirm(false)
          if (close) {
            setup.finish()
            onSaved(outcome.message)
          } else router.refresh()
        }
      } catch {
        setResult({
          ok: false,
          message: 'The change could not be confirmed. Reload to check its status before trying again.',
        })
      } finally {
        inFlight.current = false
        onBusy(false)
      }
    })
  }
  function save() {
    run(() =>
      person
        ? updatePerson({ id: person.id, revision, name, status, memberships })
        : invitationsEnabled
          ? invitePerson({ email, name, memberships })
          : addPerson({ email, name, memberships }),
    )
  }
  const title = person ? 'Edit account access' : invitationsEnabled ? 'Invite a person' : 'Add a person'
  return (
    <section aria-label={title} className={ownedStyles.panelRegion}>
      <DetailPanel
        title={title}
        pending={busy}
        onClose={() => {
          if (!inFlight.current) onCancel()
        }}
        footer={
          <>
            <ActionNote>
              Save draft and leave keeps these choices only in this browser. It does not change access, create an
              account or send an invitation.
            </ActionNote>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (!inFlight.current) onCancel()
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={busy || unavailable || !name.trim() || (!person && memberships.length === 0)}
            >
              {pending
                ? 'Saving…'
                : person
                  ? 'Save account access'
                  : invitationsEnabled
                    ? 'Create account & send invitation'
                    : 'Add person'}
            </Button>
          </>
        }
      >
        <div className={workspace.denseStack + ' ' + workspaceFormsStyles.compactForm}>
          {!person && !invitationsEnabled && (
            <p>
              No invitation will be sent. Share the CMS sign-in address with this person through your usual channel;
              they must verify their own email before using this access.
            </p>
          )}
          {person && (
            <dl className={listInspectorStyles.factList}>
              <div>
                <dt>Role</dt>
                <dd>
                  <Badge truncate title={personRoles(person)}>
                    {personRoles(person)}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt>Can edit</dt>
                <dd title={personAccessSummary(person)}>{personAccessSummary(person)}</dd>
              </div>
            </dl>
          )}
          {person?.invitation_error && (
            <Disclosure title="Delivery details">
              <p>{person.invitation_error}</p>
            </Disclosure>
          )}
          {setup.saved && (
            <>
              <p>Access choices restored or saved in this browser. Review them before applying.</p>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  if (setup.clear()) {
                    setResult(null)
                    setConfirm(false)
                  }
                }}
              >
                Clear saved access choices
              </Button>
            </>
          )}
          {setup.error && <p role="alert">{setup.error}</p>}
          {unavailable && (
            <p role="alert">
              A saved site is unavailable. Clear the saved choices and reopen this form before saving account access.
            </p>
          )}
          {result && !confirm && <ResultNotice result={result} />}
          <form
            id={formId}
            onSubmit={event => {
              event.preventDefault()
              if (busy || inFlight.current || unavailable) return
              if (person && status === 'disabled' && person.status !== 'disabled') setConfirm(true)
              else save()
            }}
          >
            <fieldset disabled={busy} className={workspaceFormsStyles.formChoices + ' ' + workspace.denseStack}>
              <Field density="compact" id="person-name" label="Name">
                <input
                  id="person-name"
                  required
                  maxLength={200}
                  value={name}
                  onChange={event => {
                    change({ name: event.target.value })
                  }}
                />
              </Field>
              <Field density="compact" id="person-email" label="Email address">
                <input
                  id="person-email"
                  type="email"
                  required
                  maxLength={254}
                  readOnly={person !== null}
                  value={email}
                  onChange={event => {
                    change({ email: event.target.value })
                  }}
                />
              </Field>
              {person && (
                <Field density="compact" id="person-status" label="Account status">
                  <select
                    id="person-status"
                    value={status}
                    disabled={person.id === currentUserId}
                    onChange={event => {
                      change({ status: event.target.value as 'active' | 'disabled' })
                    }}
                  >
                    <option value="active">Active</option>
                    <option value="disabled">Deactivated — no CMS access</option>
                  </select>
                </Field>
              )}
              {person?.super_admin && (
                <p>This person is a super admin and can access every site while their account is active.</p>
              )}
              {person && (person.pageAssignments.length > 0 || person.divisionAssignments.length > 0) && (
                <div className={workspace.denseStack}>
                  <h3 className={workspace.sectionHeading}>Chapter and division access</h3>
                  {person.pageAssignments.map(item => (
                    <Card key={item.pageId} density="settings">
                      <strong>{item.title}</strong>
                      <p>
                        Content creator ·{' '}
                        {item.enabled
                          ? 'Changes need approval'
                          : 'Access paused — check the account, chapter update mode or archived page'}
                      </p>
                      <TextLink href={'/sites/' + item.siteId + '/chapters'}>Manage chapter access</TextLink>
                      <p>The shared “What is Echelon” and “Join us” sections, menu and site look stay locked.</p>
                    </Card>
                  ))}
                  {person.divisionAssignments.map(item => (
                    <Card key={item.divisionId} density="settings">
                      <strong>{item.name}</strong>
                      <p>Site editor · edits and approves this division’s chapters.</p>
                      <TextLink href={'/sites/' + item.siteId + '/settings'}>Manage division team</TextLink>
                    </Card>
                  ))}
                  <p>Saving account access keeps these assignments. Deactivating the account pauses all access.</p>
                </div>
              )}
              <Disclosure
                title="Whole-site access"
                open={!person || person.pageAssignments.length + person.divisionAssignments.length === 0}
              >
                <fieldset
                  className={workspaceFormsStyles.formChoices + ' ' + workspace.denseStack}
                  aria-label="Whole-site access"
                >
                  <p className="hint">
                    This applies to every page on a site. Chapter and division assignments are managed separately.
                  </p>
                  {availableSites.map(site => (
                    <Field
                      density="compact"
                      key={site.id}
                      id={`person-site-${site.id}`}
                      label={site.name + (site.archived ? ' (archived)' : '')}
                    >
                      <select
                        id={`person-site-${site.id}`}
                        value={memberships.find(item => item.siteId === site.id)?.role ?? ''}
                        onChange={event => {
                          const next = memberships.filter(item => item.siteId !== site.id)
                          if (event.target.value)
                            next.push({ siteId: site.id, role: event.target.value as SiteAssignment['role'] })
                          change({ memberships: next })
                        }}
                      >
                        <option value="">No whole-site access</option>
                        <option value="contributor">Content creator — drafts and review</option>
                        <option value="editor">Site editor — edit and publish</option>
                        <option value="site_admin">Admin — manage this site</option>
                      </select>
                    </Field>
                  ))}
                </fieldset>
              </Disclosure>
            </fieldset>
            {person && person.status === 'active' && (person.super_admin || person.memberships.length > 0) && (
              <p>
                <Button
                  variant="secondary"
                  size="s"
                  type="button"
                  disabled={busy || !invitationsEnabled}
                  onClick={() => run(() => resendInvitation(person.id, person.revision), false)}
                >
                  Resend invitation
                </Button>
              </p>
            )}
          </form>
          {confirm && (
            <ConfirmDialog
              title={`Deactivate ${person?.display_name}?`}
              what="This person will lose access to every site on their next request."
              reassurance={
                <>
                  Their pages, drafts, and history remain available. You can reactivate the account later.
                  {result?.reauthenticate && (
                    <>
                      {' '}
                      <TextLink href="/sign-in?reauth=1" target="_blank" rel="noopener">
                        Confirm sign-in in a new tab
                      </TextLink>
                    </>
                  )}
                </>
              }
              confirmLabel="Deactivate account"
              pending={pending}
              error={result && !result.ok ? result.message : undefined}
              onCancel={() => setConfirm(false)}
              onConfirm={save}
            />
          )}
        </div>
      </DetailPanel>
    </section>
  )
}

function ResultNotice({ result }: { result: PeopleResult }) {
  return (
    <div className={`notice ${result.ok ? 'notice-ok' : 'notice-error'}`} role={result.ok ? 'status' : 'alert'}>
      <p>{result.message}</p>
      {result.reauthenticate && (
        <TextLink href="/sign-in?reauth=1" target="_blank" rel="noopener">
          Confirm sign-in in a new tab
        </TextLink>
      )}
    </div>
  )
}

function invitationMessage(person: PersonRow, localMail: boolean) {
  return person.invitation_cancelled
    ? 'Invitation cancelled because access changed'
    : person.invitation_status === 'delivered'
      ? localMail
        ? 'Invitation recorded locally'
        : 'Invitation accepted by email provider'
      : person.invitation_status === 'dead'
        ? 'Invitation needs attention — resend after checking email setup'
        : person.invitation_status === 'running'
          ? 'Invitation is sending'
          : (person.invitation_attempts ?? 0) > 0
            ? 'Invitation will retry after a delivery problem'
            : 'Invitation queued'
}
