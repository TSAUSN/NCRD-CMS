'use client'
import { useState, type ReactNode } from 'react'
import { safeUrl } from '@cms/renderer'
import { Button, Dialog, Disclosure, Field, SegmentedControl } from './ui/index.ts'
import type { LinkTarget } from '../lib/queries.ts'
import shared from './workspace.module.css'

type Kind = 'page' | 'website' | 'email' | 'phone'
function refusedLinkUrl(url: string, allowedKinds?: readonly Kind[]) {
  url = url.trim()
  return (
    url.trim() !== '' &&
    ((url.trim() !== '#' && safeUrl(url) === '#') ||
      Boolean(
        allowedKinds &&
        ((/^mailto:/i.test(url) && !allowedKinds.includes('email')) ||
          (/^tel:/i.test(url) && !allowedKinds.includes('phone'))),
      ))
  )
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
function kindFor(url: string, targets: LinkTarget[]): Kind {
  return /^mailto:/i.test(url)
    ? 'email'
    : /^tel:/i.test(url)
      ? 'phone'
      : targets.some(page => page.path === url.split(/[?#]/)[0])
        ? 'page'
        : 'website'
}
function choice(current: Record<string, unknown>, key: 'newTab' | 'nofollow', enabled: boolean) {
  const next = { ...current }
  if (enabled) next[key] = true
  else delete next[key]
  return next
}

/** Shared destination fields for page links and site-level header buttons. */
export function LinkDestinationPicker({
  id,
  value,
  targets,
  onChange,
  disabled = false,
  header = false,
  sectionJumps = false,
  allowedKinds,
}: {
  id: string
  value: unknown
  targets: LinkTarget[]
  onChange: (value: unknown) => void
  disabled?: boolean
  header?: boolean
  sectionJumps?: boolean
  allowedKinds?: readonly Kind[]
}) {
  const current = record(value),
    url = String(current.url ?? ''),
    target = targets.find(page => page.path === url.split(/[?#]/)[0])
  const [kind, setKind] = useState<Kind>(() => {
    const inferred = kindFor(url, targets)
    return allowedKinds?.length && (!url || !allowedKinds.includes(inferred)) ? allowedKinds[0]! : inferred
  })
  const refused = refusedLinkUrl(url, allowedKinds)
  function address(text: string) {
    if (kind === 'email') text = text.replace(/^mailto:/i, '')
    if (kind === 'phone') text = text.replace(/^tel:/i, '').replace(/\s/g, '')
    onChange({ ...current, url: text ? (kind === 'email' ? 'mailto:' : kind === 'phone' ? 'tel:' : '') + text : '' })
  }
  const visibleAddress =
    kind === 'email'
      ? /^mailto:/i.test(url)
        ? url.replace(/^mailto:/i, '')
        : ''
      : kind === 'phone'
        ? /^tel:/i.test(url)
          ? url.replace(/^tel:/i, '')
          : ''
        : url
  return (
    <div className={shared.denseStack}>
      <div>
        {header && <span className="field-label">Goes to</span>}
        <SegmentedControl
          appearance={header ? 'pills' : undefined}
          size={header ? 's' : undefined}
          label="Link destination type"
          value={kind}
          onChange={kind => setKind(kind as Kind)}
          options={[
            { value: 'page', label: header ? 'A page' : 'Page on this site', disabled },
            { value: 'website', label: header ? 'A website' : 'Website', disabled },
            { value: 'email', label: 'Email', disabled },
            { value: 'phone', label: 'Phone', disabled },
          ].filter(option => !allowedKinds || allowedKinds.includes(option.value as Kind))}
        />
      </div>
      {kind === 'page' ? (
        <Field id={id + '-page'} label="Page">
          <select
            value={target?.id ?? ''}
            disabled={disabled || !targets.length}
            onChange={event => {
              const page = targets.find(page => page.id === event.target.value)
              if (page) onChange({ ...current, url: page.path })
            }}
          >
            <option value="">Choose a published page…</option>
            {targets.map(page => (
              <option key={page.id} value={page.id}>
                {page.title} — {page.path}
              </option>
            ))}
          </select>
          <p className={shared.meta}>
            {targets.length
              ? 'Only published pages are listed. The existing destination stays until you choose one.'
              : 'No published pages are available yet. Publish a page, or choose another kind of link.'}
          </p>
          {sectionJumps && target && (
            <Field id={id + '-section'} label="Jump to a section (optional)">
              <select
                value={url.includes('#') ? url.split('#')[1] : ''}
                disabled={disabled}
                onChange={event =>
                  onChange({ ...current, url: target.path + (event.target.value ? '#' + event.target.value : '') })
                }
              >
                <option value="">Top of the page</option>
                {(target.anchors ?? []).map(anchor => (
                  <option key={anchor.id} value={anchor.id}>
                    {anchor.label}
                  </option>
                ))}
              </select>
              {url.includes('#') && !(target.anchors ?? []).some(anchor => anchor.id === url.split('#')[1]) ? (
                <p role="alert">
                  This section is no longer on the published page. Choose another section or the top of the page.
                </p>
              ) : (
                <p className={shared.meta}>
                  {url.includes('#')
                    ? 'The page scrolls to this section when someone clicks.'
                    : 'Choose a section, or keep the link to the top of the page.'}
                </p>
              )}
            </Field>
          )}
        </Field>
      ) : (
        <Field
          id={id + '-url'}
          label={
            kind === 'email' ? 'Email address' : kind === 'phone' ? 'Phone number' : header ? 'Web address' : 'Address'
          }
        >
          <input
            type="text"
            inputMode={kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : 'url'}
            value={visibleAddress}
            maxLength={2048}
            disabled={disabled}
            aria-invalid={refused || undefined}
            onChange={event => address(event.target.value)}
          />
          <p className={shared.meta}>
            {kind === 'email'
              ? 'Enter an email address.'
              : kind === 'phone'
                ? 'Include the country or area code.'
                : header
                  ? 'Use a full HTTPS website address or a path on this site.'
                  : 'Use a full website address, a path on this site, or a #link within a page.'}
          </p>
        </Field>
      )}
      {refused && (
        <p className="error-inline" role="alert">
          {allowedKinds
            ? allowedKinds.includes('page')
              ? 'This address cannot be used. Choose a published page or a full website address.'
              : 'This address cannot be used. Enter a full website or PDF address.'
            : 'This address cannot be used. Choose a page, website, email address or phone number.'}
        </p>
      )}
    </div>
  )
}

/** Ordinary link values and validation; opening this control grants no write authority. */
export function LinkSettings({
  id,
  value,
  targets,
  onChange,
  destinationOnly = false,
  summaryLabel,
  advanced,
  onEditStart,
  sectionJumps = false,
  showLinkOptions = false,
  title,
  confirmLabel = 'Done',
  allowedKinds,
  destinationLabel,
}: {
  id: string
  value: unknown
  targets: LinkTarget[]
  onChange: (value: unknown) => void
  destinationOnly?: boolean
  summaryLabel?: string
  advanced?: ReactNode
  onEditStart?: () => () => void
  sectionJumps?: boolean
  showLinkOptions?: boolean
  title?: string
  confirmLabel?: string
  allowedKinds?: readonly Kind[]
  destinationLabel?: string
}) {
  const current = record(value),
    url = String(current.url ?? ''),
    label = String(current.label ?? ''),
    target = targets.find(page => page.path === url.split(/[?#]/)[0])
  const [editing, setEditing] = useState<{ before: unknown; cancel?: () => void } | null>(null)
  const refused = refusedLinkUrl(url, allowedKinds)
  function close() {
    if (editing) {
      if (editing.cancel) editing.cancel()
      else if (JSON.stringify(value) !== JSON.stringify(editing.before)) onChange(editing.before)
    }
    setEditing(null)
  }
  return (
    <>
      <ul className={shared.panel + ' ' + shared.rowList}>
        <li>
          <div className={shared.rowCopy}>
            {summaryLabel && <strong>{summaryLabel}</strong>}
            {!destinationOnly && label && <span>{label}</span>}
            <span className={shared.meta + ' ' + shared.wrapAnywhere}>
              {destinationLabel ?? (url ? (target ? target.title + ' · ' + url : url) : 'Not linked yet')}
            </span>
          </div>
          <Button
            variant="secondary"
            size="s"
            onClick={() => setEditing({ before: structuredClone(value), cancel: onEditStart?.() })}
          >
            Change
          </Button>
        </li>
      </ul>
      {editing && (
        <Dialog
          title={title ?? 'Change link'}
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button disabled={refused} onClick={() => setEditing(null)}>
                {confirmLabel}
              </Button>
            </>
          }
        >
          <div className={shared.denseStack + ' ' + shared.compactForm}>
            {!destinationOnly && (
              <Field id={id + '-label'} label="Words people click">
                <input value={label} onChange={event => onChange({ ...current, label: event.target.value })} />
              </Field>
            )}
            <LinkDestinationPicker
              id={id}
              value={value}
              targets={targets}
              onChange={onChange}
              sectionJumps={sectionJumps}
              allowedKinds={allowedKinds}
            />
            {(!destinationOnly || showLinkOptions) && (
              <>
                <label className={shared.checkRow}>
                  <input
                    type="checkbox"
                    checked={current.newTab === true}
                    onChange={event => onChange(choice(current, 'newTab', event.target.checked))}
                  />
                  Open in a new tab
                </label>
                <label className={shared.checkRow}>
                  <input
                    type="checkbox"
                    checked={current.nofollow === true}
                    onChange={event => onChange(choice(current, 'nofollow', event.target.checked))}
                  />
                  Don’t recommend to search engines (nofollow)
                </label>
              </>
            )}
            {!destinationOnly && advanced && <Disclosure title="Advanced">{advanced}</Disclosure>}
          </div>
        </Dialog>
      )}
    </>
  )
}
