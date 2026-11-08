'use client'
import { validSectionAnchor } from '@cms/schema'
import { Button, Field, EmptyState, Disclosure, TextLink } from '../../../components/ui/index.ts'
import { IconChevronLeft } from '../../../components/icons.tsx'
import { useSectionTools, type SectionToolsProps } from './use-section-tools.ts'
import workspaceFormsStyles from '../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../components/workspace-styles/site-summary.module.css'
import listInspectorStyles from '../../../components/workspace-styles/list-inspector.module.css'
import reviewWorkbenchStyles from '../../../components/workspace-styles/review-workbench.module.css'
import styles from './inspector.module.css'
export function SectionToolsPanel(props: SectionToolsProps) {
  const { kind, siteId } = props
  const {
    review,
    pages,
    name,
    targetId,
    target,
    at,
    setAt,
    loading,
    pending,
    error,
    notice,
    copied,
    done,
    addressInput,
    valid,
    address,
    close,
    save,
    copyLink,
    changeName,
    chooseTarget,
    retryStep,
    cancel,
  } = useSectionTools(props)
  return (
    <aside
      id="editor-panel-inspector"
      className={'pane inspector ' + styles.inspector}
      aria-label="Section tools"
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as Element).closest?.('dialog')) {
          event.preventDefault()
          close()
        }
      }}
    >
      <div className={workspaceFormsStyles.panelActions}>
        <Button variant="tertiary" disabled={pending} onClick={close}>
          <IconChevronLeft size={16} />
          Back to section
        </Button>
        <Button variant={done ? 'primary' : 'secondary'} disabled={pending} onClick={close}>
          Done
        </Button>
      </div>
      <div className={listInspectorStyles.formStack}>
        <h2>{kind === 'link' ? 'Link to this section' : 'Copy this section to another page'}</h2>
        <p className={recordTableStyles.meta}>Finish this step before using page actions. Nothing is published here.</p>
        <p className={recordTableStyles.meta}>
          {kind === 'link'
            ? 'Use this link in a button, an email or a menu. It opens this page and scrolls here.'
            : 'It copies the text and settings onto that page’s draft. Story tags stay the same.'}
        </p>
        {loading ? (
          <p role="status">Opening this section step…</p>
        ) : kind === 'link' && review ? (
          <>
            <Field
              id="section-link-name"
              label="Link name"
              help="Start with a letter. Use lowercase letters, numbers and hyphens."
              error={
                name && !validSectionAnchor(name)
                  ? 'Choose another link name. This format or name is reserved.'
                  : undefined
              }
            >
              <input
                autoFocus
                required
                maxLength={64}
                disabled={pending || done}
                value={name}
                onChange={event => changeName(event.target.value)}
              />
            </Field>
            <Field id="section-link-address" label="Link address">
              <input ref={addressInput} readOnly value={address} onFocus={event => event.target.select()} />
            </Field>
            <Button
              variant="secondary"
              disabled={pending || !address || (name !== review.name && !done)}
              onClick={() => void copyLink()}
            >
              Copy link
            </Button>
            {!done && (
              <p>
                {review.references} {review.references === 1 ? 'link leads' : 'links lead'} here now. If you change the
                name, they update with you.
              </p>
            )}
            {!review.name && !done && (
              <p className={recordTableStyles.meta}>
                Save the link name before copying it. It works for visitors after this page is published.
              </p>
            )}
            {review.unsafe && (
              <p role="alert">
                A shared or formatted link needs a manual review. Open the affected draft and check its destination
                before renaming.
              </p>
            )}
            {review.affected.length > 0 && (
              <Disclosure title={<>Affected drafts ({review.affected.length})</>}>
                <ul>
                  {review.affected.map(label => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              </Disclosure>
            )}
          </>
        ) : kind === 'copy' && pages.length ? (
          <>
            <Field id="section-copy-page" label="Page">
              <select
                autoFocus
                value={targetId}
                disabled={pending || done}
                onChange={event => chooseTarget(event.target.value)}
              >
                <option value="">Choose a page</option>
                {pages.map(page => (
                  <option key={page.id} value={page.id}>
                    {page.title}
                  </option>
                ))}
              </select>
            </Field>
            {target && (
              <>
                <Field id="section-copy-place" label="Where on that page">
                  <select value={at} disabled={pending || done} onChange={event => setAt(event.target.value)}>
                    <option value="">Choose a place</option>
                    {target.sections.map((section, index) => (
                      <option key={index} value={index}>
                        Before {section.label}
                      </option>
                    ))}
                    <option value={target.sections.length}>At the end</option>
                  </select>
                </Field>
                {at !== '' && (
                  <ol
                    className={siteSummaryStyles.rowList + ' ' + reviewWorkbenchStyles.panel}
                    aria-label="Copy placement"
                  >
                    {target.sections.map((section, index) => (
                      <li key={index}>
                        {Number(at) === index && <strong>This section goes here: </strong>}
                        {section.label}
                      </li>
                    ))}
                    {Number(at) === target.sections.length && (
                      <li>
                        <strong>This section goes here</strong>
                      </li>
                    )}
                  </ol>
                )}
              </>
            )}
          </>
        ) : kind === 'copy' && !error ? (
          <EmptyState title="No other pages yet">
            Create an ordinary page on this site, then return to copy the section.
          </EmptyState>
        ) : null}
        {error && (
          <div role="alert">
            <p>{error}</p>
            {!pending && !done && (
              <Button variant="secondary" onClick={retryStep}>
                Reload this step
              </Button>
            )}
          </div>
        )}
        {notice && !pending && <p role="status">{notice}</p>}
        {pending && (
          <p role="status">
            {kind === 'link'
              ? 'Saving the link name and its affected drafts…'
              : 'Copying the section into the chosen draft…'}
          </p>
        )}
        {copied && (
          <TextLink href={'/pages/' + copied.pageId} target="_blank" rel="noopener">
            Open {copied.title}
          </TextLink>
        )}
        {done && kind === 'link' && (
          <TextLink href={'/sites/' + siteId + '/publishing'} target="_blank" rel="noopener">
            Review changed drafts in Publish
          </TextLink>
        )}
      </div>
      {!done && (
        <div className={styles.addBelow}>
          <div className={workspaceFormsStyles.actions}>
            <Button variant="secondary" disabled={pending} onClick={cancel}>
              Cancel
            </Button>
            <Button disabled={!valid || pending || loading} onClick={() => void save()}>
              {pending ? 'Saving…' : kind === 'link' ? 'Save' : 'Copy section'}
            </Button>
          </div>
        </div>
      )}
    </aside>
  )
}
