'use client'
import { GuardedLink } from './guarded-link.tsx'
import type { HeaderConfigV1, FooterConfigV1, GlobalElementLink, NavTarget, SocialService } from '@cms/schema'
import { SiteLogoField } from './site-logo-field.tsx'
import { Button, IconButton } from './ui/index.ts'
import { IconFrame, IconImage, IconLink, IconPlus, IconTrash } from './icons.tsx'
import styles from './preset-frame-fields.module.css'
export type FramePageChoice = { id: string; title: string; path: string; published: boolean }
export type FrameMediaChoice = { id: string; name: string; url: string; alt: string }
type LinkLocation =
  | { area: 'header-utility'; index: number }
  | { area: 'header-cta' }
  | { area: 'footer-group'; groupIndex: number; index: number }
  | { area: 'footer-legal'; key: 'privacy' | 'accessibility' | 'terms' }

const emptyLink = (): GlobalElementLink => ({ label: 'New link', target: { type: 'url', url: '/' } })
function LinkFields({
  value,
  pages,
  disabled,
  label,
  onChange,
  onRemove,
}: {
  value: GlobalElementLink
  pages: FramePageChoice[]
  disabled: boolean
  label: string
  onChange: (next: GlobalElementLink) => void
  onRemove: () => void
}) {
  const targetKind = value.target.type
  function setTargetKind(kind: 'page' | 'url') {
    const first = pages.find(page => page.published)
    const target: NavTarget = kind === 'page' && first ? { type: 'page', page_id: first.id } : { type: 'url', url: '/' }
    onChange({ ...value, target })
  }
  return (
    <div className="global-link-row">
      <div className="global-link-row-head">
        <span>
          <IconLink size={15} />
          {label}
        </span>
        {!disabled && (
          <IconButton
            className={styles.iconAction}
            variant="destructive"
            tooltip={`Remove ${label}`}
            onClick={onRemove}
          >
            <IconTrash size={15} />
          </IconButton>
        )}
      </div>
      <div className="global-link-fields">
        <div className="field">
          <label>Label</label>
          <input
            aria-label={`${label} label`}
            value={value.label}
            maxLength={80}
            disabled={disabled}
            onChange={event => onChange({ ...value, label: event.target.value })}
          />
        </div>
        <div className="field">
          <label>Destination</label>
          <select
            aria-label={`${label} destination type`}
            value={targetKind}
            disabled={disabled}
            onChange={event => setTargetKind(event.target.value as 'page' | 'url')}
          >
            <option value="page">A page on this site</option>
            <option value="url">A web address</option>
          </select>
        </div>
        {value.target.type === 'page' ? (
          <div className="field global-link-destination">
            <label>Page</label>
            <select
              aria-label={`${label} page`}
              value={value.target.page_id}
              disabled={disabled}
              onChange={event => onChange({ ...value, target: { type: 'page', page_id: event.target.value } })}
            >
              {pages
                .filter(page => page.published)
                .map(page => (
                  <option value={page.id} key={page.id}>
                    {page.title} · {page.path}
                  </option>
                ))}
            </select>
          </div>
        ) : (
          <div className="field global-link-destination">
            <label>URL</label>
            <input
              aria-label={`${label} URL`}
              value={value.target.url}
              maxLength={2048}
              disabled={disabled}
              placeholder="/about or https://…"
              onChange={event => onChange({ ...value, target: { type: 'url', url: event.target.value } })}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export function PresetFrameFields({
  siteId,
  part,
  header,
  footer,
  canManage,
  superAdmin,
  media,
  pages,
  siteName,
  compact = false,
  identityControls = true,
  socialSettingsHref,
  onHeader,
  onFooter,
}: {
  siteId: string
  part: 'header' | 'footer'
  header: HeaderConfigV1
  footer: FooterConfigV1
  canManage: boolean
  superAdmin: boolean
  media: FrameMediaChoice[]
  pages: FramePageChoice[]
  siteName: string
  compact?: boolean
  identityControls?: boolean
  socialSettingsHref?: string
  onHeader: (header: HeaderConfigV1) => void
  onFooter: (footer: FooterConfigV1) => void
}) {
  const setPresetHeader = (update: (current: HeaderConfigV1) => HeaderConfigV1) => {
    if (canManage) onHeader(update(header))
  }
  const setPresetFooter = (update: (current: FooterConfigV1) => FooterConfigV1) => {
    if (canManage) onFooter(update(footer))
  }
  const publishedPages = pages.filter(page => page.published)
  function updateLink(location: LinkLocation, next: GlobalElementLink | null) {
    if (location.area === 'header-utility') {
      setPresetHeader(current => ({
        ...current,
        utilityLinks:
          next === null
            ? current.utilityLinks.filter((_, index) => index !== location.index)
            : current.utilityLinks.map((link, index) => (index === location.index ? next : link)),
      }))
    } else if (location.area === 'header-cta') setPresetHeader(current => ({ ...current, cta: next }))
    else if (location.area === 'footer-legal') {
      setPresetFooter(current => ({ ...current, legal: { ...current.legal, [location.key]: next } }))
    } else {
      setPresetFooter(current => ({
        ...current,
        groups: current.groups.map((group, groupIndex) =>
          groupIndex !== location.groupIndex
            ? group
            : {
                ...group,
                links:
                  next === null
                    ? group.links.filter((_, index) => index !== location.index)
                    : group.links.map((link, index) => (index === location.index ? next : link)),
              },
        ),
      }))
    }
  }

  return (
    <div key={part} className={styles.fields}>
      {part === 'header' ? (
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
      ) : (
        <>
          <details className="global-panel" open>
            <summary className="global-panel-head">
              <span>
                <IconFrame size={18} />
              </span>
              <div>
                <p className="eyebrow">Site footer</p>
                <h2>Footer</h2>
                <p>Choose the shared details that appear at the bottom of every page.</p>
              </div>
            </summary>
            <div className="global-form-grid">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={footer.enabled}
                  disabled={!canManage}
                  onChange={event => setPresetFooter(current => ({ ...current, enabled: event.target.checked }))}
                />
                <span>
                  <strong>Show the footer</strong>
                  <small>Disabling it removes the footer landmark from every page.</small>
                </span>
              </label>
              <div className="field">
                <label htmlFor="global-footer-preset">Layout</label>
                <select
                  id="global-footer-preset"
                  value={footer.preset}
                  disabled={!canManage}
                  onChange={event =>
                    setPresetFooter(current => ({ ...current, preset: event.target.value as FooterConfigV1['preset'] }))
                  }
                >
                  <option value="simple">Simple · brand and legal</option>
                  <option value="columns">Columns · link-rich</option>
                  <option value="contact">Contact · local details</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="global-footer-name">Displayed site name</label>
                <input
                  id="global-footer-name"
                  value={footer.brand.siteName}
                  maxLength={120}
                  disabled={!canManage}
                  onChange={event =>
                    setPresetFooter(current => ({
                      ...current,
                      brand: { ...current.brand, siteName: event.target.value },
                    }))
                  }
                />
              </div>
              <div className="field global-span-two">
                <label htmlFor="global-footer-blurb">Short description</label>
                <textarea
                  id="global-footer-blurb"
                  rows={3}
                  maxLength={500}
                  aria-label={compact ? 'Footer introduction' : undefined}
                  value={footer.brand.blurb}
                  disabled={!canManage}
                  onChange={event =>
                    setPresetFooter(current => ({ ...current, brand: { ...current.brand, blurb: event.target.value } }))
                  }
                />
              </div>
              <label className="check-row global-span-two">
                <input
                  type="checkbox"
                  checked={footer.brand.showFoundation}
                  disabled={!canManage || !superAdmin}
                  onChange={event =>
                    setPresetFooter(current => ({
                      ...current,
                      brand: { ...current.brand, showFoundation: event.target.checked },
                    }))
                  }
                />
                <span>
                  <strong>Show the shared Salvation Army foundation</strong>
                  <small>
                    {superAdmin
                      ? 'This keeps the family of sites recognisably connected.'
                      : 'A super administrator governs this shared brand foundation.'}
                  </small>
                </span>
              </label>
            </div>
          </details>

          <details className="global-panel">
            <summary className="global-panel-head">
              <span>
                <IconLink size={18} />
              </span>
              <div>
                <p className="eyebrow">Explore the site</p>
                <h2>Link groups</h2>
                <p>Group related pages under a short heading.</p>
              </div>
            </summary>
            <div className="global-list">
              {footer.groups.length === 0 && <p className="global-empty">No footer groups yet.</p>}
              {footer.groups.map((group, groupIndex) => (
                <div className="global-group" key={groupIndex}>
                  <div className="global-group-head">
                    <div className="field">
                      <label>Group heading</label>
                      <input
                        aria-label={`Group ${groupIndex + 1} heading`}
                        value={group.heading}
                        maxLength={80}
                        disabled={!canManage}
                        onChange={event =>
                          setPresetFooter(current => ({
                            ...current,
                            groups: current.groups.map((item, index) =>
                              index === groupIndex ? { ...item, heading: event.target.value } : item,
                            ),
                          }))
                        }
                      />
                    </div>
                    {canManage && (
                      <IconButton
                        className={styles.iconAction}
                        variant="destructive"
                        tooltip={`Remove ${group.heading || 'group'}`}
                        onClick={() =>
                          setPresetFooter(current => ({
                            ...current,
                            groups: current.groups.filter((_, index) => index !== groupIndex),
                          }))
                        }
                      >
                        <IconTrash size={16} />
                      </IconButton>
                    )}
                  </div>
                  {group.links.map((link, index) => (
                    <LinkFields
                      key={index}
                      value={link}
                      pages={publishedPages}
                      disabled={!canManage}
                      label={`Link ${index + 1}`}
                      onChange={next => updateLink({ area: 'footer-group', groupIndex, index }, next)}
                      onRemove={() => updateLink({ area: 'footer-group', groupIndex, index }, null)}
                    />
                  ))}
                  {canManage && group.links.length < 6 && (
                    <Button
                      variant="secondary"
                      type="button"
                      className="global-add global-add-small"
                      onClick={() =>
                        setPresetFooter(current => ({
                          ...current,
                          groups: current.groups.map((item, index) =>
                            index === groupIndex ? { ...item, links: [...item.links, emptyLink()] } : item,
                          ),
                        }))
                      }
                    >
                      <IconPlus size={15} />
                      Add link
                    </Button>
                  )}
                </div>
              ))}
              {canManage && footer.groups.length < 4 && (
                <Button
                  variant="secondary"
                  type="button"
                  className="global-add"
                  onClick={() =>
                    setPresetFooter(current => ({
                      ...current,
                      groups: [...current.groups, { heading: 'Explore', links: [] }],
                    }))
                  }
                >
                  <IconPlus size={16} />
                  Add link group
                </Button>
              )}
            </div>
          </details>

          <details className="global-panel">
            <summary className="global-panel-head">
              <span aria-hidden="true">@</span>
              <div>
                <p className="eyebrow">Local presence</p>
                <h2>Contact details</h2>
                <p>Help visitors get in touch.</p>
              </div>
            </summary>
            <div className="global-list">
              {footer.contact === null ? (
                canManage ? (
                  <Button
                    variant="secondary"
                    type="button"
                    className="global-add"
                    onClick={() =>
                      setPresetFooter(current => ({ ...current, contact: { heading: 'Contact us', address: '' } }))
                    }
                  >
                    <IconPlus size={16} />
                    Add contact details
                  </Button>
                ) : (
                  <p className="global-empty">No contact details.</p>
                )
              ) : (
                <div className="global-form-grid global-form-grid-inset">
                  <div className="field">
                    <label>Heading</label>
                    <input
                      aria-label="Contact heading"
                      value={footer.contact.heading ?? ''}
                      maxLength={80}
                      disabled={!canManage}
                      onChange={event =>
                        setPresetFooter(current => ({
                          ...current,
                          contact: current.contact && { ...current.contact, heading: event.target.value || undefined },
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Phone</label>
                    <input
                      aria-label="Contact phone"
                      value={footer.contact.phone ?? ''}
                      maxLength={300}
                      disabled={!canManage}
                      onChange={event =>
                        setPresetFooter(current => ({
                          ...current,
                          contact: current.contact && { ...current.contact, phone: event.target.value || undefined },
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Email</label>
                    <input
                      aria-label="Contact email"
                      type="email"
                      value={footer.contact.email ?? ''}
                      maxLength={254}
                      disabled={!canManage}
                      onChange={event =>
                        setPresetFooter(current => ({
                          ...current,
                          contact: current.contact && { ...current.contact, email: event.target.value || undefined },
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Address</label>
                    <textarea
                      aria-label="Contact address"
                      rows={3}
                      value={footer.contact.address ?? ''}
                      maxLength={300}
                      disabled={!canManage}
                      onChange={event =>
                        setPresetFooter(current => ({
                          ...current,
                          contact: current.contact && { ...current.contact, address: event.target.value || undefined },
                        }))
                      }
                    />
                  </div>
                  {canManage && (
                    <Button
                      variant="secondary"
                      type="button"
                      className="global-remove-text"
                      onClick={() => setPresetFooter(current => ({ ...current, contact: null }))}
                    >
                      <IconTrash size={15} />
                      Remove contact details
                    </Button>
                  )}
                </div>
              )}
            </div>
          </details>

          {socialSettingsHref ? (
            <p>
              Social accounts are managed in{' '}
              <GuardedLink href={socialSettingsHref}>Settings · Social accounts</GuardedLink>.
            </p>
          ) : (
            <details className="global-panel">
              <summary className="global-panel-head">
                <span aria-hidden="true">#</span>
                <div>
                  <p className="eyebrow">Official channels</p>
                  <h2>Social links</h2>
                  <p>Add the site’s official social profiles.</p>
                </div>
              </summary>
              <div className="global-list">
                {footer.social.length === 0 && <p className="global-empty">No social profiles.</p>}
                {footer.social.map((social, index) => (
                  <div className="global-social-row" key={index}>
                    <div className="field">
                      <label>Service</label>
                      <select
                        aria-label={`Social profile ${index + 1} service`}
                        value={social.service}
                        disabled={!canManage}
                        onChange={event =>
                          setPresetFooter(current => ({
                            ...current,
                            social: current.social.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, service: event.target.value as SocialService } : item,
                            ),
                          }))
                        }
                      >
                        {['facebook', 'instagram', 'youtube', 'linkedin', 'x', 'tiktok'].map(service => (
                          <option value={service} key={service}>
                            {service[0]!.toUpperCase() + service.slice(1)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>HTTPS profile URL</label>
                      <input
                        aria-label={`Social profile ${index + 1} URL`}
                        value={social.url}
                        maxLength={2048}
                        disabled={!canManage}
                        onChange={event =>
                          setPresetFooter(current => ({
                            ...current,
                            social: current.social.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, url: event.target.value } : item,
                            ),
                          }))
                        }
                      />
                    </div>
                    {canManage && (
                      <IconButton
                        className={styles.iconAction}
                        variant="destructive"
                        tooltip={`Remove ${social.service}`}
                        onClick={() =>
                          setPresetFooter(current => ({
                            ...current,
                            social: current.social.filter((_, itemIndex) => itemIndex !== index),
                          }))
                        }
                      >
                        <IconTrash size={16} />
                      </IconButton>
                    )}
                  </div>
                ))}
                {canManage && footer.social.length < 6 && (
                  <Button
                    variant="secondary"
                    type="button"
                    className="global-add"
                    onClick={() =>
                      setPresetFooter(current => ({
                        ...current,
                        social: [...current.social, { service: 'facebook', url: 'https://' }],
                      }))
                    }
                  >
                    <IconPlus size={16} />
                    Add social profile
                  </Button>
                )}
              </div>
            </details>
          )}

          <details className="global-panel">
            <summary className="global-panel-head">
              <span aria-hidden="true">§</span>
              <div>
                <p className="eyebrow">Footer base</p>
                <h2>Legal and accessibility links</h2>
                <p>Choose a page on this site or a secure web address.</p>
              </div>
            </summary>
            <div className="global-list">
              <div className="field global-copyright">
                <label>Copyright line</label>
                <input
                  aria-label="Copyright line"
                  value={footer.legal.copyright}
                  maxLength={200}
                  disabled={!canManage}
                  placeholder={`© ${siteName}`}
                  onChange={event =>
                    setPresetFooter(current => ({
                      ...current,
                      legal: { ...current.legal, copyright: event.target.value },
                    }))
                  }
                />
              </div>
              {(['privacy', 'accessibility', 'terms'] as const).map(key =>
                footer.legal[key] ? (
                  <LinkFields
                    key={key}
                    value={footer.legal[key]!}
                    pages={publishedPages}
                    disabled={!canManage}
                    label={key[0]!.toUpperCase() + key.slice(1)}
                    onChange={next => updateLink({ area: 'footer-legal', key }, next)}
                    onRemove={() => updateLink({ area: 'footer-legal', key }, null)}
                  />
                ) : (
                  canManage && (
                    <Button
                      variant="secondary"
                      type="button"
                      className="global-add global-add-small"
                      key={key}
                      onClick={() =>
                        updateLink(
                          { area: 'footer-legal', key },
                          { ...emptyLink(), label: key[0]!.toUpperCase() + key.slice(1) },
                        )
                      }
                    >
                      <IconPlus size={15} />
                      Add {key} link
                    </Button>
                  )
                ),
              )}
            </div>
          </details>
        </>
      )}
    </div>
  )
}
