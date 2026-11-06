'use client'
import type { FooterConfigV1, GlobalElementLink, NavTarget } from '@cms/schema'
import type { FramePageChoice } from './preset-frame-fields.tsx'
import { Button, Card, Disclosure, Field } from './ui/index.ts'
import styles from './workspace.module.css'

/** The same preset footer data and commands,grouped like the national Footer. */
export function PresetFooterCards({
  footer,
  pages,
  canManage,
  superAdmin,
  siteName,
  onChange,
}: {
  footer: FooterConfigV1
  pages: FramePageChoice[]
  canManage: boolean
  superAdmin: boolean
  siteName: string
  onChange: (footer: FooterConfigV1) => void
}) {
  const set = (next: FooterConfigV1) => {
      if (canManage) onChange(next)
    },
    published = pages.filter(page => page.published)
  const linkCount = footer.groups.reduce((count, group) => count + group.links.length, 0)
  const empty = (label = 'New link'): GlobalElementLink => ({ label, target: { type: 'url', url: '/' } })
  const legal = (key: 'privacy' | 'accessibility' | 'terms', link: GlobalElementLink | null) =>
    set({ ...footer, legal: { ...footer.legal, [key]: link } })
  return (
    <div className={styles.threeColumns}>
      <Card title="Logo and name" density="editor">
        <p className="hint">This footer uses its saved site name and layout.</p>
        <Field id="preset-footer-name" label="Displayed site name">
          <input
            value={footer.brand.siteName}
            maxLength={120}
            disabled={!canManage}
            onChange={event => set({ ...footer, brand: { ...footer.brand, siteName: event.target.value } })}
          />
        </Field>
        <Disclosure title="Layout and visibility">
          <div className={styles.formStack}>
            <label className={styles.toggleRow}>
              <span>Show the footer</span>
              <input
                type="checkbox"
                role="switch"
                checked={footer.enabled}
                disabled={!canManage}
                onChange={event => set({ ...footer, enabled: event.target.checked })}
              />
            </label>
            <Field id="preset-footer-layout" label="Layout">
              <select
                value={footer.preset}
                disabled={!canManage}
                onChange={event => set({ ...footer, preset: event.target.value as FooterConfigV1['preset'] })}
              >
                <option value="simple">Simple · brand and legal</option>
                <option value="columns">Columns · link-rich</option>
                <option value="contact">Contact · local details</option>
              </select>
            </Field>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={footer.brand.showFoundation}
                disabled={!canManage || !superAdmin}
                onChange={event => set({ ...footer, brand: { ...footer.brand, showFoundation: event.target.checked } })}
              />
              <span>Show the shared Salvation Army foundation</span>
            </label>
            {!superAdmin && <p className="hint">A Super admin governs this shared brand foundation.</p>}
          </div>
        </Disclosure>
      </Card>
      <Card title="Text" density="editor">
        <Field id="preset-footer-description" label="Short description">
          <textarea
            rows={3}
            maxLength={500}
            value={footer.brand.blurb}
            disabled={!canManage}
            onChange={event => set({ ...footer, brand: { ...footer.brand, blurb: event.target.value } })}
          />
        </Field>
        <Disclosure title="Contact details">
          <div className={styles.formStack}>
            {footer.contact === null ? (
              <>
                <p className="hint">No contact details.</p>
                {canManage && (
                  <Button
                    variant="secondary"
                    onClick={() => set({ ...footer, contact: { heading: 'Contact us', address: '' } })}
                  >
                    Add contact details
                  </Button>
                )}
              </>
            ) : (
              <>
                <Field id="preset-contact-heading" label="Heading">
                  <input
                    aria-label="Contact heading"
                    maxLength={80}
                    value={footer.contact.heading ?? ''}
                    disabled={!canManage}
                    onChange={event =>
                      set({ ...footer, contact: { ...footer.contact!, heading: event.target.value || undefined } })
                    }
                  />
                </Field>
                <Field id="preset-contact-phone" label="Phone">
                  <input
                    aria-label="Contact phone"
                    maxLength={300}
                    value={footer.contact.phone ?? ''}
                    disabled={!canManage}
                    onChange={event =>
                      set({ ...footer, contact: { ...footer.contact!, phone: event.target.value || undefined } })
                    }
                  />
                </Field>
                <Field id="preset-contact-email" label="Email">
                  <input
                    aria-label="Contact email"
                    type="email"
                    maxLength={254}
                    value={footer.contact.email ?? ''}
                    disabled={!canManage}
                    onChange={event =>
                      set({ ...footer, contact: { ...footer.contact!, email: event.target.value || undefined } })
                    }
                  />
                </Field>
                <Field id="preset-contact-address" label="Address">
                  <textarea
                    aria-label="Contact address"
                    rows={3}
                    maxLength={500}
                    value={footer.contact.address}
                    disabled={!canManage}
                    onChange={event => set({ ...footer, contact: { ...footer.contact!, address: event.target.value } })}
                  />
                </Field>
                {canManage && (
                  <Button variant="secondary" onClick={() => set({ ...footer, contact: null })}>
                    Remove contact details
                  </Button>
                )}
              </>
            )}
          </div>
        </Disclosure>
      </Card>
      <Card title="Links" density="editor">
        <p className="hint">
          {footer.groups.length} {footer.groups.length === 1 ? 'group' : 'groups'} · {linkCount}{' '}
          {linkCount === 1 ? 'link' : 'links'}
        </p>
        <Disclosure title="Link groups">
          <div className={styles.formStack}>
            {footer.groups.length === 0 && <p className="hint">No footer groups yet.</p>}
            {footer.groups.map((group, groupIndex) => (
              <Disclosure key={groupIndex} title={group.heading || 'Untitled group'}>
                <div className={styles.formStack}>
                  <Field id={'preset-group-' + groupIndex} label="Group heading">
                    <input
                      aria-label={`Group ${groupIndex + 1} heading`}
                      maxLength={80}
                      disabled={!canManage}
                      value={group.heading}
                      onChange={event =>
                        set({
                          ...footer,
                          groups: footer.groups.map((item, index) =>
                            index === groupIndex ? { ...item, heading: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  </Field>
                  {group.links.map((link, index) => (
                    <PresetLink
                      key={index}
                      label={`Link ${index + 1}`}
                      id={`preset-group-${groupIndex}-link-${index}`}
                      link={link}
                      pages={published}
                      disabled={!canManage}
                      onChange={next =>
                        set({
                          ...footer,
                          groups: footer.groups.map((item, at) =>
                            at === groupIndex
                              ? {
                                  ...item,
                                  links:
                                    next === null
                                      ? item.links.filter((_, at) => at !== index)
                                      : item.links.map((item, at) => (at === index ? next : item)),
                                }
                              : item,
                          ),
                        })
                      }
                    />
                  ))}
                  {canManage && group.links.length < 6 && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        set({
                          ...footer,
                          groups: footer.groups.map((item, index) =>
                            index === groupIndex ? { ...item, links: [...item.links, empty()] } : item,
                          ),
                        })
                      }
                    >
                      Add link
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        set({ ...footer, groups: footer.groups.filter((_, index) => index !== groupIndex) })
                      }
                    >
                      Remove {group.heading || 'group'}
                    </Button>
                  )}
                </div>
              </Disclosure>
            ))}
            {canManage && footer.groups.length < 4 && (
              <Button
                variant="secondary"
                onClick={() => set({ ...footer, groups: [...footer.groups, { heading: 'Explore', links: [] }] })}
              >
                Add link group
              </Button>
            )}
          </div>
        </Disclosure>
        <Disclosure title="Legal and accessibility links">
          <div className={styles.formStack}>
            <Field id="preset-footer-copyright" label="Copyright line">
              <input
                maxLength={200}
                placeholder={`© ${siteName}`}
                value={footer.legal.copyright}
                disabled={!canManage}
                onChange={event => set({ ...footer, legal: { ...footer.legal, copyright: event.target.value } })}
              />
            </Field>
            {(['privacy', 'accessibility', 'terms'] as const).map(key => {
              const label = key[0]!.toUpperCase() + key.slice(1)
              return footer.legal[key] ? (
                <PresetLink
                  key={key}
                  id={'preset-legal-' + key}
                  label={label}
                  link={footer.legal[key]!}
                  pages={published}
                  disabled={!canManage}
                  onChange={next => legal(key, next)}
                />
              ) : (
                canManage && (
                  <Button key={key} variant="secondary" onClick={() => legal(key, empty(label))}>
                    Add {key} link
                  </Button>
                )
              )
            })}
          </div>
        </Disclosure>
      </Card>
    </div>
  )
}
function PresetLink({
  id,
  label,
  link,
  pages,
  disabled,
  onChange,
}: {
  id: string
  label: string
  link: GlobalElementLink
  pages: FramePageChoice[]
  disabled: boolean
  onChange: (link: GlobalElementLink | null) => void
}) {
  return (
    <Disclosure title={link.label || label}>
      <div className={styles.formStack}>
        <Field id={id + '-label'} label="Label">
          <input
            aria-label={label + ' label'}
            maxLength={80}
            disabled={disabled}
            value={link.label}
            onChange={event => onChange({ ...link, label: event.target.value })}
          />
        </Field>
        <Field id={id + '-kind'} label="Destination">
          <select
            aria-label={label + ' destination type'}
            disabled={disabled}
            value={link.target.type}
            onChange={event => {
              const first = pages[0],
                target: NavTarget =
                  event.target.value === 'page' && first
                    ? { type: 'page', page_id: first.id }
                    : { type: 'url', url: '/' }
              onChange({ ...link, target })
            }}
          >
            <option value="page">A page on this site</option>
            <option value="url">A web address</option>
          </select>
        </Field>
        {link.target.type === 'page' ? (
          <Field id={id + '-page'} label="Page">
            <select
              aria-label={label + ' page'}
              disabled={disabled}
              value={link.target.page_id}
              onChange={event => onChange({ ...link, target: { type: 'page', page_id: event.target.value } })}
            >
              {pages.map(page => (
                <option key={page.id} value={page.id}>
                  {page.title} · {page.path}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field id={id + '-url'} label="URL">
            <input
              aria-label={label + ' URL'}
              disabled={disabled}
              value={link.target.url}
              onChange={event => onChange({ ...link, target: { type: 'url', url: event.target.value } })}
            />
          </Field>
        )}
        {!disabled && (
          <Button variant="secondary" onClick={() => onChange(null)}>
            Remove {label}
          </Button>
        )}
      </div>
    </Disclosure>
  )
}
