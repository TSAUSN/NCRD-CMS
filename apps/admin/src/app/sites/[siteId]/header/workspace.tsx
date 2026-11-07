'use client'
import { contentCountsForPages } from '../../../../lib/content-counts.ts'
import { unpublishedChangeLabel } from '../../../../components/status.tsx'
import { useEffect, useRef, useState } from 'react'
import {
  HeaderConfig,
  HeaderDraftConfig,
  NavTree,
  validTrackingCode,
  type HeaderConfig as Header,
  type ThemeTokens,
  type SlotDef,
} from '@cms/schema'
import type { GlobalElementsWorkspace, NavigationWorkspace } from '../../../../lib/queries.ts'
import type { MediaAsset } from '../../../../lib/media-library.ts'
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
  Note,
  PageHeader,
  SegmentedControl,
  Tabs,
} from '../../../../components/ui/index.ts'
import { LinkDestinationPicker } from '../../../../components/link-settings.tsx'
import { validHeaderButtonUrl } from '../../../../lib/header-button-link.ts'
import { CompactMenuEditor } from '../../../../components/compact-menu-editor.tsx'
import { SiteHeaderPreview, type FramePreviewTicket } from '../../../../components/site-header-preview.tsx'
import { SiteFramePreview } from '../../../../components/site-frame-preview.tsx'
import { SiteLogoField } from '../../../../components/site-logo-field.tsx'
import { MediaPicker } from '../../../pages/[pageId]/media-picker.tsx'
import { FrameField } from '../global-elements/frame-component-panel.tsx'
import { PresetFrameFields } from '../../../../components/preset-frame-fields.tsx'
import { DEFAULT_FOOTER_CONFIG } from '@cms/schema'
import { useSiteLookCanvas } from '../design/use-site-look-canvas.ts'
import { prepareNationalHeader, saveHeaderMenu } from './actions.ts'
import styles from '../../../../components/workspace.module.css'
import buttonStyles from './header-buttons.module.css'
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
export function HeaderMenuWorkspace({
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
  const [header, setHeader] = useState<Header>(() => structuredClone(initial.header.draft)),
    [tree, setTree] = useState<NavTree>(() => structuredClone(navigation.draft)),
    [mode, setMode] = useState(navigation.mode),
    [tab, setTab] = useState('menu'),
    [components, setComponents] = useState(initial.components)
  const [revisions, setRevisions] = useState({
      headerRevision: initial.header.revision,
      footerRevision: initial.footer.revision,
      menuRevision: navigation.revision,
    }),
    [saved, setSaved] = useState(JSON.stringify([initial.header.draft, navigation.draft, navigation.mode]))
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [itemEditing, setItemEditing] = useState(false),
    [picker, setPicker] = useState(false),
    [previewOpen, setPreviewOpen] = useState(false),
    [retry, setRetry] = useState(0),
    [previewTicket, setPreviewTicket] = useState<FramePreviewTicket | null>(null),
    [logoFailed, setLogoFailed] = useState<string | null>(null)
  const busy = useRef(false),
    serial = JSON.stringify([header, tree, mode]),
    dirty = serial !== saved
  const config = header.schemaVersion === 2 ? header.component : null,
    component = config ? components.find(item => item.id === config.section_def_id) : null,
    pin = component?.versions.find(version => version.version === config?.section_def_version),
    latest = component?.versions.at(-1),
    fields = pin?.slots ?? []
  const values = config?.values ?? {},
    logo = record(values.logo),
    logoSlot = fields.find(slot => slot.constraints?.siteLogo === true),
    buttons = fields.filter(slot => slot.kind === 'button'),
    otherFields = fields.filter(
      slot => !['logo', 'menu', 'name', 'tagline'].includes(slot.id) && slot.kind !== 'button',
    )
  const logoUrl = media.find(asset => asset.id === logo.media_id)?.previewUrl ?? String(logo.src ?? ''),
    shield = '/cms-themes/sawso/salvation-army-shield.svg'
  const logoProblem =
    header.schemaVersion === 1 && (header.brand.logoMediaId || header.brand.compactLogoMediaId)
      ? !header.brand.siteName.trim()
        ? 'Add the site name to describe this logo.'
        : !header.brand.logoDescription?.trim()
          ? 'Add a description for the logo.'
          : ''
      : logoSlot && (!logo.src || !String(logo.alt ?? '').trim())
        ? 'Choose a logo and add its description.'
        : ''
  const buttonProblem = buttons.find(slot => {
    const value = record(values[slot.id])
    if (slot.id === 'secondary' && !Object.hasOwn(values, slot.id)) return false
    return (
      !String(value.label ?? '').trim() ||
      !validHeaderButtonUrl(value.url) ||
      !validTrackingCode(String(value.trackingCode ?? ''))
    )
  })
  const legacyDescriptionAbsent = header.schemaVersion === 1 && !Object.hasOwn(header.brand, 'logoDescription')
  const valid =
    HeaderConfig.safeParse(header).success &&
    NavTree.safeParse(tree).success &&
    (!logoProblem || legacyDescriptionAbsent) &&
    !buttonProblem
  const saveValid = valid && !logoProblem && HeaderDraftConfig.safeParse(header).success
  const page = initial.pages.find(page => page.published) ?? initial.pages[0]
  const canvas = useSiteLookCanvas({
    purpose: 'frame',
    origin,
    siteId,
    pageId: page?.id ?? '',
    versionId: page?.versionId ?? '',
    look: valid ? { tokens: theme, header, footer: initial.footer.draft, menu: tree } : null,
    retry,
  })
  useEffect(() => {
    if (canvas.ticket) setPreviewTicket(canvas.ticket)
  }, [canvas.ticket])
  useNavigationGuard(() => ({
    dirty,
    pending: pending || busy.current,
    draft: {
      label: 'Header & menu',
      saveDraft: save,
      discard: () => {
        const [savedHeader, savedTree, savedMode] = JSON.parse(saved)
        setHeader(savedHeader)
        setTree(savedTree)
        setMode(savedMode)
        setError('')
      },
    },
  }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || pending) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending])
  function value(id: string, value: unknown) {
    if (header.schemaVersion !== 2) return
    setHeader({ ...header, component: { ...header.component, values: { ...values, [id]: value } } })
  }
  function upgrade() {
    if (header.schemaVersion !== 2 || !pin || !latest) return
    setHeader({
      ...header,
      component: {
        ...header.component,
        section_def_version: latest.version,
        values: carryFrameValues(values, latest.slots, pin.slots),
      },
    })
    setNotice('Updated header controls are in this draft. Check the preview, then save.')
  }
  async function prepare() {
    if (busy.current || dirty) return
    busy.current = true
    setPending(true)
    setError('')
    try {
      const result = await prepareNationalHeader(siteId)
      if (!result.ok) setError(result.message)
      else {
        setComponents(result.components)
        setNotice('The updated header is ready to preview. No site has changed.')
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
    if (itemEditing)
      return {
        ok: false,
        message: 'Finish the menu item with Done, or Cancel it, before saving. Keep editing to return to it.',
      }
    if (!saveValid)
      return {
        ok: false,
        message:
          logoProblem ||
          (buttonProblem
            ? 'Check the button text, destination and tracking code before saving.'
            : 'Check the header and menu fields before saving.'),
      }
    if (!dirty) return { ok: true }
    busy.current = true
    setPending(true)
    setError('')
    setNotice('')
    try {
      const result = await saveHeaderMenu({ siteId, ...revisions, header, menu: tree, mode })
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
  const changes =
    (JSON.stringify(header) !== JSON.stringify(initial.header.published) ? 1 : 0) +
    (JSON.stringify(tree) !== JSON.stringify(navigation.published) ? 1 : 0)
  const preview = (
    <SiteFramePreview
      part="header"
      ticket={canvas.ticket}
      valid={valid}
      loading={canvas.loading}
      error={canvas.error}
      pageAvailable={Boolean(page)}
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
        title="Header & menu"
        sub={`Shown across ${initial.contentSummary ?? contentCountsForPages(initial.pages)} on ${siteName}. Changes wait for you to publish.`}
        actions={
          <>
            <Badge tone={dirty || changes ? 'pending' : 'live'}>
              {dirty ? 'Unsaved changes' : changes ? unpublishedChangeLabel(changes) : 'Live'}
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
              disabled={!dirty || !saveValid || itemEditing}
              onClick={() => void save()}
            >
              Save draft
            </Button>
            <ButtonLink
              variant="publish"
              href={'/sites/' + siteId + '/publishing?area=header-menu'}
              aria-disabled={dirty || pending || itemEditing}
              onClick={event => {
                if (dirty || pending || itemEditing) event.preventDefault()
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
      {dirty && logoProblem && tab !== 'logo' && <p role="alert">Add a logo description in Logo before saving.</p>}
      <Tabs
        label="Header settings"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'menu', label: 'Menu' },
          { value: 'logo', label: 'Logo' },
          { value: 'buttons', label: 'Header buttons' },
        ]}
      >
        <div className={styles.formStack + ' ' + styles.singleColumn}>
          {preview}

          {!valid && previewTicket && <p role="status">Complete the fields to show your changes in the preview.</p>}
          {tab === 'menu' && (
            <>
              <CompactMenuEditor
                tree={tree}
                pages={navigation.pages}
                disabled={pending}
                onChange={setTree}
                onEditing={setItemEditing}
              />
              <Card density="editor">
                <div className={styles.betweenRow}>
                  <div>
                    <strong>When a new page goes live</strong>
                    <p className="muted">Hiding or removing a menu item never deletes its page.</p>
                  </div>
                  <SegmentedControl
                    appearance="pills"
                    label="When a new page goes live"
                    value={mode}
                    onChange={value => setMode(value as 'auto' | 'manual')}
                    options={[
                      { value: 'auto', label: 'Add it to the menu automatically', disabled: pending },
                      { value: 'manual', label: 'Let me choose', disabled: pending },
                    ]}
                  />
                </div>
              </Card>
            </>
          )}
          {tab === 'logo' && (
            <div className={styles.equalColumns} data-align="stretch">
              <Card title="Logo" density="editor">
                {logoSlot ? (
                  <>
                    <div className={styles.assetChoice}>
                      {logo.src && logoFailed !== logoUrl ? (
                        <img
                          className={styles.assetThumb}
                          src={logoUrl}
                          alt={String(logo.alt ?? '')}
                          onError={() => setLogoFailed(logoUrl)}
                        />
                      ) : (
                        <p className="muted" role="status">
                          Logo preview unavailable. Use Replace to choose an image.
                        </p>
                      )}
                      <div className={styles.formStack}>
                        <p className="muted">PNG at least 400px wide. Transparent background works best.</p>
                        <div className={styles.actions}>
                          <Button variant="secondary" disabled={pending} onClick={() => setPicker(true)}>
                            Replace
                          </Button>
                          {logo.src !== shield && (
                            <Button
                              variant="tertiary"
                              disabled={pending}
                              onClick={() =>
                                value('logo', { src: shield, alt: 'The Salvation Army', decorative: false })
                              }
                            >
                              Use the Salvation Army shield
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                    <Field id="header-logo-description" label="Description (for screen readers)" required>
                      <input
                        value={String(logo.alt ?? '')}
                        maxLength={300}
                        disabled={pending}
                        onChange={event => value('logo', { ...logo, alt: event.target.value, decorative: false })}
                      />
                    </Field>
                    <Field id="header-logo-home" label="Clicking the logo goes to">
                      <input value="Home page" readOnly />
                    </Field>
                    {logoProblem && <p role="alert">{logoProblem}</p>}
                  </>
                ) : header.schemaVersion === 1 ? (
                  <div className={styles.formStack}>
                    <SiteLogoField
                      siteId={siteId}
                      siteName={header.brand.siteName}
                      compact={false}
                      fallback={header.brand.compactLogoMediaId ? 'compact' : 'name'}
                      value={header.brand.logoMediaId}
                      choices={media.map(asset => ({
                        id: asset.id,
                        name: asset.name,
                        url: asset.previewUrl ?? asset.deliveryUrl ?? '',
                        alt: asset.altText,
                      }))}
                      disabled={pending}
                      onChange={id =>
                        setHeader(current =>
                          current.schemaVersion === 1
                            ? { ...current, brand: { ...current.brand, logoMediaId: id } }
                            : current,
                        )
                      }
                    />
                    {(header.brand.logoMediaId || header.brand.compactLogoMediaId) && (
                      <Field id="header-logo-description" label="Description (for screen readers)" required>
                        <input
                          value={header.brand.logoDescription ?? ''}
                          maxLength={300}
                          disabled={pending}
                          onChange={event =>
                            setHeader(current =>
                              current.schemaVersion === 1
                                ? { ...current, brand: { ...current.brand, logoDescription: event.target.value } }
                                : current,
                            )
                          }
                        />
                      </Field>
                    )}
                    <Disclosure title="A different logo on phones">
                      <SiteLogoField
                        siteId={siteId}
                        siteName={header.brand.siteName}
                        compact
                        fallback={header.brand.logoMediaId ? 'full' : 'name'}
                        value={header.brand.compactLogoMediaId}
                        choices={media.map(asset => ({
                          id: asset.id,
                          name: asset.name,
                          url: asset.previewUrl ?? asset.deliveryUrl ?? '',
                          alt: asset.altText,
                        }))}
                        disabled={pending}
                        onChange={id =>
                          setHeader(current =>
                            current.schemaVersion === 1
                              ? { ...current, brand: { ...current.brand, compactLogoMediaId: id } }
                              : current,
                          )
                        }
                      />
                    </Disclosure>
                    {logoProblem && <p role="alert">{logoProblem}</p>}
                  </div>
                ) : (
                  <>
                    <p>
                      This saved header uses its original logo. A Super admin can prepare the national header controls,
                      then preview them here.
                    </p>
                    {superAdmin &&
                      component?.slug === 'national-header' &&
                      (!latest || latest.version === pin?.version) && (
                        <Button variant="secondary" disabled={pending || dirty} onClick={() => void prepare()}>
                          Prepare updated header
                        </Button>
                      )}
                  </>
                )}
              </Card>
              <Card title="Words beside the logo" density="editor">
                {header.schemaVersion === 2 ? (
                  fields
                    .filter(slot => ['name', 'tagline'].includes(slot.id))
                    .map(slot => (
                      <Field
                        key={slot.id}
                        id={'header-' + slot.id}
                        label={slot.id === 'name' ? 'Site name' : 'Small line'}
                      >
                        <input
                          value={String(values[slot.id] ?? '')}
                          maxLength={200}
                          disabled={pending}
                          onChange={event => value(slot.id, event.target.value)}
                        />
                      </Field>
                    ))
                ) : header.schemaVersion === 1 ? (
                  <div className={styles.formStack}>
                    <Field id="header-site-name" label="Site name" required>
                      <input
                        value={header.brand.siteName}
                        maxLength={120}
                        disabled={pending}
                        onChange={event =>
                          setHeader(current =>
                            current.schemaVersion === 1
                              ? { ...current, brand: { ...current.brand, siteName: event.target.value } }
                              : current,
                          )
                        }
                      />
                    </Field>
                    <label className={styles.toggleRow}>
                      <span>Show site name beside the logo</span>
                      <input
                        type="checkbox"
                        checked={header.brand.showName}
                        disabled={pending}
                        onChange={event =>
                          setHeader(current =>
                            current.schemaVersion === 1
                              ? { ...current, brand: { ...current.brand, showName: event.target.checked } }
                              : current,
                          )
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <p>
                    This header's existing identity controls are available in Site look until its national template is
                    applied.
                  </p>
                )}
                <Note>
                  {header.schemaVersion === 1
                    ? 'The colours and font are managed in Site look.'
                    : "The colours, font and header shape come from the national template, so they can't drift from the other sites."}
                </Note>
              </Card>
            </div>
          )}
          {tab === 'buttons' && (
            <>
              {header.schemaVersion === 2 ? (
                <div
                  className={styles.equalColumns + ' ' + buttonStyles.buttons}
                  data-align="controls"
                  data-secondary={Object.hasOwn(values, 'secondary') ? 'on' : 'off'}
                >
                  {buttons.map(slot => {
                    const current = record(values[slot.id]),
                      optional = slot.id === 'secondary',
                      enabled = !optional || Object.hasOwn(values, slot.id)
                    return (
                      <Card
                        key={slot.id}
                        title={optional ? 'Second button' : 'Donate button'}
                        density="editor"
                        headerActions={
                          optional ? (
                            <label className={styles.toggleRow}>
                              <span className={styles.visuallyHidden}>Show second button</span>
                              <input
                                type="checkbox"
                                checked={enabled}
                                disabled={pending}
                                onChange={event => {
                                  if (event.target.checked) value(slot.id, { label: '', url: '' })
                                  else {
                                    const next = { ...values }
                                    delete next[slot.id]
                                    setHeader({ ...header, component: { ...header.component, values: next } })
                                  }
                                }}
                              />
                            </label>
                          ) : undefined
                        }
                      >
                        {enabled ? (
                          <>
                            <Field id={'header-' + slot.id + '-label'} label="Label" required>
                              <input
                                value={String(current.label ?? '')}
                                disabled={pending}
                                maxLength={120}
                                onChange={event => value(slot.id, { ...current, label: event.target.value })}
                              />
                            </Field>
                            <LinkDestinationPicker
                              header
                              id={'header-' + slot.id}
                              value={current}
                              targets={navigation.pages.filter(page => page.published)}
                              disabled={pending}
                              onChange={next => value(slot.id, next)}
                            />
                            <Field
                              id={'header-' + slot.id + '-tracking'}
                              label="Tracking code"
                              helpAfter
                              help={
                                /^(mailto|tel):/i.test(String(current.url ?? ''))
                                  ? "Email and phone links don't use tracking codes."
                                  : "Added to the link automatically. Every page's header uses this button."
                              }
                              error={
                                !validTrackingCode(String(current.trackingCode ?? ''))
                                  ? 'Use parameters such as utm_source=site, or leave this empty.'
                                  : undefined
                              }
                            >
                              <input
                                value={String(current.trackingCode ?? '')}
                                disabled={pending}
                                maxLength={1000}
                                onChange={event => value(slot.id, { ...current, trackingCode: event.target.value })}
                              />
                            </Field>
                          </>
                        ) : (
                          <p className="muted">Optional, for example Find help. Off for this site.</p>
                        )}
                      </Card>
                    )
                  })}
                </div>
              ) : (
                <PresetFrameFields
                  identityControls={false}
                  siteId={siteId}
                  part="header"
                  header={header}
                  footer={initial.footer.draft.schemaVersion === 1 ? initial.footer.draft : DEFAULT_FOOTER_CONFIG}
                  canManage={!pending}
                  superAdmin={false}
                  media={media.map(asset => ({
                    id: asset.id,
                    name: asset.name,
                    url: asset.previewUrl ?? '',
                    alt: asset.altText,
                  }))}
                  pages={navigation.pages}
                  siteName={siteName}
                  onHeader={setHeader}
                  onFooter={() => {}}
                />
              )}
              {buttonProblem && (
                <p role="alert">
                  Add button text, a valid destination and a valid tracking code for {buttonProblem.label}.
                </p>
              )}
            </>
          )}
          {tab !== 'menu' && latest && pin && latest.version > pin.version && (
            <Note>
              The template has updated header controls. Your current words and menu stay in place.{' '}
              <Button variant="secondary" disabled={pending} onClick={upgrade}>
                Preview updated header
              </Button>
            </Note>
          )}
          {tab === 'logo' && otherFields.length > 0 && (
            <Card title="Other header text" density="editor">
              {otherFields.map((slot: SlotDef) => (
                <FrameField
                  key={slot.id}
                  slot={slot}
                  value={values[slot.id]}
                  media={[]}
                  disabled={pending}
                  siteId={siteId}
                  onChange={next => value(slot.id, next)}
                />
              ))}
            </Card>
          )}
        </div>
      </Tabs>
      {picker && (
        <MediaPicker
          siteId={siteId}
          mode="placement"
          confirmLabel="Use this logo"
          initialAssets={media}
          currentValue={logo}
          onChoose={image => {
            value('logo', { ...image, decorative: false })
            setPicker(false)
          }}
          onClose={() => setPicker(false)}
        />
      )}
      {previewOpen && canvas.ticket && (
        <Dialog
          size="large"
          title="Preview header & menu"
          onClose={() => setPreviewOpen(false)}
          footer={<Button onClick={() => setPreviewOpen(false)}>Done</Button>}
        >
          <SiteHeaderPreview channel={canvas.ticket.channel} href={canvas.ticket.href} expanded />
        </Dialog>
      )}
    </div>
  )
}
