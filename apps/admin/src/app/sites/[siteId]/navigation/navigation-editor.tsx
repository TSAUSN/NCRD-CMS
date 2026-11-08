'use client'
import { IconAlert, IconCheck, IconEye, IconLink, IconPage, IconPlus } from '../../../../components/icons.tsx'
import { useNavigationDraft, type NavigationEditorProps } from './use-navigation-draft.ts'
import { NavigationOutline } from './navigation-outline.tsx'
import { NavigationPreview } from './navigation-preview.tsx'

export function NavigationEditor(props: NavigationEditorProps) {
  const { siteName } = props
  const model = useNavigationDraft(props)
  const {
    tree,
    mode,
    setMode,
    notice,
    linkOpen,
    setLinkOpen,
    linkLabel,
    setLinkLabel,
    linkUrl,
    setLinkUrl,
    pending,
    availablePages,
    hasDraftPages,
    dirty,
    hasLiveVersion,
    draftIsLive,
    addPage,
    addLink,
    act,
    canManage,
  } = model
  return (
    <div className="navigation-workspace">
      {!canManage && (
        <p className="notice" role="note">
          <IconEye size={16} />
          <span className="notice-body">You can inspect this menu. An editor or site administrator can change it.</span>
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

      <section className="navigation-commandbar" aria-label="Navigation publishing status">
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
            <small>{dirty ? 'Save the draft before publishing.' : 'Your changes are saved.'}</small>
          </span>
        </div>
        {canManage && (
          <div className="actions">
            <button type="button" className="secondary" disabled={!dirty || pending} onClick={() => act('save')}>
              {pending ? 'Working…' : 'Save draft'}
            </button>
            <button
              type="button"
              className="cta"
              disabled={dirty || draftIsLive || pending}
              onClick={() => act('publish')}
            >
              Publish navigation
            </button>
          </div>
        )}
      </section>

      <div className="navigation-grid">
        <div className="navigation-builder">
          <section className="navigation-mode" aria-labelledby="navigation-sync-title">
            <div>
              <p className="eyebrow">Page syncing</p>
              <h2 id="navigation-sync-title">What should happen when a page goes live?</h2>
            </div>
            <div className="navigation-mode-options">
              <label className={mode === 'auto' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="navigation-mode"
                  value="auto"
                  checked={mode === 'auto'}
                  disabled={!canManage}
                  onChange={() => setMode('auto')}
                />
                <span>
                  <strong>Add it automatically</strong>
                  <small>Newly published pages join the end of the menu. You can still reorder or hide them.</small>
                </span>
              </label>
              <label className={mode === 'manual' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="navigation-mode"
                  value="manual"
                  checked={mode === 'manual'}
                  disabled={!canManage}
                  onChange={() => setMode('manual')}
                />
                <span>
                  <strong>Let me choose</strong>
                  <small>Publishing a page never changes this menu until an editor adds it here.</small>
                </span>
              </label>
            </div>
          </section>

          <NavigationOutline model={model} />

          {canManage && (
            <section className="navigation-add" aria-labelledby="navigation-add-title">
              <div className="navigation-section-head">
                <div>
                  <p className="eyebrow">Add an item</p>
                  <h2 id="navigation-add-title">Pages and links</h2>
                </div>
              </div>
              {availablePages.length > 0 && (
                <div className="navigation-page-choices">
                  {availablePages.map(page => (
                    <button
                      key={page.id}
                      type="button"
                      className="navigation-page-choice"
                      onClick={() => addPage(page)}
                    >
                      <span>
                        <IconPage size={16} />
                      </span>
                      <span>
                        <strong>{page.title}</strong>
                        <small className="mono">{page.path}</small>
                      </span>
                      <IconPlus size={15} />
                    </button>
                  ))}
                </div>
              )}
              {hasDraftPages && (
                <p className="navigation-draft-note">
                  Draft-only pages become available here after they are published.
                </p>
              )}
              {!linkOpen ? (
                <button type="button" className="secondary navigation-link-trigger" onClick={() => setLinkOpen(true)}>
                  <IconLink size={15} /> Add an internal or external link
                </button>
              ) : (
                <div className="navigation-link-form">
                  <div className="field">
                    <label htmlFor="nav-link-label">Link label</label>
                    <input
                      id="nav-link-label"
                      value={linkLabel}
                      maxLength={80}
                      onChange={event => setLinkLabel(event.target.value)}
                      placeholder="Donate"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="nav-link-url">Destination</label>
                    <input
                      id="nav-link-url"
                      value={linkUrl}
                      maxLength={2048}
                      onChange={event => setLinkUrl(event.target.value)}
                      placeholder="/give or https://example.org"
                    />
                  </div>
                  <div className="actions">
                    <button type="button" className="secondary" onClick={() => setLinkOpen(false)}>
                      Cancel
                    </button>
                    <button type="button" disabled={!linkLabel.trim() || !linkUrl.trim()} onClick={addLink}>
                      <IconPlus size={15} /> Add link
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <NavigationPreview siteName={siteName} tree={tree} />
      </div>
    </div>
  )
}
