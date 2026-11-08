import type { HeaderConfigV1, GlobalElementLink } from '@cms/schema'
import { SiteLogoField } from './site-logo-field.tsx'
import { Button } from './ui/index.ts'
import { IconFrame, IconImage, IconLink, IconPlus, IconTrash } from './icons.tsx'
import {
  LinkFields,
  emptyLink,
  type FramePageChoice,
  type FrameMediaChoice,
  type LinkLocation,
} from './preset-frame-links.tsx'

export function PresetHeaderIdentity({
  header,
  setPresetHeader,
  canManage,
  compact,
  identityControls,
  media,
  siteId,
}: {
  header: HeaderConfigV1
  setPresetHeader: (update: (current: HeaderConfigV1) => HeaderConfigV1) => void
  canManage: boolean
  compact: boolean
  identityControls: boolean
  media: FrameMediaChoice[]
  siteId: string
}) {
  return (
    <>
      <details className="global-panel" open>
        <summary className="global-panel-head">
          <span>
            <IconFrame size={18} />
          </span>
          <div>
            <p className="eyebrow">Site header</p>
            <h2>Header</h2>
            <p>Keep the site recognisable while letting each audience choose the right density.</p>
          </div>
        </summary>
        <div className="global-form-grid">
          <label className="check-row">
            <input
              type="checkbox"
              checked={header.enabled}
              disabled={!canManage}
              onChange={event => setPresetHeader(current => ({ ...current, enabled: event.target.checked }))}
            />
            <span>
              <strong>Show the header</strong>
              <small>Turn this off to leave out the header on every page.</small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={header.sticky}
              disabled={!canManage}
              onChange={event => setPresetHeader(current => ({ ...current, sticky: event.target.checked }))}
            />
            <span>
              <strong>Keep it visible while scrolling</strong>
              <small>Useful for long pages; reduced-motion visitors are respected.</small>
            </span>
          </label>
          <div className="field">
            <label htmlFor="global-header-preset">Layout</label>
            <select
              id="global-header-preset"
              value={header.preset}
              disabled={!canManage}
              onChange={event =>
                setPresetHeader(current => ({ ...current, preset: event.target.value as HeaderConfigV1['preset'] }))
              }
            >
              <option value="standard">Standard · balanced</option>
              <option value="centered">Centered brand</option>
              <option value="compact">Compact · content-first</option>
              <option value="minimal">Minimal · brand only</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="global-header-surface">Surface</label>
            <select
              id="global-header-surface"
              value={header.surface}
              disabled={!canManage}
              onChange={event =>
                setPresetHeader(current => ({
                  ...current,
                  surface: event.target.value as HeaderConfigV1['surface'],
                }))
              }
            >
              <option value="page">Page</option>
              <option value="soft">Soft</option>
              <option value="primary">Primary</option>
              <option value="accent">Accent</option>
              <option value="transparent">Transparent</option>
            </select>
          </div>
          {identityControls && (
            <>
              {' '}
              <div className="field">
                <label htmlFor="global-site-name">Displayed site name</label>
                <input
                  id="global-site-name"
                  aria-label={compact ? 'Site name' : undefined}
                  value={header.brand.siteName}
                  maxLength={120}
                  disabled={!canManage}
                  onChange={event =>
                    setPresetHeader(current => ({
                      ...current,
                      brand: { ...current.brand, siteName: event.target.value },
                    }))
                  }
                />
              </div>
              <label className="check-row check-row-compact">
                <input
                  type="checkbox"
                  checked={header.brand.showName}
                  disabled={!canManage}
                  onChange={event =>
                    setPresetHeader(current => ({
                      ...current,
                      brand: { ...current.brand, showName: event.target.checked },
                    }))
                  }
                />
                <span>
                  <strong>Show site name beside the logo</strong>
                  <small>A visible name remains the safe fallback.</small>
                </span>
              </label>
            </>
          )}
        </div>
      </details>

      {identityControls && (
        <details className="global-panel">
          <summary className="global-panel-head">
            <span>
              <IconImage size={18} />
            </span>
            <div>
              <p className="eyebrow">Your site identity</p>
              <h2>Logos</h2>
              <p>Choose a full logo and an optional smaller version for compact headers.</p>
            </div>
          </summary>
          <div className="global-logo-grid">
            <SiteLogoField
              siteId={siteId}
              siteName={header.brand.siteName}
              compact={false}
              fallback={header.brand.compactLogoMediaId ? 'compact' : 'name'}
              value={header.brand.logoMediaId}
              choices={media}
              disabled={!canManage}
              onChange={id =>
                setPresetHeader(current => ({ ...current, brand: { ...current.brand, logoMediaId: id } }))
              }
            />
            <SiteLogoField
              siteId={siteId}
              siteName={header.brand.siteName}
              compact
              fallback={header.brand.logoMediaId ? 'full' : 'name'}
              value={header.brand.compactLogoMediaId}
              choices={media}
              disabled={!canManage}
              onChange={id =>
                setPresetHeader(current => ({ ...current, brand: { ...current.brand, compactLogoMediaId: id } }))
              }
            />
          </div>
        </details>
      )}

      <details className="global-panel">
        <summary className="global-panel-head">
          <span>
            <IconLink size={18} />
          </span>
          <div>
            <p className="eyebrow">Beside the brand</p>
            <h2>Partner</h2>
            <p>Name an organization the site is made with, as in “In partnership with …”. Hidden on phones.</p>
          </div>
        </summary>
        <div className="global-list">
          {header.partner ? (
            <div className="global-link-fields" role="group" aria-label="Partner">
              <div className="field">
                <label htmlFor="global-partner-label">Words before the name</label>
                <input
                  id="global-partner-label"
                  value={header.partner.label}
                  maxLength={80}
                  disabled={!canManage}
                  onChange={event =>
                    setPresetHeader(current =>
                      current.partner
                        ? { ...current, partner: { ...current.partner, label: event.target.value } }
                        : current,
                    )
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="global-partner-name">Partner’s name</label>
                <input
                  id="global-partner-name"
                  required
                  aria-invalid={!header.partner.name.trim() || undefined}
                  value={header.partner.name}
                  maxLength={120}
                  disabled={!canManage}
                  onChange={event =>
                    setPresetHeader(current =>
                      current.partner
                        ? { ...current, partner: { ...current.partner, name: event.target.value } }
                        : current,
                    )
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="global-partner-url">Partner’s web address (optional)</label>
                <input
                  id="global-partner-url"
                  inputMode="url"
                  placeholder="https://…"
                  value={header.partner.url ?? ''}
                  disabled={!canManage}
                  onChange={event =>
                    setPresetHeader(current =>
                      current.partner
                        ? { ...current, partner: { ...current.partner, url: event.target.value.trim() || null } }
                        : current,
                    )
                  }
                />
              </div>
              {canManage && (
                <Button
                  variant="secondary"
                  type="button"
                  className="secondary small"
                  onClick={() => setPresetHeader(current => ({ ...current, partner: null }))}
                >
                  Remove partner
                </Button>
              )}
            </div>
          ) : canManage ? (
            <Button
              variant="secondary"
              type="button"
              className="global-add"
              onClick={() =>
                setPresetHeader(current => ({
                  ...current,
                  partner: { label: 'In partnership with', name: '', url: null },
                }))
              }
            >
              <IconPlus size={16} />
              Add a partner
            </Button>
          ) : (
            <p className="global-empty">No partner named in the header.</p>
          )}
        </div>
      </details>
    </>
  )
}

export function PresetHeaderLinks({
  header,
  setPresetHeader,
  canManage,
  publishedPages,
  updateLink,
}: {
  header: HeaderConfigV1
  setPresetHeader: (update: (current: HeaderConfigV1) => HeaderConfigV1) => void
  canManage: boolean
  publishedPages: FramePageChoice[]
  updateLink: (location: LinkLocation, next: GlobalElementLink | null) => void
}) {
  return (
    <>
      <details className="global-panel">
        <summary className="global-panel-head">
          <span>
            <IconLink size={18} />
          </span>
          <div>
            <p className="eyebrow">Above the main menu</p>
            <h2>Utility links</h2>
            <p>Add up to four secondary actions such as Donate, Find a location, or Contact.</p>
          </div>
        </summary>
        <div className="global-list">
          {header.utilityLinks.length === 0 && (
            <p className="global-empty">No utility links. Edit the main menu below.</p>
          )}
          {header.utilityLinks.map((link, index) => (
            <LinkFields
              key={index}
              value={link}
              pages={publishedPages}
              disabled={!canManage}
              label={`Utility link ${index + 1}`}
              onChange={next => updateLink({ area: 'header-utility', index }, next)}
              onRemove={() => updateLink({ area: 'header-utility', index }, null)}
            />
          ))}
          {canManage && header.utilityLinks.length < 4 && (
            <Button
              variant="secondary"
              type="button"
              className="global-add"
              onClick={() =>
                setPresetHeader(current => ({ ...current, utilityLinks: [...current.utilityLinks, emptyLink()] }))
              }
            >
              <IconPlus size={16} />
              Add utility link
            </Button>
          )}
        </div>
      </details>

      <details className="global-panel">
        <summary className="global-panel-head">
          <span>
            <IconLink size={18} />
          </span>
          <div>
            <p className="eyebrow">Primary action</p>
            <h2>Header call to action</h2>
            <p>Button colours and hover effects come from Style.</p>
          </div>
        </summary>
        <div className="global-list">
          {header.cta ? (
            <LinkFields
              value={header.cta}
              pages={publishedPages}
              disabled={!canManage}
              label="Call to action"
              onChange={next => updateLink({ area: 'header-cta' }, next)}
              onRemove={() => updateLink({ area: 'header-cta' }, null)}
            />
          ) : canManage ? (
            <Button
              variant="secondary"
              type="button"
              className="global-add"
              onClick={() => setPresetHeader(current => ({ ...current, cta: emptyLink() }))}
            >
              <IconPlus size={16} />
              Add call to action
            </Button>
          ) : (
            <p className="global-empty">No header call to action.</p>
          )}
        </div>
      </details>
    </>
  )
}
