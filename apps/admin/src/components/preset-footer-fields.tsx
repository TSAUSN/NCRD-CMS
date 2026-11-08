import type { FooterConfigV1, GlobalElementLink, SocialService } from '@cms/schema'
import { GuardedLink } from './guarded-link.tsx'
import { SiteLogoField } from './site-logo-field.tsx'
import { Button, IconButton } from './ui/index.ts'
import { IconFrame, IconImage, IconLink, IconPlus, IconTrash } from './icons.tsx'
import {
  LinkFields,
  emptyLink,
  type FramePageChoice,
  type FrameMediaChoice,
  type LinkLocation,
} from './preset-frame-links.tsx'
import styles from './preset-frame-fields.module.css'

export function PresetFooterLayout({
  footer,
  setPresetFooter,
  canManage,
  superAdmin,
  compact,
}: {
  footer: FooterConfigV1
  setPresetFooter: (update: (current: FooterConfigV1) => FooterConfigV1) => void
  canManage: boolean
  superAdmin: boolean
  compact: boolean
}) {
  return (
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
    </>
  )
}

export function PresetFooterGroups({
  footer,
  setPresetFooter,
  canManage,
  publishedPages,
  updateLink,
}: {
  footer: FooterConfigV1
  setPresetFooter: (update: (current: FooterConfigV1) => FooterConfigV1) => void
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
    </>
  )
}

export function PresetFooterContact({
  footer,
  setPresetFooter,
  canManage,
}: {
  footer: FooterConfigV1
  setPresetFooter: (update: (current: FooterConfigV1) => FooterConfigV1) => void
  canManage: boolean
}) {
  return (
    <>
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
    </>
  )
}

export function PresetFooterPolicyLinks({
  footer,
  setPresetFooter,
  canManage,
  publishedPages,
  updateLink,
  siteName,
  socialSettingsHref,
}: {
  footer: FooterConfigV1
  setPresetFooter: (update: (current: FooterConfigV1) => FooterConfigV1) => void
  canManage: boolean
  publishedPages: FramePageChoice[]
  updateLink: (location: LinkLocation, next: GlobalElementLink | null) => void
  siteName: string
  socialSettingsHref: string | undefined
}) {
  return (
    <>
      {socialSettingsHref ? (
        <p>
          Social accounts are managed in <GuardedLink href={socialSettingsHref}>Settings · Social accounts</GuardedLink>
          .
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
  )
}
