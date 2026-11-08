'use client'

import { Button } from '../../../../components/ui/index.ts'
import styles from './theme-editor.module.css'
import settings from '../../../../components/settings-controls.module.css'
import { DEFAULT_THEME_TOKENS, type ThemeTokens } from '@cms/schema'
import { IconAlert, IconCheck, IconEye } from '../../../../components/icons.tsx'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import { cloneThemeTokens, useThemeDraft, type ThemeEditorProps } from './use-theme-draft.ts'
import { ThemeColourFields } from './theme-colour-fields.tsx'
import { ThemeAppearanceFields } from './theme-appearance-fields.tsx'
import { ThemeEditorPreview } from './theme-editor-preview.tsx'

export function ThemeEditor({
  siteId,
  siteName,
  initial,
  canManage,
  controlsOnly = false,
  onDraftChange,
  presetTokens,
  commands,
  relatedControls,
  startingControls,
}: ThemeEditorProps) {
  const {
    tokens,
    setTokens,
    notice,
    confirming,
    setConfirming,
    pending,
    dirty,
    valid,
    contrastReady,
    approvedPrimary,
    hasLiveVersion,
    draftIsLive,
    actionInFlight,
    act,
  } = useThemeDraft({ siteId, initial, canManage, onDraftChange, presetTokens })
  return (
    <div className={`theme-workspace ${settings.controls} ${controlsOnly ? styles.embedded : ''}`}>
      {!canManage && !controlsOnly && (
        <p className="notice" role="note">
          <IconEye size={16} />
          <span className="notice-body">You can inspect this design. A site administrator can change it.</span>
        </p>
      )}
      {notice && !controlsOnly && (
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

      <section className="theme-commandbar" aria-label="Design publishing status">
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
            <small role={!dirty && notice?.ok ? 'status' : undefined}>
              {!dirty && notice?.ok
                ? notice.message
                : dirty
                  ? 'Save the draft before publishing.'
                  : 'Your changes are saved.'}
            </small>
          </span>
        </div>
        {controlsOnly && notice && !notice.ok && (
          <p role="alert" className={styles.fieldError}>
            {notice.message}
            {notice.kind === 'conflict' && (
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Reload
              </Button>
            )}
          </p>
        )}
        {valid && !contrastReady && (
          <p role="alert" className={styles.fieldError}>
            Improve colour contrast before publishing. Check the marked colours above.
          </p>
        )}
        {!valid && (
          <p id="theme-colour-error" role="alert" className={styles.fieldError}>
            Enter complete six-digit colours before saving.
          </p>
        )}
        {canManage && (
          <div className="actions">
            <Button
              variant="secondary"
              disabled={!hasLiveVersion || dirty || draftIsLive || pending}
              onClick={() => setConfirming('revert')}
            >
              Revert to live
            </Button>
            <Button
              variant="secondary"
              disabled={!dirty || pending || !valid}
              loading={pending}
              onClick={() => act('save')}
            >
              Save draft
            </Button>
            {controlsOnly && commands}
            {!controlsOnly && (
              <Button
                variant="publish"
                disabled={dirty || draftIsLive || pending || !contrastReady}
                onClick={() => setConfirming('publish')}
              >
                Publish design
              </Button>
            )}
          </div>
        )}
      </section>

      <div className="theme-grid">
        {!canManage && controlsOnly && (
          <p className="notice" role="note">
            <IconEye size={16} />
            <span className="notice-body">You can inspect this design. A site administrator can change it.</span>
          </p>
        )}
        <fieldset
          className="theme-controls"
          disabled={pending || !canManage}
          aria-busy={pending}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
          {controlsOnly && startingControls}
          <ThemeColourFields
            tokens={tokens}
            setTokens={setTokens}
            controlsOnly={controlsOnly}
            approvedPrimary={approvedPrimary}
            canManage={canManage}
            usage={initial.usage}
          />
          <ThemeAppearanceFields
            tokens={tokens}
            setTokens={setTokens}
            canManage={canManage}
            pending={pending}
            controlsOnly={controlsOnly}
            usage={initial.usage}
            onStartingDesign={() => setConfirming('defaults')}
          />
          {controlsOnly && relatedControls}
        </fieldset>

        {!controlsOnly && (
          <ThemeEditorPreview
            siteId={siteId}
            siteName={siteName}
            pages={initial.previewPages}
            tokens={tokens}
            contrastReady={contrastReady}
          />
        )}
      </div>

      {confirming === 'publish' && (
        <ConfirmDialog
          tone="primary"
          title="Publish this site design?"
          what="Every published page on this site will begin using these colours, fonts, spacing and button styles."
          reassurance="Page content and navigation are not changed. The current live design remains in version history."
          confirmLabel="Publish design"
          pending={pending}
          onCancel={() => {
            if (!actionInFlight.current) setConfirming(null)
          }}
          onConfirm={() => act('publish')}
        />
      )}
      {confirming === 'revert' && (
        <ConfirmDialog
          title="Revert the design draft to live?"
          what="A new saved draft will be created from the design visitors see now."
          reassurance="The live site will not change, and the discarded draft remains in immutable history."
          confirmLabel="Revert draft"
          pending={pending}
          onCancel={() => {
            if (!actionInFlight.current) setConfirming(null)
          }}
          onConfirm={() => act('revert')}
        />
      )}
      {confirming === 'defaults' && (
        <ConfirmDialog
          title="Use the standard starting design?"
          what="All colour, type, spacing and button controls in this unsaved draft will return to the standard starting values."
          reassurance="Nothing live changes until you save and publish. Reloading before save restores the current saved draft."
          confirmLabel="Use starting design"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setTokens(cloneThemeTokens(DEFAULT_THEME_TOKENS as ThemeTokens))
            setConfirming(null)
          }}
        />
      )}
    </div>
  )
}
