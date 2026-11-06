'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReleaseItem } from '../../../../lib/releases.ts'
import { releaseLabel, type ReleasePresentation } from '../../../../lib/release-copy.ts'
import { Button, Dialog, EmptyState, SegmentedControl, TextLink } from '../../../../components/ui/index.ts'
import { PageComparison } from '../../../../components/page-comparison.tsx'
import { readReleaseComparison } from './release-actions.ts'
import styles from './publish.module.css'
import shared from '../../../../components/workspace.module.css'
export function ReleaseComparisonDialog({
  siteId,
  item,
  initial,
  onClose,
}: {
  siteId: string
  item: ReleaseItem
  initial?: ReleasePresentation
  onClose: () => void
}) {
  const router = useRouter()
  const [data, setData] = useState<ReleasePresentation | undefined>(undefined),
    [error, setError] = useState(''),
    [stale, setStale] = useState(false),
    [attempt, setAttempt] = useState(0),
    [device, setDevice] = useState('1280')
  useEffect(() => {
    let active = true
    setData(undefined)
    setError('')
    setStale(false)
    void readReleaseComparison(siteId, item)
      .then(result => {
        if (!active) return
        if (result.ok) setData(result.comparison)
        else {
          setError(result.message)
          setStale(result.stale)
        }
      })
      .catch(() => {
        if (active) setError('The comparison could not be loaded. Try again.')
      })
    return () => {
      active = false
    }
  }, [siteId, item.key, item.revision, item.versionId, item.secondaryRevision, item.secondaryVersionId, attempt])
  return (
    <Dialog
      density="compact"
      title={`Changes to ${releaseLabel(item)}`}
      size="wide"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {!data && !error && (
        <>
          <p>{initial?.summary}</p>
          <p role="status">Loading changes…</p>
        </>
      )}
      {error && (
        <EmptyState
          title="Changes unavailable"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                if (stale) {
                  onClose()
                  router.refresh()
                } else setAttempt(value => value + 1)
              }}
            >
              {stale ? 'Refresh Publish' : 'Try again'}
            </Button>
          }
        >
          <p role="alert">{error}</p>
        </EmptyState>
      )}
      {data && (
        <div className={shared.formStack}>
          <p>{data?.summary ?? 'Review the saved changes.'}</p>
          {data?.preview && <p>{data!.preview!.note}</p>}
          {(item.type === 'page' || data?.preview) && (
            <SegmentedControl
              label="Compare page size"
              value={device}
              onChange={setDevice}
              options={[
                { value: '1280', label: 'Desktop' },
                { value: '768', label: 'Tablet' },
                { value: '390', label: 'Phone' },
              ]}
            />
          )}
          <div className={styles.compare}>
            {(['live', 'saved'] as const).map(side => {
              const details = data
              const source =
                details?.preview?.[side] ??
                (item.type === 'page'
                  ? side === 'live'
                    ? details?.beforeVersionId
                      ? `/preview/${details.beforeVersionId}?readonly=1`
                      : null
                    : item.versionId
                      ? `/preview/${item.versionId}?readonly=1`
                      : null
                  : null)
              return (
                <section key={side}>
                  <h3>{side === 'live' ? 'Live now' : 'Saved changes'}</h3>
                  {source ? (
                    <>
                      <TextLink href={source} target="_blank" rel="noopener">
                        {side === 'live' ? 'Open full live preview' : 'Open full saved preview'}
                      </TextLink>
                      <PageComparison
                        title={side === 'live' ? 'Live page' : 'Saved page'}
                        source={source}
                        width={Number(device)}
                      />
                    </>
                  ) : item.type === 'page' || details?.preview ? (
                    <p>This page is not live yet.</p>
                  ) : null}
                  <dl>
                    {details?.cells.map((cell, index) => (
                      <div key={index}>
                        <dt>{cell.label}</dt>
                        <dd>
                          <ComparedValue value={side === 'live' ? cell.before : cell.after} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )
            })}
          </div>
        </div>
      )}
    </Dialog>
  )
}

function ComparedValue({ value }: { value: string }) {
  return (
    <span className={styles.value}>
      {/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value) && (
        <span className={styles.swatch} style={{ backgroundColor: value }} aria-hidden="true" />
      )}
      {value}
    </span>
  )
}
