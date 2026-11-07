'use client'
import { notifySiteChoicesChanged } from '../../../../components/sidebar-data.tsx'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import { TextLink } from '../../../../components/ui/text-link.tsx'
import { Card } from '../../../../components/ui/card.tsx'
import { Field } from '../../../../components/ui/field.tsx'
import { Button } from '../../../../components/ui/button.tsx'
import surfaceControlsStyles from '../../../../components/ui/styles/surface-controls.module.css'
import { changeSiteSettings } from './actions.ts'

export function SiteSettingsForm({
  siteId,
  name,
  revision,
  archived,
  canManage,
}: {
  siteId: string
  name: string
  revision: string
  archived: boolean
  canManage: boolean
}) {
  const router = useRouter()
  const [nextName, setNextName] = useState(name)
  const [result, setResult] = useState<Awaited<ReturnType<typeof changeSiteSettings>> | null>(null)
  const [pending, startTransition] = useTransition()
  const inFlight = useRef(false)
  function save(archive: boolean) {
    if (inFlight.current) return
    inFlight.current = true
    startTransition(async () => {
      try {
        const outcome = await changeSiteSettings({ siteId, revision, name: nextName, archive })
        setResult(outcome)
        if (outcome.ok) {
          notifySiteChoicesChanged()
          router.refresh()
        }
      } catch {
        setResult({
          ok: false,
          message: 'The result could not be confirmed. Reload to check the site before retrying.',
          reauthenticate: false,
        })
      } finally {
        inFlight.current = false
      }
    })
  }
  return (
    <Card density="settings" title="General">
      {archived && (
        <p className="notice" role="status">
          This site is archived. Its history remains in the CMS, and its public addresses return a not-found page.
        </p>
      )}
      {!canManage && <p>A site admin can change these settings.</p>}
      <form
        onSubmit={event => {
          event.preventDefault()
          save(false)
        }}
      >
        <Field id="settings-site-name" label="Site name in the CMS">
          <input
            id="settings-site-name"
            value={nextName}
            maxLength={120}
            required
            disabled={!canManage || archived || pending}
            onChange={event => setNextName(event.target.value)}
          />
        </Field>
        {canManage && !archived && (
          <div className={surfaceControlsStyles.actions}>
            <Button type="submit" loading={pending} disabled={!nextName.trim()}>
              Save site name
            </Button>
          </div>
        )}
      </form>
      {result && (
        <p className={`notice ${result.ok ? 'notice-ok' : 'notice-error'}`} role={result.ok ? 'status' : 'alert'}>
          {result.message}
        </p>
      )}
    </Card>
  )
}

export function ArchiveSite({ siteId, name, revision }: { siteId: string; name: string; revision: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [reauthenticate, setReauthenticate] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [pending, startTransition] = useTransition()
  const inFlight = useRef(false)
  function archive() {
    if (typed !== name || inFlight.current) return
    inFlight.current = true
    startTransition(async () => {
      try {
        const result = await changeSiteSettings({ siteId, revision, name, archive: true })
        if (result.ok) {
          notifySiteChoicesChanged()
          setOpen(false)
          router.refresh()
        } else {
          setError(result.message)
          setReauthenticate(result.reauthenticate)
        }
      } catch {
        setError('The result could not be confirmed. Reload to check the site before retrying.')
      } finally {
        inFlight.current = false
      }
    })
  }
  return (
    <Card
      density="settings"
      title="Danger zone"
      tone="danger"
      actions={
        <Button
          variant="destructive"
          onClick={() => {
            setError(undefined)
            setTyped('')
            setOpen(true)
          }}
        >
          Archive site
        </Button>
      }
    >
      <p>Archiving removes every page from the site's public addresses. Content and history stay in the CMS.</p>
      {open && (
        <ConfirmDialog
          title={`Archive “${name}”?`}
          what={
            <Field id="archive-site-name" label="Type the site name to confirm" help={name}>
              <input
                id="archive-site-name"
                aria-describedby="archive-site-name-help"
                value={typed}
                disabled={pending}
                onChange={event => setTyped(event.target.value)}
              />
            </Field>
          }
          reassurance={
            <>
              Every public page on this site will stop serving. This keeps the site’s content and history.
              {reauthenticate && (
                <>
                  {' '}
                  <TextLink href="/sign-in?reauth=1" target="_blank" rel="noopener">
                    Confirm sign-in
                  </TextLink>
                </>
              )}
            </>
          }
          confirmLabel="Archive site"
          pending={pending}
          error={error}
          onCancel={() => {
            if (!pending) setOpen(false)
          }}
          onConfirm={archive}
          confirmDisabled={typed !== name}
        />
      )}
    </Card>
  )
}
