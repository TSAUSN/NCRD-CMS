'use client'
import { CanvasMenuAdd, type CanvasMenuAddState } from './canvas-menu-add.tsx'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  DEFAULT_HEADER_CONFIG,
  DEFAULT_FOOTER_CONFIG,
  type HeaderConfig as Header,
  type FooterConfig as Footer,
} from '@cms/schema'
import type { MediaAsset } from '../lib/media-library.ts'
import { canAppendMenuItem, menuHasPage, menuPageIds } from '../lib/menu-editing.ts'
import { PresetFrameFields } from './preset-frame-fields.tsx'
import { FrameField } from '../app/sites/[siteId]/global-elements/frame-component-panel.tsx'
import { MenuTreeEditor } from './menu-tree-editor.tsx'
import { usePageSiteLookDraft, type SiteLookDraftChange } from './use-page-site-look-draft.ts'
import { Button } from './ui/index.ts'
import styles from './site-look-panel.module.css'
import settings from './settings-controls.module.css'
export function SiteLookPanel({
  pageId,
  part,
  editing,
  media,
  menuEdit,
  menuMove,
  frame,
  canvasReady,
  scale,
  onEdit,
  onDone,
  onSaved,
  registerDone,
  onDraftChange,
  onCanvasMenu,
  canvasMenuPage,
}: {
  onCanvasMenu?: (state: CanvasMenuAddState | null) => void
  canvasMenuPage?: { id: string; sequence: number } | null
  onDraftChange?: SiteLookDraftChange
  frame: RefObject<HTMLIFrameElement | null>
  canvasReady: number
  scale: number
  pageId: string
  part: 'header' | 'footer'
  editing: boolean
  media: MediaAsset[]
  menuEdit: { path: string; label: string; sequence: number } | null
  menuMove: { from: string; to: string; sequence: number } | null
  onEdit: () => void
  onDone: () => void
  onSaved: () => void
  registerDone: (finish: () => void) => void
}) {
  const {
    loaded,
    header,
    setHeader,
    footer,
    setFooter,
    menu,
    setMenu,
    error,
    pending,
    serial,
    dirty,
    valid,
    validationMessage,
    save,
  } = usePageSiteLookDraft({ pageId, editing, menuEdit, menuMove, onDone, onSaved, registerDone, onDraftChange })
  const fieldArea = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const area = fieldArea.current
    if (!area) return
    const keepFocus = () => {
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || !area.contains(active) || !active.matches('input,textarea,select')) return
      const field = active.getBoundingClientRect()
      const box = area.getBoundingClientRect()
      if (field.top < box.top || field.bottom > box.bottom)
        area.scrollTop += field.top + field.height / 2 - box.top - area.clientHeight / 2
    }
    const observer = new ResizeObserver(keepFocus)
    observer.observe(area)
    area.addEventListener('focusin', keepFocus)
    return () => {
      observer.disconnect()
      area.removeEventListener('focusin', keepFocus)
    }
  }, [Boolean(loaded), editing, part])
  useEffect(() => {
    if (canvasMenuPage && editing && part === 'header') addPage(canvasMenuPage.id)
  }, [canvasMenuPage, editing, part])
  const [menuHost, setMenuHost] = useState<Element | null>(null)
  useEffect(() => {
    setMenuHost(
      !onCanvasMenu && editing && part === 'header' && canvasReady > 0
        ? (frame.current?.contentDocument?.querySelector('[data-cms-frame="header"]') ?? null)
        : null,
    )
  }, [frame, editing, part, canvasReady, onCanvasMenu])
  const original = loaded?.frame.originalDesign === true
  const scopePages =
    loaded?.frame.pages.filter(page => (part === 'header' ? page.usesHeader !== false : page.usesFooter !== false)) ??
    []
  const otherPages =
    loaded?.frame.pages.filter(page => (part === 'header' ? page.usesHeader === false : page.usesFooter === false)) ??
    []
  const title = part === 'header' ? (original ? 'Menu' : 'Header') : 'Footer'
  const config = part === 'header' ? header : footer
  const fields =
    config?.schemaVersion === 2
      ? loaded?.frame.components
          .find(component => component.id === config.component.section_def_id)
          ?.versions.find(version => version.version === config.component.section_def_version)?.slots
      : []
  function addPage(id: string) {
    const page = loaded?.menu.pages.find(page => page.id === id)
    if (page && canAppendMenuItem(menu) && !menuHasPage(menu, page.id))
      setMenu(current => [
        ...current,
        { label: page.title.slice(0, 80), target: { type: 'page', page_id: page.id }, visible: true },
      ])
  }
  const available = useMemo(() => {
    const included = menuPageIds(menu)
    return loaded?.menu.pages.filter(page => !included.has(page.id)) ?? []
  }, [loaded, menu])
  const fieldMedia = useMemo(
    () =>
      media.map(asset => ({
        id: asset.id,
        name: asset.name,
        url: asset.previewUrl ?? '',
        alt: asset.altText,
      })),
    [media],
  )
  const presetMedia = useMemo(
    () =>
      media
        .filter(asset => asset.status === 'ready')
        .map(asset => ({
          id: asset.id,
          name: asset.name,
          url: asset.previewUrl ?? asset.deliveryUrl ?? '',
          alt: asset.altText,
        })),
    [media],
  )
  useEffect(() => {
    onCanvasMenu?.(
      editing && part === 'header' && loaded?.canManage
        ? {
            scale,
            disabled: pending || !canAppendMenuItem(menu),
            options: available.map(page => ({ id: page.id, title: page.title })),
          }
        : null,
    )
  }, [onCanvasMenu, editing, part, Boolean(loaded), serial, pending, scale, canvasReady])
  useEffect(() => () => onCanvasMenu?.(null), [onCanvasMenu])
  return (
    <>
      <aside className={styles.panel + ' ' + settings.controls} aria-label="Site-wide settings">
        {!editing && <h2>{title}</h2>}
        {error && (
          <p role="alert" className="error-inline">
            {error}
          </p>
        )}
        {!loaded && !error && <p role="status">Loading site look…</p>}
        {loaded && header && footer && (
          <>
            <div className={styles.banner}>
              <strong>
                {title} —{' '}
                {loaded.canManage
                  ? (original ? 'on ' : 'on all ') + scopePages.length + (scopePages.length === 1 ? ' page' : ' pages')
                  : 'across this site'}
                .
              </strong>
              {!editing && <p>Changes appear on the listed pages when you publish.</p>}
            </div>
            {!editing || !loaded.canManage ? (
              loaded.canManage ? (
                <Button onClick={onEdit}>Edit {part}</Button>
              ) : (
                <p>An editor can change this site-wide area.</p>
              )
            ) : (
              <div className={styles.form}>
                <div className={styles.fields} ref={fieldArea}>
                  {config?.schemaVersion === 2 ? (
                    fields
                      ?.filter(
                        slot => slot.kind !== 'navigation' && !(original && part === 'header' && slot.kind === 'image'),
                      )
                      .map(slot => (
                        <FrameField
                          key={slot.id}
                          slot={slot}
                          value={config.component.values[slot.id]}
                          media={fieldMedia}
                          disabled={pending}
                          siteId={loaded.siteId}
                          onChange={value => {
                            const next = {
                              ...config,
                              component: {
                                ...config.component,
                                values: { ...config.component.values, [slot.id]: value },
                              },
                            }
                            if (part === 'header') setHeader(next as Header)
                            else setFooter(next as Footer)
                          }}
                        />
                      ))
                  ) : (
                    <PresetFrameFields
                      siteId={loaded.siteId}
                      compact
                      part={part}
                      header={header.schemaVersion === 1 ? header : DEFAULT_HEADER_CONFIG}
                      footer={footer.schemaVersion === 1 ? footer : DEFAULT_FOOTER_CONFIG}
                      canManage={!pending && loaded.canManage}
                      superAdmin={loaded.superAdmin}
                      media={presetMedia}
                      pages={loaded.menu.pages}
                      siteName={
                        header.schemaVersion === 1
                          ? header.brand.siteName
                          : footer.schemaVersion === 1
                            ? footer.brand.siteName
                            : ''
                      }
                      onHeader={setHeader}
                      onFooter={setFooter}
                    />
                  )}
                  {part === 'header' &&
                    (header.schemaVersion === 1 || fields?.some(slot => slot.kind === 'navigation')) && (
                      <MenuTreeEditor
                        dropdownGroupsOnly={original}
                        canvasEditing={canvasReady > 0}
                        tree={menu}
                        pages={loaded.menu.pages}
                        disabled={pending}
                        onChange={setMenu}
                      />
                    )}
                  {original && otherPages.length > 0 && (
                    <details>
                      <summary>Other page {part === 'header' ? 'menus and links' : 'footers'}</summary>
                      <p>These pages keep their own original content. Open a page to edit it.</p>
                      <ul>
                        {otherPages.map(page => (
                          <li key={page.id}>
                            <a href={'/pages/' + page.id + (part === 'header' ? '?section=0' : '')}>{page.title}</a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                <div className={styles.save}>
                  {!valid && <p role="alert">{validationMessage}</p>}
                  <Button disabled={!dirty || !valid} loading={pending} onClick={() => void save()}>
                    Save site-wide draft
                  </Button>
                  <p className="hint">
                    {dirty
                      ? 'Changes have not been saved yet.'
                      : original
                        ? 'Saved as menu & footer changes.'
                        : 'Saved as Site look changes.'}{' '}
                    {original ? 'Review them in Publish when ready.' : 'Publish Site look when ready.'}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </aside>
      {menuHost &&
        loaded &&
        createPortal(
          <CanvasMenuAdd
            scale={scale}
            disabled={pending || !canAppendMenuItem(menu)}
            options={available}
            onAdd={addPage}
          />,
          menuHost,
        )}
    </>
  )
}
