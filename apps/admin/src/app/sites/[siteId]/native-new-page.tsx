'use client'
import { useState } from 'react'
import { CORE_PAGE_TEMPLATES } from '@cms/seeds/core-templates'
import { Button, Dialog, Field } from '../../../components/ui/index.ts'
import { IconPlus } from '../../../components/icons.tsx'
import { useNativeNewPageDraft, type NewPageSource } from './use-native-new-page-draft.ts'
import workspaceFormsStyles from '../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../components/workspace-styles/site-summary.module.css'
import selectionControlsStyles from '../../../components/workspace-styles/selection-controls.module.css'
import listInspectorStyles from '../../../components/workspace-styles/list-inspector.module.css'
import ownedStyles from './native-new-page-styles.module.css'
import styles from './native-new-page.module.css'
export function NativeNewPage({
  siteId,
  canAdmin,
  pages,
  asTask = false,
}: {
  siteId: string
  canAdmin: boolean
  pages: NewPageSource[]
  asTask?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const openDialog = () => {
    setNotice('')
    setOpen(true)
  }
  return (
    <>
      {asTask ? (
        <button type="button" className={siteSummaryStyles.task} onClick={openDialog}>
          <span className={siteSummaryStyles.taskIcon}>
            <IconPlus size={18} />
          </span>
          <strong>Add a page</strong>
        </button>
      ) : (
        <Button onClick={openDialog}>
          <IconPlus size={16} />
          New page
        </Button>
      )}
      {open && (
        <NewPageDialog
          siteId={siteId}
          canAdmin={canAdmin}
          pages={pages}
          onClose={() => setOpen(false)}
          onCreated={setNotice}
        />
      )}
      {notice && <p role="status">{notice}</p>}
    </>
  )
}
function NewPageDialog({
  siteId,
  canAdmin,
  pages,
  onClose,
  onCreated,
}: {
  siteId: string
  canAdmin: boolean
  pages: NewPageSource[]
  onClose: () => void
  onCreated: (message: string) => void
}) {
  const [changeAddress, setChangeAddress] = useState(false)
  const {
    title,
    setTitle,
    description,
    setDescription,
    address,
    setAddress,
    start,
    setStart,
    template,
    setTemplate,
    sourceId,
    setSourceId,
    url,
    setUrl,
    inMenu,
    setInMenu,
    parentId,
    setParentId,
    pending,
    error,
    unknown,
    titleInput,
    slug,
    valid,
    close,
    submit,
    checkPages,
  } = useNativeNewPageDraft({ siteId, pages, onClose, onCreated })
  return (
    <Dialog
      title="New page"
      size="large"
      onClose={close}
      pending={pending}
      initialFocus={titleInput}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button disabled={!valid || pending || unknown} onClick={() => void submit()}>
            {pending ? 'Creating draft…' : start === 'website' ? 'Add to menu draft' : 'Create draft'}
          </Button>
        </>
      }
    >
      <div className={listInspectorStyles.formStack}>
        <p className={recordTableStyles.meta}>It starts as a private draft. Nobody sees it until you publish.</p>
        <div className={styles.identity}>
          <Field id="new-page-title" label="Page title" counter={title.length + ' of 90'}>
            <input
              ref={titleInput}
              required
              maxLength={90}
              value={title}
              onChange={event => setTitle(event.target.value)}
              disabled={pending}
            />
          </Field>
          {start !== 'website' && (
            <Field id="new-page-description" label="Description for search" counter={description.length + ' of 155'}>
              <input
                maxLength={155}
                disabled={pending}
                value={description}
                onChange={event => setDescription(event.target.value)}
                placeholder="One or two plain sentences about this page"
              />
            </Field>
          )}
        </div>
        {start !== 'website' && (
          <>
            <div className={workspaceFormsStyles.actions}>
              <span>Web address: /{slug}</span>
              <Button variant="tertiary" size="s" disabled={pending} onClick={() => setChangeAddress(value => !value)}>
                Change
              </Button>
            </div>
            {changeAddress && (
              <Field
                id="new-page-address"
                label="Web address"
                error={
                  address !== null && (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
                    ? 'Use lowercase letters, numbers and hyphens — for example about-us.'
                    : undefined
                }
              >
                <input
                  value={slug}
                  maxLength={160}
                  disabled={pending}
                  onChange={event => setAddress(event.target.value)}
                />
              </Field>
            )}
          </>
        )}
        <Field id="new-page-start" label="Start from">
          <div
            className={selectionControlsStyles.choiceRows + ' ' + styles.startChoices}
            role="radiogroup"
            aria-labelledby="new-page-start-label"
          >
            {[
              ['blank', 'A blank page', 'A title and some text'],
              ['design', 'A page design', 'Sector page, news page, event and more'],
              ['copy', 'A copy of a page', 'Any page on this site'],
              ...(canAdmin
                ? [['website', 'A link to another website', 'Adds it to the menu. There is no page to edit.']]
                : []),
            ].map(([value, label, hint]) => (
              <label key={value} className={ownedStyles.rowActions}>
                <input
                  className={selectionControlsStyles.visuallyHidden}
                  type="radio"
                  name="page-start"
                  value={value}
                  checked={start === value}
                  disabled={pending}
                  onChange={() => setStart(value as typeof start)}
                />
                <span className={recordTableStyles.rowCopy}>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
              </label>
            ))}
          </div>
        </Field>
        {start === 'design' && (
          <>
            <div className={styles.designGrid} role="group" aria-label="Suggested page designs">
              {[
                {
                  id: 'landing',
                  picture: 'split-hero',
                  description: 'Hero and highlights.',
                },
                {
                  id: 'event-home',
                  picture: 'event-hero',
                  description: 'Speakers and program.',
                },
                {
                  id: 'chapter',
                  picture: 'page-header',
                  description: 'Photos and contacts.',
                },
                {
                  id: 'resources',
                  picture: 'text-block',
                  description: 'Text and useful links.',
                },
              ].map(choice => (
                <label key={choice.id} className={styles.designCard}>
                  <input
                    type="radio"
                    name="suggested-page-design"
                    checked={template === choice.id}
                    disabled={pending}
                    onChange={() => setTemplate(choice.id)}
                  />
                  <img src={'/cms-samples/sections/core-' + choice.picture + '.png'} alt="" width={640} height={256} />
                  <strong>{CORE_PAGE_TEMPLATES.find(item => item.id === choice.id)!.name}</strong>
                  <span>{choice.description}</span>
                </label>
              ))}
            </div>
            <Field
              id="new-page-design"
              label="Page design"
              help="Designed sample content uses this site’s look. Replace it before publishing."
            >
              <select value={template} disabled={pending} onChange={event => setTemplate(event.target.value)}>
                {CORE_PAGE_TEMPLATES.filter(item => item.id !== 'blank').map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        {start === 'copy' && (
          <Field id="new-page-source" label="Page to copy">
            <select value={sourceId} disabled={pending} onChange={event => setSourceId(event.target.value)}>
              <option value="">Choose a page</option>
              {pages.map(page => (
                <option key={page.id} value={page.id}>
                  {page.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        {start === 'website' && (
          <Field id="new-page-website" label="Website address">
            <input
              type="url"
              value={url}
              disabled={pending}
              onChange={event => setUrl(event.target.value)}
              placeholder="https://example.org"
            />
          </Field>
        )}
        {start !== 'website' && (
          <Field
            id="new-page-parent"
            label="Where it lives"
            help="Organizes the page on this site. The menu choice is separate."
          >
            <select value={parentId} disabled={pending} onChange={event => setParentId(event.target.value)}>
              <option value="">Main pages</option>
              {pages.map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        {canAdmin && start !== 'website' && (
          <label className={selectionControlsStyles.toggleRow}>
            <span className={recordTableStyles.rowCopy}>
              <strong>Add to the menu when it’s published</strong>
              <small>You can change this later.</small>
            </span>
            <input
              type="checkbox"
              checked={inMenu}
              disabled={pending}
              onChange={event => setInMenu(event.target.checked)}
            />
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        {unknown && (
          <Button variant="secondary" onClick={checkPages}>
            Check Pages
          </Button>
        )}
      </div>
    </Dialog>
  )
}
