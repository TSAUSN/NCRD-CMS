import { releaseLabel } from '../../../../lib/release-copy.ts'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import { cancelRelease, publishRelease } from './release-actions.ts'
import styles from './publish.module.css'
import shared from '../../../../components/workspace.module.css'
import type { ReleaseWorkspaceModel } from './use-release-workspace.ts'

export function ReleaseConfirmation({ model }: { model: ReleaseWorkspaceModel }) {
  const {
    native,
    current,
    result,
    override,
    samplesConfirmed,
    confirm,
    setConfirm,
    descriptions,
    pending,
    inFlight,
    hasSamples,
    blocked,
    run,
  } = model
  return (
    <>
      {confirm && current && (
        <ConfirmDialog
          size={confirm === 'publish' ? 'medium' : undefined}
          title={confirm === 'publish' ? 'Publish selected changes?' : 'Cancel this review?'}
          what={
            confirm === 'publish' ? (
              <div className={shared.stack}>
                <p>
                  {current.snapshot.length} selected {current.snapshot.length === 1 ? 'change will' : 'changes will'} go
                  live together.
                </p>
                <div>
                  <strong>What’s changing</strong>
                  <ul>
                    {current.snapshot.map(item => (
                      <li key={item.key}>
                        {releaseLabel(item)}
                        {descriptions.releaseId === current.id && descriptions.values[item.key] && (
                          <p className={styles.muted}>{descriptions.values[item.key]!.summary}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  {pending && (
                    <p role="status">
                      Publishing the selected changes and updating their pages. Keep this window open; this may take a
                      minute.
                    </p>
                  )}
                  <strong>Checks</strong>
                  <p>
                    {current.preview_report.length}{' '}
                    {current.preview_report.length === 1 ? 'page checked' : 'pages checked'} ·{' '}
                    {hasSamples
                      ? 'Sample content approved'
                      : blocked
                        ? 'Recorded exception reviewed'
                        : 'Ready to publish'}
                  </p>
                </div>
              </div>
            ) : (
              'This prepared review will close. Saved drafts stay available.'
            )
          }
          reassurance="Your earlier content remains in history."
          confirmLabel={confirm === 'publish' ? 'Publish selected' : 'Cancel review'}
          tone={confirm === 'publish' ? 'publish' : native ? 'primary' : 'danger'}
          pending={pending}
          error={result && !result.ok ? result.message : undefined}
          onCancel={() => {
            if (!inFlight.current) setConfirm(null)
          }}
          onConfirm={() =>
            run(
              () =>
                confirm === 'publish'
                  ? publishRelease(current.id, override, samplesConfirmed)
                  : cancelRelease(current.id),
              true,
            )
          }
        />
      )}
    </>
  )
}
