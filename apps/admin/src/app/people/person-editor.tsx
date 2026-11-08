import { Button, Card, Field, DetailPanel, Disclosure, TextLink, Badge, ActionNote } from '../../components/ui/index.ts'
import { ConfirmDialog } from '../../components/confirm.tsx'
import { personAccessSummary, personRoles } from '../../lib/people-access.ts'
import type { SiteAssignment } from '../../lib/people.ts'
import { resendInvitation, type PeopleResult } from './actions.ts'
import { usePersonAccessDraft, type PersonEditorProps } from './use-person-access-draft.ts'
import workspace from '../../components/workspace.module.css'
import workspaceFormsStyles from '../../components/workspace-styles/workspace-forms.module.css'
import listInspectorStyles from '../../components/workspace-styles/list-inspector.module.css'
import ownedStyles from './people-workspace-styles.module.css'

export function PersonEditor(props: PersonEditorProps) {
  const { person, currentUserId, invitationsEnabled, onCancel } = props
  const {
    formId,
    result,
    setResult,
    pending,
    inFlight,
    confirm,
    setConfirm,
    setup,
    name,
    email,
    status,
    memberships,
    busy,
    availableSites,
    unavailable,
    change,
    run,
    save,
  } = usePersonAccessDraft(props)
  const rolesBySite = new Map(memberships.map(item => [item.siteId, item.role]))
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
                        value={rolesBySite.get(site.id) ?? ''}
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
