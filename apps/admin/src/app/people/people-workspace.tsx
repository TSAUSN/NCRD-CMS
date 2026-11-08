'use client'

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useTransition } from 'react'
import {
  Button,
  Card,
  CardContent,
  Field,
  EmptyState,
  SearchField,
  Disclosure,
  Badge,
  ListDetail,
} from '../../components/ui/index.ts'
import { requestLocalDraftNavigation } from '../../components/navigation-guard.ts'
import type { NavigationGuardState } from '../../lib/navigation-guard.ts'
import { personAccessSummary, personRoles } from '../../lib/people-access.ts'
import workspace from '../../components/workspace.module.css'
import workspaceFormsStyles from '../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../components/workspace-styles/record-table.module.css'
import listInspectorStyles from '../../components/workspace-styles/list-inspector.module.css'
import { useRouter } from 'next/navigation'
import type { PersonRow } from '../../lib/people.ts'
import { PersonEditor } from './person-editor.tsx'
import type { AccessSite } from './use-person-access-draft.ts'

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
  sites: AccessSite[]
  currentUserId: string
  localMail: boolean
  invitationsEnabled?: boolean
}) {
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null)
  useEffect(() => setHeaderTarget(headerActionsId ? document.getElementById(headerActionsId) : null), [headerActionsId])
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const [search, setSearch] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [selection, setSelection] = useState<Selection>(null)
  const editorLeave = useRef<() => NavigationGuardState>(() => ({ dirty: false, pending: false }))
  const [notice, setNotice] = useState<string | null>(null)
  const [actionBusy, setBusy] = useState(false)
  const busyRef = useRef(false)
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
