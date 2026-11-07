'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import type { SectionToolSource, SectionLinkReview } from '../../../lib/section-tools-commands.ts'
import { validSectionAnchor } from '@cms/schema'
import { Button, Field, EmptyState, Disclosure, TextLink } from '../../../components/ui/index.ts'
import { IconChevronLeft } from '../../../components/icons.tsx'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../components/navigation-guard.ts'
import {
  loadSectionLink,
  loadSectionCopyChoices,
  saveSectionCopy,
  type saveSectionLink,
} from './section-tools-actions.ts'
import workspaceFormsStyles from '../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../components/workspace-styles/site-summary.module.css'
import listInspectorStyles from '../../../components/workspace-styles/list-inspector.module.css'
import reviewWorkbenchStyles from '../../../components/workspace-styles/review-workbench.module.css'
import styles from './inspector.module.css'
type CopyPage = { id: string; title: string; revision: string; sections: { label: string }[] }
export function SectionToolsPanel({
  kind,
  source,
  origin,
  siteId,
  onClose,
  onRename,
}: {
  kind: 'link' | 'copy'
  source: SectionToolSource | null
  origin: string | null
  siteId: string
  onClose: (reload?: boolean) => void
  onRename: (
    input: SectionToolSource & { name: string; fingerprint: string },
  ) => Promise<Awaited<ReturnType<typeof saveSectionLink>>>
}) {
  const [review, setReview] = useState<SectionLinkReview | null>(null),
    [pages, setPages] = useState<CopyPage[]>([]),
    [name, setName] = useState(''),
    [targetId, setTargetId] = useState(''),
    [at, setAt] = useState(''),
    [loading, setLoading] = useState(true),
    [actionPending, setPending] = useState(false),
    [transitionPending, startTransition] = useTransition(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [retry, setRetry] = useState(0),
    [copied, setCopied] = useState<{ pageId: string; title: string } | null>(null),
    [done, setDone] = useState(false),
    busy = useRef(false),
    applied = useRef(false),
    touched = useRef(false),
    nameInput = useRef<HTMLInputElement>(null),
    addressInput = useRef<HTMLInputElement>(null),
    reloadSource = useRef(false)
  const pending = actionPending || transitionPending
  const target = pages.find(page => page.id === targetId),
    dirty = !done && (kind === 'link' ? Boolean(review && name !== review.name) : Boolean(targetId)),
    valid =
      kind === 'link'
        ? Boolean(review && !review.unsafe && validSectionAnchor(name))
        : Boolean(
            target &&
            at !== '' &&
            Number.isInteger(Number(at)) &&
            Number(at) >= 0 &&
            Number(at) <= target.sections.length,
          ),
    address = review ? (origin ?? '') + review.path + '#' + name : ''
  useEffect(() => {
    let active = true
    if (!source) return
    setLoading(true)
    setError('')
    setNotice('')
    const request = kind === 'link' ? loadSectionLink(source) : loadSectionCopyChoices(source)
    void request
      .then(result => {
        if (!active) return
        if (!result.ok) {
          if (result.kind === 'conflict') reloadSource.current = true
          setError(result.message)
          return
        }
        if ('fingerprint' in result) {
          setReview(result)
          if (!touched.current) setName(result.name || result.suggested)
        } else {
          setPages(result.pages)
          setAt('')
        }
      })
      .catch(() => {
        if (active) setError('This section step could not be loaded. Try again, or return to the section.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [source, kind, retry])
  function save(): Promise<{ ok: boolean; message?: string }> {
    return new Promise(resolve =>
      startTransition(async () => {
        resolve(await performSave())
      }),
    )
  }
  async function performSave() {
    if (done || applied.current) return { ok: true }
    if (!source || busy.current) return { ok: false, message: 'Wait for this section step to finish.' }
    if (!valid) {
      const message =
        kind === 'link'
          ? 'Use a unique link name starting with a letter, with lowercase letters, numbers and hyphens.'
          : 'Choose a page and a place for the copy.'
      setError(message)
      return { ok: false, message }
    }
    busy.current = true
    setPending(true)
    setError('')
    try {
      if (kind === 'link') {
        const result = await onRename({ ...source, name, fingerprint: review!.fingerprint })
        if (!result.ok) {
          if (result.kind === 'conflict') reloadSource.current = true
          setError(result.message)
          return { ok: false, message: result.message }
        }
        applied.current = true
        setDone(true)
        setNotice(result.message)
        return { ok: true }
      }
      const result = await saveSectionCopy({
        ...source,
        targetPageId: target!.id,
        targetRevision: target!.revision,
        at: Number(at),
      })
      if (!result.ok) {
        if (result.kind === 'conflict') reloadSource.current = true
        setError(result.message)
        return { ok: false, message: result.message }
      }
      applied.current = true
      setCopied({ pageId: result.pageId, title: result.title })
      setDone(true)
      setNotice(result.message)
      return { ok: true }
    } catch {
      const message = 'The result could not be confirmed. Check the affected page drafts before trying again.'
      setError(message)
      return { ok: false, message }
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  const read = () => ({
    dirty: dirty && !applied.current,
    pending: pending || busy.current,
    draft: {
      label: kind === 'link' ? 'Section link name' : 'Section copy',
      saved: false,
      saveDraft: save,
      discard: () => {
        setName(review?.name ?? '')
        setTargetId('')
        setAt('')
      },
    },
  })
  useNavigationGuard(read)
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if ((dirty && !applied.current) || busy.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  function close() {
    const leave = () => onClose(reloadSource.current || (kind === 'link' && applied.current))
    if (requestLocalDraftNavigation(read, leave)) leave()
  }
  async function copyLink() {
    if (!address || (name !== review?.name && !done)) return
    try {
      await navigator.clipboard.writeText(address)
      setNotice('Section link copied. Publish any changes before sharing it.')
    } catch {
      addressInput.current?.focus()
      addressInput.current?.select()
      setError('The link could not be copied automatically. Select the link address and copy it.')
    }
  }
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
                ref={nameInput}
                maxLength={64}
                disabled={pending || done}
                value={name}
                onChange={event => {
                  touched.current = true
                  setName(event.target.value.toLowerCase())
                }}
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
                onChange={event => {
                  setTargetId(event.target.value)
                  setAt('')
                }}
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
              <Button variant="secondary" onClick={() => setRetry(value => value + 1)}>
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
            <Button variant="secondary" disabled={pending} onClick={() => onClose(reloadSource.current)}>
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
