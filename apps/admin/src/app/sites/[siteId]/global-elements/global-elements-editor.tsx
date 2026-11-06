'use client'
import { contentCountsForPages } from '../../../../lib/content-counts.ts'

import { PresetFrameFields } from '../../../../components/preset-frame-fields.tsx'
import { ScriptlessPreview } from '../../../../components/scriptless-preview.tsx'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  sourceSampleValues,
  DEFAULT_FOOTER_CONFIG,
  DEFAULT_HEADER_CONFIG,
  type FooterConfig,
  type HeaderConfig,
} from '@cms/schema'
import type { FrameComponentChoice } from '../../../../lib/queries.ts'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { queueFramePreview, requestFramePreview } from '../../../../lib/frame-preview-request.ts'
import { sitePreviewLabel, type SitePreviewContext } from '../../../../lib/preview-context.ts'
import { FrameComponentPanel } from './frame-component-panel.tsx'
import {
  IconAlert,
  IconCheck,
  IconDesktop,
  IconEye,
  IconFrame,
  IconInfo,
  IconMobile,
  IconTablet,
} from '../../../../components/icons.tsx'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import {
  publishGlobalElements,
  revertGlobalElementsToLive,
  saveGlobalElementsDraft,
} from '../../../actions/site-look.ts'
import { type GlobalElementsActionResult } from '../../../../lib/action-result.ts'

type PageChoice = { kind?: string; id: string; title: string; path: string; published: boolean; versionId: string }
type ElementHead<T> = {
  id: string
  revision: number
  draftVersionId: string
  publishedVersionId: string | null
  draft: T
  published: T
}
type InitialWorkspace = {
  contentSummary?: string
  header: ElementHead<HeaderConfig>
  footer: ElementHead<FooterConfig>
  pages: PageChoice[]
  previewPages: { title: string; versionId: string }[]
  components: FrameComponentChoice[]
}
type MediaChoice = { id: string; name: string; url: string; alt: string }
const clone = <T,>(value: T): T => structuredClone(value)
const serial = (header: HeaderConfig, footer: FooterConfig) => JSON.stringify({ header, footer })
function FrameSourceSwitch({
  kind,
  authored,
  available,
  canManage,
  onChoose,
}: {
  kind: 'header' | 'footer'
  authored: boolean
  available: boolean
  canManage: boolean
  onChoose: (authored: boolean) => void
}) {
  if (!authored && !available) return null
  return (
    <div className="frame-source" role="radiogroup" aria-label={`${kind === 'header' ? 'Header' : 'Footer'} source`}>
      <button
        type="button"
        role="radio"
        aria-checked={!authored}
        className={!authored ? 'on' : ''}
        disabled={!canManage}
        onClick={() => onChoose(false)}
      >
        Layout presets
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={authored}
        className={authored ? 'on' : ''}
        disabled={!canManage || !available}
        onClick={() => onChoose(true)}
      >
        Authored component
      </button>
    </div>
  )
}

export function GlobalElementsEditor({
  siteId,
  siteName,
  initial,
  canManage,
  superAdmin,
  media,
  initialSitePreview = 'published',
}: {
  siteId: string
  siteName: string
  initial: InitialWorkspace
  canManage: boolean
  superAdmin: boolean
  media: MediaChoice[]
  /** The menu and design around the frame: saved drafts or what is live. As in
   * the page editor, a site with nothing live starts on its saved drafts. */
  initialSitePreview?: SitePreviewContext
}) {
  const router = useRouter()
  const [header, setHeader] = useState<HeaderConfig>(() => clone(initial.header.draft))
  const [footer, setFooter] = useState<FooterConfig>(() => clone(initial.footer.draft))
  const actionInFlight = useRef(false)
  const sourceDrafts = useRef<{
    header: Partial<Record<1 | 2, HeaderConfig>>
    footer: Partial<Record<1 | 2, FooterConfig>>
  }>({ header: {}, footer: {} })
  const [publishedHeader, setPublishedHeader] = useState(() => clone(initial.header.published))
  const [publishedFooter, setPublishedFooter] = useState(() => clone(initial.footer.published))
  const [saved, setSaved] = useState(() => serial(initial.header.draft, initial.footer.draft))
  const [headerRevision, setHeaderRevision] = useState(initial.header.revision)
  const [footerRevision, setFooterRevision] = useState(initial.footer.revision)
  const [active, setActive] = useState<'header' | 'footer'>('header')
  // The preview is scaled to the space it has, and shows the part being edited:
  // the top of the page for the header, the bottom for the footer.
  const stage = useRef<HTMLDivElement>(null)
  const [stageWidth, setStageWidth] = useState(0)
  const [notice, setNotice] = useState<GlobalElementsActionResult | null>(null)
  const [confirming, setConfirming] = useState<'publish' | 'revert' | null>(null)
  const [previewVersion, setPreviewVersion] = useState(initial.previewPages[0]?.versionId ?? '')
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'tablet' | 'phone'>('desktop')
  const [sitePreview, setSitePreview] = useState<SitePreviewContext>(initialSitePreview)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [previewLoading, setPreviewLoading] = useState(initial.previewPages.length > 0)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    sourceDrafts.current = { header: {}, footer: {} }
    setHeader(clone(initial.header.draft))
    setFooter(clone(initial.footer.draft))
    setPublishedHeader(clone(initial.header.published))
    setPublishedFooter(clone(initial.footer.published))
    setSaved(serial(initial.header.draft, initial.footer.draft))
    setHeaderRevision(initial.header.revision)
    setFooterRevision(initial.footer.revision)
  }, [
    initial.header.revision,
    initial.footer.revision,
    initial.header.draftVersionId,
    initial.footer.draftVersionId,
    initial.header.publishedVersionId,
    initial.footer.publishedVersionId,
  ])

  const currentSerial = serial(header, footer)
  const dirty = currentSerial !== saved
  useNavigationGuard(() => ({ dirty, pending: pending || actionInFlight.current }))
  const hasLiveVersion = initial.header.publishedVersionId !== null && initial.footer.publishedVersionId !== null
  const draftIsLive = hasLiveVersion && currentSerial === serial(publishedHeader, publishedFooter) && !dirty

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (dirty || pending || actionInFlight.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending])

  useEffect(() => {
    if (!previewVersion) return
    setPreviewLoading(true)
    setPreviewError('')
    setPreviewHtml('')
    return queueFramePreview(async signal => {
      const result = await requestFramePreview(
        `/api/sites/${siteId}/global-elements/preview`,
        { versionId: previewVersion, header, footer, previewContext: sitePreview },
        signal,
      )
      if (signal.aborted || result.kind === 'aborted') return
      if (result.kind === 'ready') setPreviewHtml(result.html)
      else setPreviewError(result.message)
      setPreviewLoading(false)
    })
  }, [previewVersion, currentSerial, siteId, previewAttempt, sitePreview])

  /** Keep each source's local work while comparing them; only the selected source is saved. */
  function chooseSource(kind: 'header' | 'footer', authored: boolean) {
    if (actionInFlight.current) return
    const targetVersion = authored ? 2 : 1
    const first = initial.components.find(component => component.placement === kind && component.status === 'active')
    const version = first?.versions.at(-1)
    if (kind === 'header') {
      if (header.schemaVersion === targetVersion) return
      sourceDrafts.current.header[header.schemaVersion] = clone(header)
      const previous = sourceDrafts.current.header[targetVersion]
      if (previous) setHeader(clone(previous))
      else if (authored && first && version)
        setHeader({
          schemaVersion: 2,
          enabled: header.enabled,
          sticky: header.sticky,
          component: {
            section_def_id: first.id,
            section_def_version: version.version,
            values: sourceSampleValues(version.slots),
          },
        })
      else if (!authored)
        setHeader({
          ...clone(DEFAULT_HEADER_CONFIG),
          enabled: header.enabled,
          sticky: header.sticky,
          brand: { ...DEFAULT_HEADER_CONFIG.brand, siteName },
        })
    } else {
      if (footer.schemaVersion === targetVersion) return
      sourceDrafts.current.footer[footer.schemaVersion] = clone(footer)
      const previous = sourceDrafts.current.footer[targetVersion]
      if (previous) setFooter(clone(previous))
      else if (authored && first && version)
        setFooter({
          schemaVersion: 2,
          enabled: footer.enabled,
          component: {
            section_def_id: first.id,
            section_def_version: version.version,
            values: sourceSampleValues(version.slots),
          },
        })
      else if (!authored)
        setFooter({
          ...clone(DEFAULT_FOOTER_CONFIG),
          enabled: footer.enabled,
          brand: { ...DEFAULT_FOOTER_CONFIG.brand, siteName },
        })
    }
  }

  function act(kind: 'save' | 'publish' | 'revert') {
    if (actionInFlight.current || !canManage) return
    actionInFlight.current = true
    setNotice(null)
    const data = new FormData()
    data.set('siteId', siteId)
    data.set('headerRevision', String(headerRevision))
    data.set('footerRevision', String(footerRevision))
    data.set('header', JSON.stringify(header))
    data.set('footer', JSON.stringify(footer))
    startTransition(async () => {
      try {
        const result =
          kind === 'save'
            ? await saveGlobalElementsDraft(data)
            : kind === 'publish'
              ? await publishGlobalElements(data)
              : await revertGlobalElementsToLive(data)
        setNotice(result)
        setConfirming(null)
        if (result.ok) {
          setHeaderRevision(result.headerRevision)
          setFooterRevision(result.footerRevision)
          if (kind === 'save') setSaved(serial(header, footer))
          else if (kind === 'publish') {
            setPublishedHeader(clone(header))
            setPublishedFooter(clone(footer))
            router.refresh()
          } else {
            setHeader(clone(publishedHeader))
            setFooter(clone(publishedFooter))
            setSaved(serial(publishedHeader, publishedFooter))
            router.refresh()
          }
        }
      } catch {
        setNotice({
          ok: false,
          kind: 'error',
          message:
            'The result could not be confirmed. Your edits are still here, but the server may have completed the request. Reload and check the saved and live state before trying again.',
        })
        setConfirming(null)
      } finally {
        actionInFlight.current = false
      }
    })
  }

  useEffect(() => {
    const node = stage.current
    if (!node) return
    const observer = new ResizeObserver(() => setStageWidth(node.clientWidth))
    observer.observe(node)
    return () => observer.disconnect()
  }, [previewVersion])
  const frameWidth = { desktop: 1280, tablet: 768, phone: 390 }[previewWidth]
  const frameScale =
    stageWidth > 0 ? Math.min((stageWidth - 24) / frameWidth, previewWidth === 'phone' ? 1.2 : 1) : null
  useEffect(() => {
    showFrameArea(stage.current?.querySelector('iframe') ?? null, active, frameScale)
  }, [active, previewHtml, frameScale])

  return (
    <div className="global-elements-workspace">
      {!canManage && (
        <p className="notice" role="note">
          <IconEye size={16} />
          <span className="notice-body">
            You can inspect the site frame. An editor or site administrator can change it.
          </span>
        </p>
      )}
      {notice && (
        <p className={`notice ${notice.ok ? 'notice-ok' : 'notice-error'}`} role={notice.ok ? 'status' : 'alert'}>
          {notice.ok ? <IconCheck size={16} /> : <IconAlert size={16} />}
          <span className="notice-body">{notice.message}</span>
          {!notice.ok && notice.kind === 'conflict' && (
            <button type="button" className="small secondary" onClick={() => window.location.reload()}>
              Reload
            </button>
          )}
        </p>
      )}

      <section className="global-commandbar" aria-label="Header and footer publishing status">
        <div>
          <span className={`nav-live-dot ${draftIsLive ? 'is-live' : ''}`} aria-hidden="true" />
          <span>
            <strong>
              {!hasLiveVersion
                ? 'Not published yet'
                : draftIsLive
                  ? 'Matches the live site'
                  : 'Saved changes are not live yet'}
            </strong>
            <small>{dirty ? 'Save before publishing.' : 'Your changes are saved.'}</small>
          </span>
        </div>
        {canManage && (
          <div className="actions">
            <button
              type="button"
              className="ghost"
              disabled={!hasLiveVersion || dirty || draftIsLive || pending}
              onClick={() => setConfirming('revert')}
            >
              Revert to live
            </button>
            <button type="button" className="secondary" disabled={!dirty || pending} onClick={() => act('save')}>
              {pending ? 'Working…' : 'Save draft'}
            </button>
            <button
              type="button"
              className="cta"
              disabled={dirty || draftIsLive || pending}
              onClick={() => setConfirming('publish')}
            >
              Publish header &amp; footer
            </button>
          </div>
        )}
      </section>

      <div className="global-ownership" role="note">
        <IconInfo size={17} />
        <div>
          <strong>Edited elsewhere</strong>
          <span>
            Menu items are in <a href={`/sites/${siteId}/navigation`}>Navigation</a>, colours and buttons in{' '}
            <a href={`/sites/${siteId}/design`}>Design</a>, and logo files in{' '}
            <a href={`/sites/${siteId}/media`}>Media</a>.
          </span>
        </div>
      </div>

      <div className="global-grid">
        <fieldset
          className="global-controls"
          aria-label="Header and footer fields"
          disabled={pending}
          aria-busy={pending}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <div className="global-tabs" role="tablist" aria-label="Site-wide elements">
            <button
              type="button"
              role="tab"
              aria-selected={active === 'header'}
              className={active === 'header' ? 'on' : ''}
              onClick={() => setActive('header')}
            >
              <IconFrame size={17} />
              Header
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={active === 'footer'}
              className={active === 'footer' ? 'on' : ''}
              onClick={() => setActive('footer')}
            >
              <IconFrame size={17} />
              Footer
            </button>
          </div>

          <FrameSourceSwitch
            kind={active}
            authored={(active === 'header' ? header : footer).schemaVersion === 2}
            available={initial.components.some(
              component => component.placement === active && component.status === 'active',
            )}
            canManage={canManage && !pending}
            onChoose={authored => chooseSource(active, authored)}
          />

          {active === 'header' ? (
            header.schemaVersion === 2 ? (
              <FrameComponentPanel
                kind="header"
                config={header}
                components={initial.components}
                media={media}
                pageCount={initial.pages.length}
                pageCountLabel={initial.contentSummary ?? contentCountsForPages(initial.pages)}
                canManage={canManage && !pending}
                siteId={siteId}
                onChange={next => {
                  if (!actionInFlight.current) setHeader(next as HeaderConfig)
                }}
              />
            ) : (
              <PresetFrameFields
                siteId={siteId}
                part="header"
                siteName={siteName}
                header={header.schemaVersion === 1 ? header : DEFAULT_HEADER_CONFIG}
                footer={footer.schemaVersion === 1 ? footer : DEFAULT_FOOTER_CONFIG}
                canManage={canManage && !pending}
                superAdmin={superAdmin}
                media={media}
                pages={initial.pages}
                onHeader={next => {
                  if (!actionInFlight.current) setHeader(next)
                }}
                onFooter={next => {
                  if (!actionInFlight.current) setFooter(next)
                }}
              />
            )
          ) : footer.schemaVersion === 2 ? (
            <FrameComponentPanel
              kind="footer"
              config={footer}
              components={initial.components}
              media={media}
              pageCount={initial.pages.length}
              pageCountLabel={initial.contentSummary ?? contentCountsForPages(initial.pages)}
              canManage={canManage && !pending}
              siteId={siteId}
              onChange={next => {
                if (!actionInFlight.current) setFooter(next as FooterConfig)
              }}
            />
          ) : (
            <PresetFrameFields
              siteId={siteId}
              part="footer"
              siteName={siteName}
              header={header.schemaVersion === 1 ? header : DEFAULT_HEADER_CONFIG}
              footer={footer.schemaVersion === 1 ? footer : DEFAULT_FOOTER_CONFIG}
              canManage={canManage && !pending}
              superAdmin={superAdmin}
              media={media}
              pages={initial.pages}
              onHeader={next => {
                if (!actionInFlight.current) setHeader(next)
              }}
              onFooter={next => {
                if (!actionInFlight.current) setFooter(next)
              }}
            />
          )}
        </fieldset>

        <aside className="global-preview" aria-label="Real page preview">
          <div className="global-preview-head">
            <div>
              <p className="eyebrow">Rendered page</p>
              <h2>Preview</h2>
            </div>
            <span>
              <IconEye size={15} />
              Draft
            </span>
          </div>
          <div className="global-preview-toolbar">
            <label htmlFor="global-preview-page">Page</label>
            <select
              id="global-preview-page"
              value={previewVersion}
              onChange={event => setPreviewVersion(event.target.value)}
            >
              {initial.previewPages.map(page => (
                <option value={page.versionId} key={page.versionId}>
                  {page.title}
                </option>
              ))}
            </select>
            <label htmlFor="global-preview-site">Site design</label>
            <select
              id="global-preview-site"
              value={sitePreview}
              onChange={event => setSitePreview(event.target.value === 'draft' ? 'draft' : 'published')}
            >
              <option value="draft">{sitePreviewLabel('draft')}</option>
              <option value="published">{sitePreviewLabel('published')}</option>
            </select>
            <div className="global-preview-widths" aria-label="Preview width">
              {(
                [
                  ['desktop', 'Desktop', IconDesktop],
                  ['tablet', 'Tablet', IconTablet],
                  ['phone', 'Phone', IconMobile],
                ] as const
              ).map(([width, label, Mark]) => (
                <button
                  type="button"
                  className={previewWidth === width ? 'on' : ''}
                  aria-pressed={previewWidth === width}
                  key={width}
                  onClick={() => setPreviewWidth(width)}
                >
                  <Mark size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          {previewVersion ? (
            <div
              ref={stage}
              className={`global-real-preview is-${previewWidth} ${previewLoading ? 'is-loading' : ''}`}
              style={frameScale ? { ['--frame-scale' as string]: String(frameScale) } : undefined}
            >
              {previewError ? (
                <div className="notice notice-error" role="alert">
                  <span>{previewError}</span>
                  <button
                    type="button"
                    className="small secondary"
                    onClick={() => setPreviewAttempt(value => value + 1)}
                  >
                    Retry preview
                  </button>
                </div>
              ) : (
                <ScriptlessPreview
                  title={`${siteName} header and footer preview`}
                  srcDoc={previewHtml}
                  onLoad={event => showFrameArea(event.currentTarget, active, frameScale)}
                />
              )}
              <span>
                {previewLoading ? 'Rendering…' : previewError ? 'Preview unavailable' : `${previewWidth} preview`}
              </span>
            </div>
          ) : (
            <div className="global-preview-empty">
              <IconFrame size={24} />
              <strong>Create a page to preview the frame</strong>
              <span>The editor will render actual page content here.</span>
            </div>
          )}
          <p className="global-preview-note">
            <IconInfo size={15} />
            The public renderer is used here, with this{' '}
            {sitePreview === 'draft' ? 'site’s saved menu and design' : 'site’s live menu and design'} around the header
            and footer you are editing. Page content and media are not mocked.
          </p>
        </aside>
      </div>

      {confirming === 'publish' && (
        <ConfirmDialog
          title="Publish the site frame?"
          what="The saved header and footer draft will go live together on every published page."
          reassurance="Page content, navigation and design settings are not changed. You can create another draft afterward."
          confirmLabel="Publish header & footer"
          pending={pending}
          tone="primary"
          onConfirm={() => act('publish')}
          onCancel={() => {
            if (!actionInFlight.current) setConfirming(null)
          }}
        />
      )}
      {confirming === 'revert' && (
        <ConfirmDialog
          title="Revert the draft to live?"
          what="Both header and footer drafts will be replaced by fresh copies of what visitors currently see."
          reassurance="The live site is not changed. Draft-only edits cannot be recovered after this action."
          confirmLabel="Revert both drafts"
          pending={pending}
          onConfirm={() => act('revert')}
          onCancel={() => {
            if (!actionInFlight.current) setConfirming(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Bring the frame being edited into the preview: the page top for the header,
 * the footer for the footer. The preview's own window scrolls first; when the
 * page is shorter than the frame there is nothing to scroll, so the scaled
 * frame is also moved up within its box until the footer shows.
 */
function showFrameArea(frame: HTMLIFrameElement | null, area: 'header' | 'footer', scale: number | null) {
  const view = frame?.contentWindow,
    doc = frame?.contentDocument,
    box = frame?.parentElement
  if (!frame || !view || !doc || !box) return
  const footer = area === 'footer' ? doc.querySelector('footer') : null
  view.scrollTo({
    top: footer ? Math.max(0, footer.getBoundingClientRect().top + view.scrollY - 24) : 0,
    behavior: 'instant',
  })
  const factor = scale ?? (frame.getBoundingClientRect().width / frame.offsetWidth || 1)
  const remaining = footer ? Math.max(0, footer.getBoundingClientRect().top - 24) * factor : 0
  const room = Math.max(0, frame.offsetHeight * factor + 16 - box.clientHeight)
  frame.style.setProperty('--frame-offset', `${Math.round(Math.min(remaining, room))}px`)
}
