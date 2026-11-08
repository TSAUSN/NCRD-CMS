'use client'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { ChapterTeam } from '../../../../lib/chapters.ts'
import { Card } from '../../../../components/ui/card.tsx'
import { Button } from '../../../../components/ui/button.tsx'
import { TextLink as Link, Disclosure } from '../../../../components/ui/index.ts'
import shared from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../../components/workspace-styles/site-summary.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import { Field } from '../../../../components/ui/field.tsx'
import { saveChapterSettings, saveChapterTeam } from './chapter-actions.ts'
import { useBrowserSetup } from '../../../../components/use-browser-setup.ts'
type Result = { ok: boolean; message: string }
export function ChapterSettings({
  siteId,
  revision,
  defaultMode,
  teams,
  actorId,
}: {
  actorId: string
  siteId: string
  revision: string
  defaultMode: 'division' | 'chapter-editors'
  teams: ChapterTeam[]
}) {
  return (
    <>
      <ChapterDefaults actorId={actorId} siteId={siteId} revision={revision} defaultMode={defaultMode} />
      <Card density="settings" title="Chapter teams">
        <div className={shared.denseStack}>
          <p>
            Assign a division team in each chapter’s setup. Its web staff can edit and approve only that division’s
            chapters. Site administrators can approve as backup.
          </p>
          {!teams.length && <p>No division teams yet. Add the first team, then assign it in Chapters.</p>}
          {teams.map(team => (
            <DivisionTeam key={team.id} actorId={actorId} team={team} siteId={siteId} />
          ))}
          <NewDivision actorId={actorId} siteId={siteId} />
        </div>
      </Card>
    </>
  )
}
function ChapterDefaults({
  siteId,
  revision,
  defaultMode,
  actorId,
}: {
  actorId: string
  siteId: string
  revision: string
  defaultMode: 'division' | 'chapter-editors'
}) {
  const router = useRouter()
  const [result, setResult] = useState<Result | null>(null)
  const [pending, start] = useTransition()
  const inFlight = useRef(false)
  const initial = { mode: defaultMode, revision }
  const setup = useBrowserSetup({
    storageKey: 'cms.chapter-defaults.' + actorId + '.' + siteId,
    initial,
    label: 'Chapter defaults',
    pending: () => pending || inFlight.current,
    read: value => {
      const data = value as typeof initial
      return data &&
        ['division', 'chapter-editors'].includes(data.mode) &&
        typeof data.revision === 'string' &&
        /^\d{1,30}$/.test(data.revision)
        ? { mode: data.mode, revision: data.revision }
        : null
    },
  })
  const { mode } = setup.value
  const busy = pending || setup.loading
  function save() {
    if (inFlight.current || busy) return
    inFlight.current = true
    setResult(null)
    start(async () => {
      try {
        const outcome = await saveChapterSettings({ siteId, revision: setup.value.revision, mode })
        setResult(outcome)
        if (outcome.ok) {
          setup.accept({ mode, revision: outcome.revision })
          router.refresh()
        }
      } catch {
        setResult({
          ok: false,
          message: 'The save could not be confirmed. Your choices are still here. Reload the settings before retrying.',
        })
      } finally {
        inFlight.current = false
      }
    })
  }
  return (
    <Card density="settings" title="Publishing and approval" aria-label="Chapter defaults">
      <div className={shared.denseStack}>
        <p className={recordTableStyles.meta}>
          Save draft and leave keeps these choices only in this browser. Chapter defaults change only when you choose
          Save chapter defaults.
        </p>
        {setup.saved && (
          <>
            <p>Chapter defaults restored or saved in this browser.</p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (setup.clear()) setResult(null)
              }}
            >
              Clear saved chapter defaults
            </Button>
          </>
        )}
        {setup.error && <p role="alert">{setup.error}</p>}
        {result && <p role={result.ok ? 'status' : 'alert'}>{result.message}</p>}
        <p>
          <strong>Chapter editors send changes for approval before they go live.</strong>
        </p>
        <p>
          Assigned division web staff can approve their chapters. Site administrators can approve as backup. This access
          rule stays in place for every new chapter.
        </p>
        <div>
          <h3 className={shared.sectionHeading}>Who approves each chapter</h3>
          <p>
            Each chapter’s setup records its division team.{' '}
            <Link href={'/sites/' + siteId + '/chapters'}>Open Chapters</Link> to review or change an assignment. Manage
            division staff below.
          </p>
        </div>
        <fieldset className={workspaceFormsStyles.formChoices}>
          <legend>New chapters start with</legend>
          <div className={selectionControlsStyles.choiceRows}>
            <label>
              <input
                type="radio"
                name="chapter-default"
                checked={mode === 'division'}
                disabled={busy}
                onChange={() => setup.setValue(value => ({ ...value, mode: 'division' }))}
              />
              <span>
                <strong>Division web team makes changes</strong>
                <span className={recordTableStyles.meta}>
                  The chapter’s point of contact sends changes to the division. Nobody from the chapter needs to sign
                  in.
                </span>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="chapter-default"
                checked={mode === 'chapter-editors'}
                disabled={busy}
                onChange={() => setup.setValue(value => ({ ...value, mode: 'chapter-editors' }))}
              />
              <span>
                <strong>Chapter editors sign in</strong>
                <span className={recordTableStyles.meta}>
                  Named chapter editors change their own page and send it for approval.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
        <p>Existing chapters keep their own setup. Chapter defaults apply as soon as you save.</p>
        <div>
          <Button variant="secondary" loading={pending} disabled={busy} onClick={save}>
            Save chapter defaults
          </Button>
        </div>
        <div>
          <h3 className={shared.sectionHeading}>If nobody approves</h3>
          <p>
            When review reminders are on, the division and national team are reminded after five working days. Nothing
            is published automatically.
          </p>
        </div>
      </div>
    </Card>
  )
}
function NewDivision({ siteId, actorId }: { actorId: string; siteId: string }) {
  const router = useRouter()
  const [result, setResult] = useState<Result | null>(null)
  const [pending, start] = useTransition()
  const inFlight = useRef(false)
  const initial = { name: '' }
  const setup = useBrowserSetup({
    storageKey: 'cms.chapter-new-division.' + actorId + '.' + siteId,
    initial,
    label: 'New division team',
    pending: () => pending || inFlight.current,
    read: value => {
      const data = value as typeof initial
      return data && typeof data.name === 'string' && data.name.length <= 120 ? { name: data.name } : null
    },
  })
  const busy = pending || setup.loading
  function save() {
    if (inFlight.current || busy) return
    inFlight.current = true
    setResult(null)
    start(async () => {
      try {
        const outcome = await saveChapterTeam({ siteId, divisionName: setup.value.name })
        setResult(outcome)
        if (outcome.ok) {
          setup.accept(initial)
          router.refresh()
        }
      } catch {
        setResult({
          ok: false,
          message:
            'The save could not be confirmed. Your entries are still here. Check the division teams before retrying.',
        })
      } finally {
        inFlight.current = false
      }
    })
  }
  return (
    <form
      className={shared.denseStack}
      aria-label="New division team"
      onSubmit={event => {
        event.preventDefault()
        save()
      }}
    >
      <p className={recordTableStyles.meta}>
        Save draft and leave keeps the division name only in this browser. Use Add division team to create it.
      </p>
      {setup.saved && (
        <>
          <p>Division name restored or saved in this browser.</p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (setup.clear()) setResult(null)
            }}
          >
            Clear saved division name
          </Button>
        </>
      )}
      {setup.error && <p role="alert">{setup.error}</p>}
      <Field density="compact" id="new-division-name" label="Division name">
        <input
          required
          maxLength={120}
          value={setup.value.name}
          disabled={busy}
          onChange={event => {
            setResult(null)
            setup.setValue({ name: event.target.value })
          }}
        />
      </Field>
      <div>
        <Button type="submit" variant="secondary" loading={pending} disabled={busy}>
          Add division team
        </Button>
      </div>
      {result && <p role={result.ok ? 'status' : 'alert'}>{result.message}</p>}
    </form>
  )
}

function DivisionTeam({ team, siteId, actorId }: { actorId: string; team: ChapterTeam; siteId: string }) {
  const router = useRouter()
  const [result, setResult] = useState<Result | null>(null)
  const [pending, start] = useTransition()
  const inFlight = useRef(false)
  const initial = { email: '', name: '' }
  const setup = useBrowserSetup({
    storageKey: 'cms.chapter-division-staff.' + actorId + '.' + siteId + '.' + team.id,
    initial,
    label: team.name + ' staff choices',
    pending: () => pending || inFlight.current,
    read: value => {
      const data = value as typeof initial
      return data &&
        typeof data.email === 'string' &&
        data.email.length <= 254 &&
        typeof data.name === 'string' &&
        data.name.length <= 120
        ? { email: data.email, name: data.name }
        : null
    },
  })
  const { email, name } = setup.value
  const busy = pending || setup.loading
  function save(person: { email: string; name: string }, enabled: boolean) {
    if (inFlight.current || busy) return
    inFlight.current = true
    setResult(null)
    start(async () => {
      try {
        const outcome = await saveChapterTeam({ siteId, divisionId: team.id, ...person, enabled })
        setResult(outcome)
        if (outcome.ok) {
          if (enabled) setup.accept(initial)
          router.refresh()
        }
      } catch {
        setResult({
          ok: false,
          message:
            'The team change could not be confirmed. Your entries are still here. Check the team before retrying.',
        })
      } finally {
        inFlight.current = false
      }
    })
  }
  return (
    <Disclosure
      title={
        <>
          {team.name} · {team.people.length} {team.people.length === 1 ? 'person' : 'people'}
        </>
      }
    >
      <div className={shared.denseStack}>
        <p>
          Staff receive division access. This does not give them site settings, lists or another division’s pages. No
          email is sent.
        </p>
        <p className={recordTableStyles.meta}>
          Save draft and leave keeps staff choices only in this browser. Use Add division staff to grant access.
        </p>
        {setup.saved && (
          <>
            <p>Staff choices restored or saved in this browser.</p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (setup.clear()) setResult(null)
              }}
            >
              Clear saved staff choices
            </Button>
          </>
        )}
        {setup.error && <p role="alert">{setup.error}</p>}
        {team.people.length ? (
          <ul className={siteSummaryStyles.rowList}>
            {team.people.map(person => (
              <li key={person.id}>
                <span className={recordTableStyles.rowCopy}>
                  <strong className={recordTableStyles.singleLine} title={person.name}>
                    {person.name}
                  </strong>
                  <span className={recordTableStyles.singleLine + ' ' + recordTableStyles.meta} title={person.email}>
                    {person.email}
                    {!person.active ? ' · Access paused' : ''}
                  </span>
                </span>
                <Button
                  variant="tertiary"
                  disabled={busy}
                  onClick={() => save(person, false)}
                  aria-label={'Remove ' + person.name + ' from ' + team.name}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p>No division staff yet.</p>
        )}
        <form
          className={shared.denseStack}
          onSubmit={event => {
            event.preventDefault()
            save({ email, name }, true)
          }}
        >
          <Field density="compact" id={'division-name-' + team.id} label="Staff name">
            <input
              required
              value={name}
              maxLength={120}
              disabled={busy}
              onChange={event => {
                setResult(null)
                setup.setValue(value => ({ ...value, name: event.target.value }))
              }}
            />
          </Field>
          <Field density="compact" id={'division-email-' + team.id} label="Staff email">
            <input
              required
              type="email"
              value={email}
              maxLength={254}
              disabled={busy}
              onChange={event => {
                setResult(null)
                setup.setValue(value => ({ ...value, email: event.target.value }))
              }}
            />
          </Field>
          <div>
            <Button type="submit" variant="secondary" loading={pending} disabled={busy}>
              Add division staff
            </Button>
          </div>
        </form>
        {result && <p role={result.ok ? 'status' : 'alert'}>{result.message}</p>}
      </div>
    </Disclosure>
  )
}
