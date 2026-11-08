'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ThemeTokens } from '@cms/schema'
import { Badge, Button, Card, Dialog, EmptyState, Field, Note, PageHeader } from '../../../../../components/ui/index.ts'
import { useFontLibraryDraft, type FontLibraryProps } from './use-font-library-draft.ts'
import { FontPreviewStage } from './font-preview-stage.tsx'
import styles from '../../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../../components/workspace-styles/record-table.module.css'
import listInspectorStyles from '../../../../../components/workspace-styles/list-inspector.module.css'

export function FontLibrary(props: FontLibraryProps) {
  const { siteId, initial, chapter, liveHost } = props
  const router = useRouter()
  const [review, setReview] = useState(false)
  const {
    iframe,
    newestFrame,
    canvas,
    connected,
    dirty,
    pending,
    notice,
    error,
    kit,
    setKit,
    check,
    page,
    host,
    status,
    tokens,
    setFont,
    headingOptions,
    bodyOptions,
    defaultBody,
    buttonFont,
    save,
  } = useFontLibraryDraft(props)
  const previewFrame =
    canvas.error && !canvas.ticket ? (
      <EmptyState title="No font preview yet">{canvas.error}</EmptyState>
    ) : (
      <FontPreviewStage
        href={canvas.ticket ? canvas.ticket.href + '?visit=1&fonts=1' : null}
        loading={canvas.loading}
        visibleFrame={iframe}
        newestFrame={newestFrame}
      />
    )
  return (
    <>
      <PageHeader
        density="compact"
        showWayfinding={false}
        title="Site look"
        lede="Fonts come from the approved kit. Each site picks from them."
        tabs={[
          { label: 'Colours', href: '/sites/' + siteId + '/design' },
          { label: 'Fonts', href: '/sites/' + siteId + '/design/fonts', current: true },
          { label: 'Buttons', href: '/sites/' + siteId + '/design#theme-button-title' },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!connected}
              onClick={() => iframe.current?.scrollIntoView({ block: 'center' })}
            >
              Preview
            </Button>
            <Button variant="publish" disabled={dirty || pending || !connected} onClick={() => setReview(true)}>
              Publish…
            </Button>
          </>
        }
      />
      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={'notice ' + (notice.ok ? 'notice-ok' : 'notice-error')}>
          {notice.message}
          {!notice.ok && notice.kind === 'conflict' && (
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          )}
        </p>
      )}
      {!connected ? (
        <>
          <Card className={workspaceFormsStyles.readableForm} density="editor" title="Connect an Adobe Fonts kit">
            <div className={listInspectorStyles.formStack}>
              <p className="muted">
                Paste the kit’s stylesheet link. Fonts load from Adobe, and your licence covers them. Nothing is
                uploaded here.
              </p>
              <Field id="font-kit" label="Kit link" error={error}>
                <input value={kit} onChange={event => setKit(event.target.value)} />
              </Field>
              <div className={workspaceFormsStyles.actions}>
                <Button onClick={check}>Check kit</Button>
              </div>
            </div>
          </Card>
          <Note>Until a kit is connected, the site uses the template’s stand-in fonts.</Note>
        </>
      ) : (
        <>
          {!page || !host ? (
            <Note>Create a page and set a staging address before checking these fonts.</Note>
          ) : status === 'loaded' ? (
            <Note tone="success">
              Kit connected. 4 font families found. Fonts load at {host}. Live addresses must be checked at launch.
            </Note>
          ) : status === 'unavailable' ? (
            <Note tone="warning">
              <strong>This address isn’t on the kit’s allowed list, or Adobe could not be reached.</strong> Visitors to{' '}
              {host} will see stand-in fonts. Whoever owns the Adobe account adds the address to the kit, then press
              Check again.
            </Note>
          ) : (
            <Note>Checking fonts at {host}… The page uses stand-in fonts while this check finishes.</Note>
          )}
          <div className={styles.equalColumns}>
            <Card density="editor" title="Which font goes where">
              <div className={listInspectorStyles.formStack}>
                <Field id="font-heading" label="Headings">
                  <select
                    value={tokens.fonts.heading}
                    disabled={pending}
                    onChange={event => setFont('heading', event.target.value as ThemeTokens['fonts']['heading'])}
                  >
                    {headingOptions.map(font => (
                      <option key={font.value} value={font.value}>
                        {font.label.replace(' (Adobe)', '')}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="font-body" label="Body text">
                  <select
                    value={tokens.fonts.body}
                    disabled={pending}
                    onChange={event => setFont('body', event.target.value as ThemeTokens['fonts']['body'])}
                  >
                    {bodyOptions.map(font => (
                      <option key={font.value} value={font.value}>
                        {font.label.replace(' (Adobe)', '')}
                        {font.value === defaultBody ? ', light' : ''}
                      </option>
                    ))}
                    {!bodyOptions.some(font => font.value === tokens.fonts.body) && (
                      <option value={tokens.fonts.body}>Current stand-in</option>
                    )}
                  </select>
                </Field>
                <div>
                  <strong>Buttons and small labels</strong>
                  <p>{buttonFont ?? 'Current body font'} · template weight</p>
                  <p className={recordTableStyles.meta}>
                    Uses the body font and the national template’s button weight.
                  </p>
                </div>
                <p className="muted">
                  {chapter
                    ? 'Chapter sites keep sans-serif headings. Trajan Pro 3 is not available here.'
                    : 'Trajan Pro 3 has capitals only, so section titles appear as small capitals.'}
                </p>
                <div className={workspaceFormsStyles.actions}>
                  <Button
                    variant="secondary"
                    loading={pending}
                    disabled={!dirty || status === 'checking'}
                    onClick={save}
                  >
                    Save draft
                  </Button>
                  <Button variant="secondary" disabled={pending || status === 'checking'} onClick={check}>
                    Check again
                  </Button>
                </div>
                {error && <p role="alert">{error}</p>}
              </div>
            </Card>
            <div>
              {previewFrame}
              <p className={recordTableStyles.meta}>
                The saved page with these font choices. Preview changes stay private until published.
              </p>
              {canvas.error && <p role="alert">{canvas.error}</p>}
            </div>
          </div>
          <div className={recordTableStyles.tableWrap}>
            <table className={recordTableStyles.table + ' ' + recordTableStyles.compactTable}>
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Fonts load?</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td title={host ?? undefined}>{host}</td>
                  <td>
                    <Badge
                      tone={status === 'loaded' ? 'live' : 'pending'}
                      title={status === 'unavailable' ? 'Not allowed yet or unavailable' : undefined}
                    >
                      {status === 'loaded' ? 'Yes' : status === 'unavailable' ? 'Unavailable' : 'Checking…'}
                    </Badge>
                  </td>
                  <td>
                    <Button variant="secondary" size="s" disabled={status === 'checking'} onClick={check}>
                      Check again
                    </Button>
                  </td>
                </tr>
                {liveHost && liveHost !== host && (
                  <tr>
                    <td title={liveHost}>{liveHost}</td>
                    <td>
                      <Badge>Check at launch</Badge>
                    </td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {review && (
        <Dialog
          title="Publish site look"
          onClose={() => setReview(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setReview(false)}>
                Cancel
              </Button>
              <Button variant="publish" onClick={() => router.push('/sites/' + siteId + '/publishing?area=site-look')}>
                Review saved changes
              </Button>
            </>
          }
        >
          <p>
            The saved font choices affect every page on this site. Review the saved changes and checks before
            publishing.
          </p>
          <p>{initial.contentSummary} use this site look.</p>
        </Dialog>
      )}
    </>
  )
}
