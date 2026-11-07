'use client'
import { useReorderableList } from '../../../../components/ui/use-reorderable-list.ts'
import { flatReorderIntent } from '../../../../components/ui/flat-reorder.ts'
import { DropIndicator, ReorderAnnouncement } from '../../../../components/ui/drop-indicator.tsx'
import reorderStyles from '../../../../components/ui/reorderable-list.module.css'
import { contentCountsForPages } from '../../../../lib/content-counts.ts'
import { unpublishedChangeLabel } from '../../../../components/status.tsx'
import { useEffect, useRef, useState } from 'react'
import { FooterConfig, NavUrl, type FooterConfig as Footer, type ThemeTokens } from '@cms/schema'
import type { GlobalElementsWorkspace, NavigationWorkspace } from '../../../../lib/queries.ts'
import type { MediaAsset } from '../../../../lib/media-library.ts'
import {
  readFooterLinks,
  writeFooterLinks,
  readFooterText,
  writeFooterText,
  type FooterLink,
} from '../../../../lib/footer-links.ts'
import { carryFrameValues } from '../../../../lib/frame-field-values.ts'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Dialog,
  Disclosure,
  Field,
  Menu,
  Note,
  PageHeader,
  SegmentedControl,
  TextLink,
} from '../../../../components/ui/index.ts'
import { IconDrag, IconMore, IconPlus } from '../../../../components/icons.tsx'
import { SiteHeaderPreview, type FramePreviewTicket } from '../../../../components/site-header-preview.tsx'
import { SiteFramePreview } from '../../../../components/site-frame-preview.tsx'
import { MediaPicker } from '../../../pages/[pageId]/media-picker.tsx'
import { RichTextField } from '../../../pages/[pageId]/rich-text-field.tsx'
import { PresetFooterCards } from '../../../../components/preset-footer-cards.tsx'
import { useSiteLookCanvas } from '../design/use-site-look-canvas.ts'
import { prepareNationalHeader } from '../header/actions.ts'
import { saveFooter } from './actions.ts'
import styles from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../../components/workspace-styles/site-summary.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import workspacePreviewStyles from '../../../../components/workspace-styles/workspace-preview.module.css'
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
type LinkStep = { index: number; snapshot: Footer; fresh: boolean }
export function FooterWorkspace({
  siteId,
  siteName,
  initial,
  navigation,
  theme,
  media,
  superAdmin,
  origin,
}: {
  siteId: string
  siteName: string
  initial: GlobalElementsWorkspace
  navigation: NavigationWorkspace
  theme: ThemeTokens
  media: MediaAsset[]
  superAdmin: boolean
  origin: string | null
}) {
  const [footer, setFooter] = useState<Footer>(() => structuredClone(initial.footer.draft)),
    [components, setComponents] = useState(initial.components),
    [revisions, setRevisions] = useState({
      headerRevision: initial.header.revision,
      footerRevision: initial.footer.revision,
    }),
    [saved, setSaved] = useState(JSON.stringify(initial.footer.draft))
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [picker, setPicker] = useState(false),
    [previewOpen, setPreviewOpen] = useState(false),
    [retry, setRetry] = useState(0),
    [previewTicket, setPreviewTicket] = useState<FramePreviewTicket | null>(null),
    [editing, setEditing] = useState<LinkStep | null>(null),
    [linkDraft, setLinkDraft] = useState<FooterLink>({ label: '', url: '' }),
    [removing, setRemoving] = useState<number | null>(null),
    [query, setQuery] = useState(''),
    [linkKind, setLinkKind] = useState('url')
  const busy = useRef(false),
    serial = JSON.stringify(footer),
    dirty = serial !== saved,
    config = footer.schemaVersion === 2 ? footer.component : null,
    component = config ? components.find(item => item.id === config.section_def_id) : null,
    pin = component?.versions.find(version => version.version === config?.section_def_version),
    latest = component?.versions.at(-1),
    fields = pin?.slots ?? [],
    values = config?.values ?? {}
  const logoSlot = fields.find(slot => slot.kind === 'image' && slot.constraints?.siteLogo === true),
    inherits = logoSlot?.constraints?.inheritHeaderLogo === true && !Object.hasOwn(values, logoSlot.id),
    logo = record(logoSlot ? values[logoSlot.id] : null),
    links = readFooterLinks(values.links),
    logoProblem =
      logoSlot && !inherits && (!logo.src || !String(logo.alt ?? '').trim())
        ? 'Choose a logo and add its description.'
        : '',
    valid = FooterConfig.safeParse(footer).success && !logoProblem
  const page = initial.pages.find(page => page.published) ?? initial.pages[0],
    canvas = useSiteLookCanvas({
      purpose: 'frame',
      origin,
      siteId,
      pageId: page?.id ?? '',
      versionId: page?.versionId ?? '',
      look: valid ? { tokens: theme, header: initial.header.draft, footer, menu: navigation.draft } : null,
      retry,
    })
  useEffect(() => {
    if (canvas.ticket) setPreviewTicket(canvas.ticket)
  }, [canvas.ticket])
  useNavigationGuard(() => ({
    dirty: dirty || Boolean(editing),
    pending: pending || busy.current,
    draft: {
      label: 'Footer',
      saveDraft: save,
      discard: () => {
        setFooter(JSON.parse(saved))
        setEditing(null)
        setError('')
      },
    },
  }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || pending || editing) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending, editing])
  function value(id: string, next: unknown) {
    if (footer.schemaVersion === 2)
      setFooter({ ...footer, component: { ...footer.component, values: { ...values, [id]: next } } })
  }
  function useHeader() {
    if (footer.schemaVersion !== 2 || !logoSlot) return
    const next = { ...values }
    delete next[logoSlot.id]
    setFooter({ ...footer, component: { ...footer.component, values: next } })
  }
  function upgrade() {
    if (footer.schemaVersion !== 2 || !pin || !latest) return
    setFooter({
      ...footer,
      component: {
        ...footer.component,
        section_def_version: latest.version,
        values: carryFrameValues(values, latest.slots, pin.slots),
      },
    })
    setNotice('Updated footer controls are in this draft. Check the preview, then save.')
  }
  async function prepare() {
    if (busy.current || dirty) return
    busy.current = true
    setPending(true)
    setError('')
    try {
      const result = await prepareNationalHeader(siteId)
      if (!result.ok) setError('The footer update could not be prepared. Your saved choices are safe. Try again.')
      else {
        setComponents(result.components)
        setNotice('The updated footer is ready to preview. No site has changed.')
      }
    } catch {
      setError('The update could not be confirmed. Reload before trying again.')
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  async function save() {
    if (busy.current) return { ok: false, message: 'Wait for the current save to finish.' }
    if (editing)
      return {
        ok: false,
        message: 'Finish the footer link with Done, or Cancel it, before saving. Keep editing to return to it.',
      }
    if (!valid) return { ok: false, message: logoProblem || 'Check the footer fields before saving.' }
    if (!dirty) return { ok: true }
    busy.current = true
    setPending(true)
    setError('')
    setNotice('')
    try {
      const result = await saveFooter({ siteId, ...revisions, footer })
      if (!result.ok) {
        setError(result.message)
        return { ok: false, message: result.message }
      } else {
        setRevisions(result)
        setSaved(serial)
        setNotice(result.message)
        return { ok: true }
      }
    } catch {
      const message = 'The save could not be confirmed. Your work is still here. Reload to compare before trying again.'
      setError(message)
      return { ok: false, message }
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  function begin(index: number) {
    setEditing({ index, snapshot: structuredClone(footer), fresh: index === (links?.length ?? 0) })
    setLinkDraft(links?.[index] ?? { label: '', url: '' })
    setLinkKind('url')
    setQuery('')
  }
  function close(cancel: boolean) {
    if (cancel && editing) setFooter(editing.snapshot)
    setEditing(null)
  }
  const linkValid = Boolean(
    linkDraft.label.trim() && linkDraft.label.length <= 120 && NavUrl.safeParse(linkDraft.url).success,
  )
  function changeLink(next: FooterLink) {
    setLinkDraft(next)
    if (!editing || !links) return
    const updated = [...links]
    updated[editing.index] = next
    if (next.label.trim() && NavUrl.safeParse(next.url).success) value('links', writeFooterLinks(updated))
  }
  const reorder = useReorderableList({
    mimeType: 'application/x-cms-footer',
    decide: point =>
      flatReorderIntent(
        (links ?? []).map((_, index) => String(index)),
        point,
      ),
    apply: ({ from, to }) => move(from, to),
  })
  function move(from: number, to: number) {
    if (!links || from === to || to < 0 || to >= links.length) return
    const next = [...links],
      item = next.splice(from, 1)[0]!
    next.splice(to, 0, item)
    value('links', writeFooterLinks(next))
    return `Moved ${item.label} to position ${to + 1}.`
  }
  function moveByKeyboard(from: number, to: number) {
    const message = move(from, to)
    if (message) reorder.announce(message)
  }
  function textField(id: string, label: string) {
    const slot = fields.find(field => field.id === id)
    if (!slot) return null
    return (
      <Field key={id} id={'footer-' + id} label={label}>
        {slot.kind === 'richtext' && readFooterText(values[id]) !== null ? (
          <textarea
            rows={4}
            value={readFooterText(values[id]) ?? ''}
            disabled={pending}
            onChange={event => value(id, writeFooterText(event.target.value))}
          />
        ) : slot.kind === 'richtext' ? (
          <RichTextField
            sourceMode={false}
            id={'footer-' + id}
            labelId={'footer-' + id + '-label'}
            value={String(values[id] ?? '')}
            disabled={pending}
            onChange={next => value(id, next)}
          />
        ) : (
          <input
            value={String(values[id] ?? '')}
            maxLength={500}
            disabled={pending}
            onChange={event => value(id, event.target.value)}
          />
        )}
      </Field>
    )
  }
  const changed = JSON.stringify(footer) !== JSON.stringify(initial.footer.published),
    preview = (
      <SiteFramePreview
        part="footer"
        ticket={canvas.ticket}
        valid={valid}
        loading={canvas.loading}
        error={canvas.error}
        pageAvailable={Boolean(page)}
        previewAvailable={Boolean(origin)}
        previouslyOpened={Boolean(previewTicket)}
        retry={() => setRetry(value => value + 1)}
      />
    )
  return (
    <div className={styles.denseStack + ' ' + styles.singleColumn}>
      <PageHeader
        stacked
        density="compact"
        showWayfinding={false}
        title="Footer"
        sub={`Shown across ${initial.contentSummary ?? contentCountsForPages(initial.pages)} on ${siteName}. Editing a page never changes this.`}
        actions={
          <>
            <Badge tone={dirty || changed ? 'pending' : 'live'}>
              {dirty ? 'Unsaved changes' : changed ? unpublishedChangeLabel(1) : 'Live'}
            </Badge>
            <Button
              variant="secondary"
              disabled={!canvas.ticket || !valid || pending || canvas.loading}
              onClick={() => setPreviewOpen(true)}
            >
              Preview
            </Button>
            <Button
              variant="secondary"
              loading={pending}
              disabled={!dirty || !valid || Boolean(editing)}
              onClick={() => void save()}
            >
              Save draft
            </Button>
            <ButtonLink
              variant="publish"
              href={'/sites/' + siteId + '/publishing?area=footer'}
              aria-disabled={dirty || pending || Boolean(editing)}
              onClick={event => {
                if (dirty || pending || editing) event.preventDefault()
              }}
            >
              Publish…
            </ButtonLink>
          </>
        }
      />
      {error && (
        <p role="alert" className="error-inline">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {dirty && <p className="muted">Save this draft before reviewing it in Publish.</p>}
      <p className="hint">
        Social accounts are managed in{' '}
        <TextLink href={'/sites/' + siteId + '/settings/social'}>Settings · Social accounts</TextLink>.
      </p>
      {preview}

      {footer.schemaVersion === 2 ? (
        <div className={styles.threeColumns}>
          <Card title="Logo and name" density="editor">
            <p className="hint">Uses the header's logo unless you choose another.</p>
            {logoSlot ? (
              <>
                {!inherits && logo.src && (
                  <img
                    className={workspacePreviewStyles.assetThumb}
                    src={media.find(asset => asset.id === logo.media_id)?.previewUrl ?? String(logo.src)}
                    alt={String(logo.alt ?? '')}
                  />
                )}
                <div className={workspaceFormsStyles.actions}>
                  <Button variant="secondary" disabled={pending} onClick={() => setPicker(true)}>
                    {inherits ? 'Use a different logo' : 'Replace logo'}
                  </Button>
                  {!inherits && logoSlot.constraints?.inheritHeaderLogo === true && (
                    <Button variant="tertiary" disabled={pending} onClick={useHeader}>
                      Use the header's logo
                    </Button>
                  )}
                </div>
                {!inherits && (
                  <Field id="footer-logo-description" label="Description (for screen readers)" required>
                    <input
                      value={String(logo.alt ?? '')}
                      maxLength={300}
                      disabled={pending}
                      onChange={event => value(logoSlot.id, { ...logo, alt: event.target.value, decorative: false })}
                    />
                  </Field>
                )}
                {logoProblem && <p role="alert">{logoProblem}</p>}
              </>
            ) : (
              <>
                <p>
                  The current footer keeps its original logo. Preview the updated national footer to choose another.
                </p>
              </>
            )}
            {superAdmin &&
              component?.slug === 'national-footer' &&
              !latest?.slots.some(slot => slot.constraints?.inheritHeaderLogo === true) && (
                <Button variant="secondary" disabled={pending || dirty} onClick={() => void prepare()}>
                  Prepare updated footer
                </Button>
              )}
            <Disclosure title="Words beside the logo">
              <div className={listInspectorStyles.formStack}>
                {textField('name', 'Site name')}
                {textField('tagline', 'Small line')}
              </div>
            </Disclosure>
          </Card>
          <Card title="Text" density="editor">
            {textField('mission', 'Mission statement')}
            <Disclosure title="More footer text">
              <div className={listInspectorStyles.formStack}>
                {textField('mission_heading', 'Mission heading')}
                {textField('address', 'Address')}
                {textField('disclaimer', 'Disclaimer')}
                {textField('base', 'Legal text')}
              </div>
            </Disclosure>
          </Card>
          <Card
            title="Links"
            density="editor"
            headerActions={
              <Button
                variant="secondary"
                disabled={pending || links === null || links.length >= 50}
                onClick={() => begin(links!.length)}
              >
                <IconPlus size={16} />
                Add
              </Button>
            }
          >
            {links === null ? (
              <div className={listInspectorStyles.formStack}>
                <Note>
                  These links include extra formatting. Edit the existing text here to keep every word and link.
                </Note>
                {textField('links', 'Footer links')}
              </div>
            ) : links.length ? (
              <ul className={siteSummaryStyles.rowList + ' ' + reorderStyles.list} data-reorder-list>
                {links.map((link, index) => (
                  <li key={index} className={listInspectorStyles.menuRow} {...reorder.row(String(index), pending)}>
                    <DropIndicator marker={reorder.marker} row={String(index)} />
                    {(reorder.blocked ?? reorder.rejection)?.row === String(index) && (
                      <span className={reorderStyles.reason} aria-hidden="true">
                        {(reorder.blocked ?? reorder.rejection)?.message}
                      </span>
                    )}
                    <IconDrag size={10} />
                    <span className={listInspectorStyles.itemLabel} title={link.label}>
                      {link.label}
                    </span>
                    <Menu label={<IconMore size={16} />} accessibleLabel={'Actions for ' + link.label}>
                      <Button variant="tertiary" onClick={() => begin(index)}>
                        Edit link
                      </Button>
                      <Button
                        variant="tertiary"
                        disabled={pending || index === 0}
                        onClick={() => moveByKeyboard(index, index - 1)}
                      >
                        Move up
                      </Button>
                      <Button
                        variant="tertiary"
                        disabled={pending || index === links.length - 1}
                        onClick={() => moveByKeyboard(index, index + 1)}
                      >
                        Move down
                      </Button>
                      <Button variant="tertiary" disabled={pending} onClick={() => setRemoving(index)}>
                        Remove link
                      </Button>
                    </Menu>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={recordTableStyles.emptyRow}>No footer links yet. Add a page or website.</p>
            )}
            <ReorderAnnouncement>{reorder.announcement}</ReorderAnnouncement>
          </Card>
        </div>
      ) : (
        <PresetFooterCards
          footer={footer}
          canManage={!pending}
          superAdmin={false}
          pages={navigation.pages}
          siteName={siteName}
          onChange={setFooter}
        />
      )}
      {latest && pin && latest.version > pin.version && (
        <Note>
          The template has updated footer controls. Your current words and links stay in place.{' '}
          <Button variant="secondary" disabled={pending} onClick={upgrade}>
            Preview updated footer
          </Button>
        </Note>
      )}
      {picker && logoSlot && (
        <MediaPicker
          siteId={siteId}
          mode="placement"
          confirmLabel="Use this logo"
          initialAssets={media}
          currentValue={logo}
          onChoose={image => {
            value(logoSlot.id, { ...image, decorative: false })
            setPicker(false)
          }}
          onClose={() => setPicker(false)}
        />
      )}
      {editing && (
        <Dialog
          size="medium"
          density="compact"
          title={editing.fresh ? 'Add footer link' : 'Edit footer link'}
          onClose={() => close(true)}
          footer={
            <>
              <Button variant="secondary" onClick={() => close(true)}>
                Cancel
              </Button>
              <Button
                disabled={!linkValid}
                onClick={() => {
                  changeLink(linkDraft)
                  close(false)
                }}
              >
                Done
              </Button>
            </>
          }
        >
          <div className={listInspectorStyles.formStack}>
            <SegmentedControl
              label="What would you like to add?"
              appearance="pills"
              size="s"
              value={linkKind}
              onChange={setLinkKind}
              options={[
                { value: 'url', label: 'A website' },
                { value: 'page', label: 'A page on this site' },
              ]}
            />
            <Field id="footer-link-name" label="Link label" required>
              <input
                autoFocus
                maxLength={120}
                value={linkDraft.label}
                onChange={event => changeLink({ ...linkDraft, label: event.target.value })}
              />
            </Field>
            {linkKind === 'url' ? (
              <Field id="footer-link-url" label="Web address" required>
                <input
                  maxLength={2048}
                  value={linkDraft.url}
                  onChange={event => changeLink({ ...linkDraft, url: event.target.value })}
                />
              </Field>
            ) : (
              <>
                <Field id="footer-link-search" label="Find a page">
                  <input type="search" value={query} onChange={event => setQuery(event.target.value)} />
                </Field>
                <Field id="footer-link-page" label="Page" required>
                  <select
                    value={navigation.pages.find(page => page.path === linkDraft.url)?.id ?? ''}
                    onChange={event => {
                      const page = navigation.pages.find(page => page.id === event.target.value)
                      if (page) changeLink({ label: linkDraft.label || page.title.slice(0, 120), url: page.path })
                    }}
                  >
                    <option value="">Choose a page…</option>
                    {navigation.pages
                      .filter(page => (page.title + ' ' + page.path).toLowerCase().includes(query.toLowerCase()))
                      .map(page => (
                        <option key={page.id} value={page.id}>
                          {page.title}
                          {page.published ? '' : ' · draft'}
                        </option>
                      ))}
                  </select>
                </Field>
              </>
            )}
          </div>
        </Dialog>
      )}
      {removing !== null && links && (
        <Dialog
          density="compact"
          title="Remove footer link?"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  value('links', writeFooterLinks(links.filter((_, index) => index !== removing)))
                  setRemoving(null)
                }}
              >
                Remove link
              </Button>
            </>
          }
        >
          <p>Remove “{links[removing]?.label}” from this footer draft? Its page stays available.</p>
        </Dialog>
      )}
      {previewOpen && canvas.ticket && (
        <Dialog
          size="large"
          title="Preview footer"
          onClose={() => setPreviewOpen(false)}
          footer={<Button onClick={() => setPreviewOpen(false)}>Done</Button>}
        >
          <SiteHeaderPreview part="footer" channel={canvas.ticket.channel} href={canvas.ticket.href} expanded />
        </Dialog>
      )}
    </div>
  )
}
