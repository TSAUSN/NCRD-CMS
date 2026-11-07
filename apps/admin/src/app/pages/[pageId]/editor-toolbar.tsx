import type { ReactNode } from 'react'
import { LargeScreenEditing } from '../../../components/content-editor.tsx'
import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import { StatusPill } from '../../../components/ui/status-pill.tsx'
import { BackLink } from '../../../components/ui/back-link.tsx'
import { ButtonLink, Button, Menu } from '../../../components/ui/index.ts'
import { IconClock, IconExternal, IconMail, IconMore, IconSettings } from '../../../components/icons.tsx'
import { RecoveryStatus } from './page-recovery-panel.tsx'
import type { usePageRecovery } from './use-page-recovery.ts'
import type { SitePreviewContext } from '../../../lib/preview-context.ts'
import foundationStyles from './editor-foundation.module.css'

type EditorToolbarProps = {
  page: {
    siteHref: string
    siteName: string
    pageId: string
    originalDesign?: boolean
    pageScoped?: boolean
    canPublish: boolean
    liveHref: string | null
    visitorPreviewOrigin?: string | null
    isolatedCanvasOrigin?: string | null
  }
  pageTitle: string
  viewTools: ReactNode
  publication: {
    submittedCurrent: boolean
    publishedVersionId: string | null
    hasWorkNotLive: boolean
    reviewId?: string
    scheduling: boolean
    reviewBusy: boolean
  }
  draft: {
    saving: boolean
    dirty: boolean
    recovery: ReturnType<typeof usePageRecovery>
    limitedHistory: boolean
    requiresReload: boolean
    checkpointing: boolean
    transitionPending: boolean
  }
  preview: {
    editingFrame?: boolean
    previewBlocked: boolean
    canManageSections: boolean
    sitePreview: SitePreviewContext
    previewHidden: boolean
    changeSitePreview: (context: SitePreviewContext) => void
    setPreviewHidden: (hidden: boolean) => void
    openVisitorPreview: () => Promise<void>
  }
  commands: {
    checkpoint: () => void
    duplicateCurrentPage: () => Promise<void>
    discardUnpublished: () => void
    openPageSettings: () => void
    schedulePageReview: () => void
    openPagePublishReview: () => void
    submitForReview: () => void
  }
}

/** The editor's navigation, draft status and page commands, in reading order. */
export function EditorToolbar({
  page: props,
  pageTitle,
  viewTools,
  publication,
  draft,
  preview,
  commands,
}: EditorToolbarProps) {
  const { submittedCurrent, publishedVersionId, hasWorkNotLive, reviewId, scheduling, reviewBusy } = publication
  const { saving, dirty, recovery, limitedHistory, requiresReload, checkpointing, transitionPending } = draft
  const {
    editingFrame,
    previewBlocked,
    canManageSections,
    sitePreview,
    previewHidden,
    changeSitePreview,
    setPreviewHidden,
    openVisitorPreview,
  } = preview
  const {
    checkpoint,
    duplicateCurrentPage,
    discardUnpublished,
    openPageSettings,
    schedulePageReview,
    openPagePublishReview,
    submitForReview,
  } = commands
  return (
    <header className={`editor-bar ${foundationStyles.bar}`}>
      {/* Leaving is the first control, because the editor is the one screen
        with no sidebar: it takes the whole viewport, so the way back has to
        be somewhere obvious rather than in a breadcrumb somebody has to
        find. */}
      <BackLink fallback={props.siteHref} appearance={!props.originalDesign ? 'button' : undefined} />
      {props.originalDesign && (
        <Link prefetch={false} className="editor-exit" href="/sites" aria-label="All sites">
          All sites
        </Link>
      )}
      <div className={`editor-title ${foundationStyles.title}`}>
        <div className={foundationStyles.copy}>
          <a href={props.siteHref} title={props.siteName}>
            {props.siteName}
          </a>
          <strong title={pageTitle}>{pageTitle}</strong>
        </div>
        <StatusPill
          compact={!props.originalDesign}
          status={
            submittedCurrent
              ? 'In review'
              : publishedVersionId
                ? hasWorkNotLive
                  ? 'Live · changes not published'
                  : 'Live'
                : 'Draft'
          }
        />
      </div>

      <div className="bar-tools">
        {props.originalDesign && <LargeScreenEditing>{viewTools}</LargeScreenEditing>}

        {!editingFrame && (
          <div className="cluster">
            {/* Truthful: it reflects an acknowledged save, not elapsed time. */}
            <span className={`saved-state ${saving ? 'is-saving' : dirty ? 'is-dirty' : ''}`} aria-live="polite">
              <span className="saved-words">
                {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}
              </span>
            </span>
            <RecoveryStatus recovery={recovery} limitedHistory={limitedHistory} />
          </div>
        )}

        <div className="cluster" inert={previewBlocked}>
          <LargeScreenEditing>
            {!editingFrame && (
              <ButtonLink variant="secondary" aria-label="Page history" href={`/pages/${props.pageId}/history`}>
                History
              </ButtonLink>
            )}
            <Menu appearance="button" label="Preview" accessibleLabel="Preview">
              {canManageSections && !props.pageScoped && (
                <label className={foundationStyles.menuChoice}>
                  <input
                    type="checkbox"
                    checked={sitePreview === 'draft'}
                    disabled={editingFrame}
                    onChange={event => changeSitePreview(event.target.checked ? 'draft' : 'published')}
                  />
                  {props.originalDesign
                    ? 'Preview with saved menu & footer changes'
                    : 'Preview with saved site-look changes'}
                </label>
              )}
              {canManageSections && (
                <label className={foundationStyles.menuChoice}>
                  <input
                    type="checkbox"
                    checked={previewHidden}
                    onChange={event => setPreviewHidden(event.target.checked)}
                  />
                  Include hidden sections
                </label>
              )}
              {!props.visitorPreviewOrigin && !props.isolatedCanvasOrigin && (
                <p className="hint">This site has no visitor preview address. A static preview will open instead.</p>
              )}
              <Button variant="secondary" onClick={() => void openVisitorPreview()}>
                Open preview
              </Button>
            </Menu>
            {!editingFrame && (
              <Menu label={<IconMore size={18} />} accessibleLabel="More page actions">
                {!props.originalDesign && (
                  <Link prefetch={false} href="/sites" aria-label="All sites">
                    All sites
                  </Link>
                )}
                {props.canPublish && !props.pageScoped && (
                  <Button variant="tertiary" disabled={transitionPending} onClick={() => void duplicateCurrentPage()}>
                    Duplicate page
                  </Button>
                )}
                {publishedVersionId && (
                  <Button variant="tertiary" onClick={discardUnpublished}>
                    Discard all unpublished changes
                  </Button>
                )}
                <Button variant="tertiary" onClick={openPageSettings}>
                  <IconSettings size={16} />
                  Page settings
                </Button>
                <Link href={`/pages/${props.pageId}/history`}>
                  <IconClock size={16} />
                  History
                </Link>
                {props.liveHref && (
                  <a href={props.liveHref} target="_blank" rel="noopener">
                    <IconExternal size={16} />
                    View live page
                  </a>
                )}
              </Menu>
            )}
          </LargeScreenEditing>
          {!editingFrame && (
            <>
              <Button
                variant="secondary"
                disabled={requiresReload || checkpointing || transitionPending}
                onClick={checkpoint}
              >
                Save draft
              </Button>
              <LargeScreenEditing>
                {props.canPublish && (
                  <Button
                    variant="secondary"
                    disabled={requiresReload || checkpointing || transitionPending || saving}
                    onClick={schedulePageReview}
                  >
                    {scheduling ? 'Preparing review…' : 'Schedule'}
                  </Button>
                )}
                {props.canPublish ? (
                  submittedCurrent ? (
                    <a className="btn" href={reviewId ? `/inbox?review=${reviewId}` : '/inbox'}>
                      <IconMail size={15} /> Review submission
                    </a>
                  ) : (
                    <Button
                      variant="publish"
                      disabled={requiresReload || transitionPending}
                      onClick={openPagePublishReview}
                    >
                      {transitionPending ? (scheduling || reviewBusy ? 'Preparing review…' : 'Publishing…') : 'Publish'}
                    </Button>
                  )
                ) : (
                  <button
                    type="button"
                    disabled={requiresReload || saving || transitionPending || submittedCurrent}
                    onClick={submitForReview}
                  >
                    <IconMail size={15} /> {submittedCurrent ? 'Submitted' : 'Submit for review'}
                  </button>
                )}
              </LargeScreenEditing>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
