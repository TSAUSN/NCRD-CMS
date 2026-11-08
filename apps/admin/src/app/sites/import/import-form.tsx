'use client'
import { useEffect, useRef } from 'react'
import { Button, ButtonLink, Card, Field } from '../../../components/ui/index.ts'
import styles from './import.module.css'
import { ArchiveReview } from './archive-review.tsx'
import { useSiteImportDraft } from './use-site-import-draft.ts'

export function SiteImportForm({ actorId }: { actorId: string }) {
  const model = useSiteImportDraft(actorId)
  const { archive, error, siteId, recovering, hasRecovery, recoveryError, fileName, busy, clearSaved, load } = model
  const errorRef = useRef<HTMLParagraphElement | null>(null)
  useEffect(() => {
    if (error) {
      errorRef.current?.focus()
      errorRef.current?.scrollIntoView({ block: 'center' })
    }
  }, [error])
  return (
    <Card title="Choose a content archive">
      <p>
        The new site starts with private drafts. Review and publish its pages, design, navigation, and header/footer
        when ready.
      </p>
      <p>
        Save draft and leave keeps this setup and archive only in this browser. It creates no site. Keep the original
        archive file too.
      </p>
      {recovering && <p role="status">Checking this browser for saved import setup…</p>}
      {hasRecovery && (
        <>
          <p>
            Import setup is available in this browser. Review the destination and any site files again before creating a
            copy.
          </p>
          <Button variant="secondary" disabled={busy} onClick={() => void clearSaved()}>
            Clear saved import setup
          </Button>
          {recoveryError && (
            <p role="alert" className={styles.error}>
              {recoveryError}
            </p>
          )}
        </>
      )}
      <p className="hint">
        Images and saved content versions are included. People, permissions, domains, schedules, and trusted-code
        approvals are set up separately.
      </p>
      <Field id="site-content-archive" label="Content archive (.json, up to 64 MB)">
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            void load(file)
          }}
        />
      </Field>
      {archive && <p>Loaded archive: {fileName || 'Saved content archive'}</p>}

      {archive && <ArchiveReview archive={archive} model={model} />}
      {error && (
        <p ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {siteId && (
        <div role="status">
          <p>Your site content was imported as private drafts.</p>
          <ButtonLink href={`/sites/${siteId}`}>Open imported site</ButtonLink>
        </div>
      )}
    </Card>
  )
}
