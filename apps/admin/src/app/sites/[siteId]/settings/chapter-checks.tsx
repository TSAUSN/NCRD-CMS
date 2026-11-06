'use client'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Tabs } from '../../../../components/ui/controls.tsx'
import { Card } from '../../../../components/ui/card.tsx'
import { Button } from '../../../../components/ui/button.tsx'
import { Field } from '../../../../components/ui/field.tsx'
import { TextLink as Link, TestTools, Badge } from '../../../../components/ui/index.ts'
import { saveChapterChecks, recordChapterMessages } from './chapter-actions.ts'
import shared from '../../../../components/workspace.module.css'
import { useBrowserSetup } from '../../../../components/use-browser-setup.ts'
export function ChapterChecks({
  siteId,
  revision,
  checksEnabled,
  remindersEnabled,
  year,
  actorId,
  isSuperAdmin,
}: {
  isSuperAdmin: boolean
  actorId: string
  siteId: string
  revision: string
  checksEnabled: boolean
  remindersEnabled: boolean
  year: number
}) {
  const router = useRouter(),
    [month, setMonth] = useState('01'),
    [nextYear, setYear] = useState(String(year)),
    [preview, setPreview] = useState('editors'),
    [result, setResult] = useState<{ ok: boolean; message: string } | null>(null),
    [resultFor, setResultFor] = useState<'settings' | 'contact' | 'review'>('settings'),
    [pending, start] = useTransition(),
    inFlight = useRef(false)
  const initial = { checks: checksEnabled, reminders: remindersEnabled, revision },
    setup = useBrowserSetup({
      storageKey: 'cms.chapter-checks.' + actorId + '.' + siteId,
      initial,
      label: 'Chapter check settings',
      pending: () => pending || inFlight.current,
      read: value => {
        const data = value as typeof initial
        return data &&
          typeof data.checks === 'boolean' &&
          typeof data.reminders === 'boolean' &&
          typeof data.revision === 'string' &&
          /^\d{1,30}$/.test(data.revision)
          ? { checks: data.checks, reminders: data.reminders, revision: data.revision }
          : null
      },
    }),
    { checks, reminders } = setup.value,
    busy = pending || setup.loading
  function run(
    action: () => Promise<{ ok: boolean; message: string; revision?: string }>,
    kind: 'settings' | 'contact' | 'review' = 'review',
  ) {
    if (inFlight.current || busy) return
    inFlight.current = true
    setResult(null)
    setResultFor(kind)
    start(async () => {
      try {
        const outcome = await action()
        setResult(outcome)
        if (outcome.ok) {
          if (kind === 'settings' && outcome.revision !== undefined)
            setup.accept({ ...setup.value, revision: outcome.revision })
          router.refresh()
        }
      } catch {
        setResult({
          ok: false,
          message:
            'The result could not be confirmed. Your choices are still here. Check the settings and local outbox before retrying.',
        })
      } finally {
        inFlight.current = false
      }
    })
  }

  return (
    <Card density="settings" title="Review reminders" aria-label="Chapter checks">
      <div className={shared.denseStack}>
        <div className={shared.formSection}>
          <p>
            {checksEnabled
              ? 'Each chapter’s point of contact receives one combined January or July check, even when they look after several chapters.'
              : 'January and July contact checks are off. Turn them on below.'}
          </p>
          <h3 className={shared.sectionHeading}>Ask in</h3>
          <div className={shared.tagList}>
            <Badge tone="info">January</Badge>
            <Badge tone="info">July</Badge>
          </div>
        </div>
        <div className={shared.formSection}>
          <h3 className={shared.sectionHeading}>What we ask them to check</h3>
          <div className={shared.tagList}>
            {['Chapter contact', 'Board members', 'This year’s events', 'Photos', 'Social links'].map(label => (
              <Badge key={label}>{label}</Badge>
            ))}
          </div>
        </div>
        <div className={shared.formSection}>
          <h3 className={shared.sectionHeading}>Email preview</h3>
          <Tabs
            appearance="segmented"
            density="compact"
            label="Email preview"
            value={preview}
            onChange={setPreview}
            tabs={[
              { value: 'editors', label: 'Chapters with editors' },
              { value: 'division', label: 'Division makes changes' },
            ]}
          >
            <div className={shared.messagePreview}>
              <strong>Time to check your Echelon chapter page</strong>
              {preview === 'editors' ? (
                <p>
                  Hi [Name], it’s {month === '01' ? 'January' : 'July'}, so please take a few minutes to check your
                  chapter page: contact, board, this year’s events, photos and social links. Done by{' '}
                  {month === '01' ? 'January' : 'July'} 31? Thank you!
                </p>
              ) : (
                <p>
                  Hi [Name], it’s {month === '01' ? 'January' : 'July'}. Please look over your chapter page and send any
                  changes (board, this year’s events, photos, contact or social links) in one email to the [Division]
                  web team by {month === '01' ? 'January' : 'July'} 31. Nothing to change? Just reply “all good”.
                </p>
              )}
            </div>
          </Tabs>
          <p className={shared.meta}>Chapters that do not respond show Review overdue on the Chapters screen.</p>
        </div>
        <div className={shared.formSection}>
          <h3 className={shared.sectionHeading}>Check settings</h3>
          <label className={shared.toggleRow}>
            <span>January and July contact checks</span>
            <input
              type="checkbox"
              role="switch"
              checked={checks}
              disabled={busy}
              onChange={event => setup.setValue(value => ({ ...value, checks: event.target.checked }))}
            />
          </label>
          <label className={shared.toggleRow}>
            <span>Remind the division and national team after five working days</span>
            <input
              type="checkbox"
              role="switch"
              checked={reminders}
              disabled={busy}
              onChange={event => setup.setValue(value => ({ ...value, reminders: event.target.checked }))}
            />
          </label>
          <p className={shared.meta}>
            Working days are Monday to Friday, using Eastern time. Nothing is published automatically. Contact checks
            and review reminders take effect as soon as you save.
          </p>
          <p className={shared.meta}>
            Save draft and leave keeps check settings only in this browser. Use Save check settings to apply them. No
            messages are recorded on leave.
          </p>
          {setup.saved && (
            <>
              <p>Check settings restored or saved in this browser.</p>
              <div>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (setup.clear()) setResult(null)
                  }}
                >
                  Clear saved check settings
                </Button>
              </div>
            </>
          )}
          {setup.error && <p role="alert">{setup.error}</p>}
          <div>
            <Button
              variant="secondary"
              loading={pending}
              disabled={busy}
              onClick={() =>
                run(() => saveChapterChecks({ siteId, revision: setup.value.revision, checks, reminders }), 'settings')
              }
            >
              Save check settings
            </Button>
          </div>
          {result && resultFor === 'settings' && <p role={result.ok ? 'status' : 'alert'}>{result.message}</p>}
        </div>
        <TestTools isSuperAdmin={isSuperAdmin}>
          <div className={shared.denseStack}>
            <p>This demo records messages locally; no email is sent.</p>
            <h3 className={shared.sectionHeading}>Try a contact check</h3>
            <div className={shared.equalColumns}>
              <Field density="compact" id="chapter-check-month" label="Check month">
                <select value={month} disabled={busy} onChange={event => setMonth(event.target.value)}>
                  <option value="01">January</option>
                  <option value="07">July</option>
                </select>
              </Field>
              <Field density="compact" id="chapter-check-year" label="Check year">
                <input
                  type="number"
                  min="2020"
                  max="2099"
                  value={nextYear}
                  disabled={busy}
                  onChange={event => setYear(event.target.value)}
                />
              </Field>
            </div>
            <div>
              <Button
                loading={pending}
                disabled={busy || !checksEnabled}
                onClick={() =>
                  run(() => recordChapterMessages({ siteId, cycle: nextYear + '-' + month + '-01' }), 'contact')
                }
              >
                Record contact check
              </Button>
            </div>
            {result && resultFor === 'contact' && <p role={result.ok ? 'status' : 'alert'}>{result.message}</p>}
            {!checksEnabled && <p>Turn contact checks on and save the settings to record a check.</p>}
            <p>
              <strong>Division’s page:</strong> The January and July message asks the contact to check that the address
              still works and the chapter information is current. It includes the saved division page address.
            </p>
            <h3 className={shared.sectionHeading}>Waiting for approval</h3>
            <p>
              The local worker records new review requests and reminders while it is running. You can also check for
              waiting requests now.
            </p>
            <div>
              <Button
                variant="secondary"
                loading={pending}
                disabled={busy}
                onClick={() => run(() => recordChapterMessages({ siteId }))}
              >
                Record waiting review messages
              </Button>
            </div>
            {result && resultFor === 'review' && <p role={result.ok ? 'status' : 'alert'}>{result.message}</p>}
            <p>
              <Link href={'/sites/' + siteId + '/outbox'}>Open local outbox</Link>
            </p>
          </div>
        </TestTools>
      </div>
    </Card>
  )
}
