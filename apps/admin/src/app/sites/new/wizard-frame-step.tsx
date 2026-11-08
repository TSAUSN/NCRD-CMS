import type { Dispatch, SetStateAction } from 'react'
import type { SiteSetup } from '@cms/schema'
import { GLOBAL_ELEMENT_LIMITS } from '@cms/schema'

const HEADER_LAYOUTS: { value: SiteSetup['header']['preset']; name: string; description: string }[] = [
  {
    value: 'standard',
    name: 'Name left, menu right',
    description: 'The site name on the left and the menu beside it.',
  },
  { value: 'centered', name: 'Centred', description: 'The name centred, with the menu beneath it.' },
  { value: 'compact', name: 'Compact', description: 'A slimmer bar, for sites with many pages.' },
  { value: 'minimal', name: 'Minimal', description: 'No brand rule; the bar spans the full width.' },
]
const HEADER_SURFACES: { value: SiteSetup['header']['surface']; name: string }[] = [
  { value: 'page', name: 'Page colour' },
  { value: 'soft', name: 'Soft band' },
  { value: 'primary', name: 'Brand colour' },
  { value: 'accent', name: 'Accent colour' },
]

type SharedLink = { label: string; target: { type: 'url'; url: string } | { type: 'page'; page_id: string } }
function SharedLinks({
  id,
  legend,
  hint,
  links,
  max,
  add,
  disabled,
  onChange,
}: {
  id: string
  legend: string
  hint: string
  links: readonly SharedLink[]
  max: number
  add: string
  disabled: boolean
  onChange: (links: SharedLink[]) => void
}) {
  const set = (index: number, patch: Partial<{ label: string; url: string }>) =>
    onChange(
      links.map((link, at) =>
        at !== index
          ? link
          : {
              label: patch.label ?? link.label,
              target: { type: 'url', url: patch.url ?? (link.target.type === 'url' ? link.target.url : '') },
            },
      ),
    )
  return (
    <fieldset className="look-group wizard-links" disabled={disabled}>
      <legend>{legend}</legend>
      <p className="hint">{hint}</p>
      {links.map((link, index) => (
        <fieldset className="wizard-link" key={index}>
          <legend className="sr-only">{`${legend} ${index + 1}`}</legend>
          <div className="field">
            <label htmlFor={`${id}-label-${index}`}>Link text</label>
            <input
              type="text"
              id={`${id}-label-${index}`}
              value={link.label}
              maxLength={GLOBAL_ELEMENT_LIMITS.linkLabel}
              onChange={event => set(index, { label: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-url-${index}`}>Web address</label>
            <input
              type="text"
              inputMode="url"
              id={`${id}-url-${index}`}
              placeholder="https://… or /a-page"
              value={link.target.type === 'url' ? link.target.url : ''}
              onChange={event => set(index, { url: event.target.value.trim() })}
            />
          </div>
          <button
            type="button"
            className="secondary small"
            aria-label={`Remove ${link.label.trim() || `${legend.toLowerCase()} ${index + 1}`}`}
            onClick={() => onChange(links.filter((_, at) => at !== index))}
          >
            Remove
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="secondary small"
        disabled={links.length >= max}
        onClick={() => onChange([...links, { label: '', target: { type: 'url', url: '' } }])}
      >
        {add}
      </button>
    </fieldset>
  )
}

/** The page a nested page sits under: the closest page above it that is not
 * nested, unless that is the home page (V1 reference 23). */
export function WizardFrameStep({
  setup,
  setSetup,
}: {
  setup: SiteSetup
  setSetup: Dispatch<SetStateAction<SiteSetup>>
}) {
  return (
    <>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={setup.header.enabled}
            onChange={event => setSetup({ ...setup, header: { ...setup.header, enabled: event.target.checked } })}
          />{' '}
          Show the site header
        </label>
      </div>
      <p className="wizard-lede">
        These appear on every page. The menu fills itself from the pages you planned; logos and links to the site’s own
        pages are added after the site is created.
      </p>
      <fieldset className="look-group" disabled={!setup.header.enabled}>
        <legend>Header layout</legend>
        <div className="look-options look-headers">
          {HEADER_LAYOUTS.map(layout => {
            const id = `header-layout-${layout.value}`
            return (
              <label className="look-option" key={layout.value}>
                <input
                  type="radio"
                  name="header-layout"
                  checked={setup.header.preset === layout.value}
                  aria-labelledby={id}
                  aria-describedby={`${id}-about`}
                  onChange={() => setSetup({ ...setup, header: { ...setup.header, preset: layout.value } })}
                />
                <span className={`header-sketch is-${layout.value}`} aria-hidden="true">
                  <i />
                  <b />
                  <b />
                  <b />
                </span>
                <span className="look-option-copy">
                  <strong id={id}>{layout.name}</strong>
                  <small id={`${id}-about`}>{layout.description}</small>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>
      <fieldset className="look-group" disabled={!setup.header.enabled}>
        <legend>Header colour</legend>
        <div className="look-options look-shapes">
          {HEADER_SURFACES.map(surface => {
            const id = `header-surface-${surface.value}`
            const fill =
              surface.value === 'primary'
                ? setup.theme.colors.primary
                : surface.value === 'accent'
                  ? setup.theme.colors.accent
                  : surface.value === 'soft'
                    ? setup.theme.colors.surfaceAlt
                    : setup.theme.colors.surface
            return (
              <label className="look-option look-shape" key={surface.value}>
                <input
                  type="radio"
                  name="header-surface"
                  checked={setup.header.surface === surface.value}
                  aria-labelledby={id}
                  onChange={() => setSetup({ ...setup, header: { ...setup.header, surface: surface.value } })}
                />
                <span
                  className="look-button-sample header-surface-sample"
                  aria-hidden="true"
                  style={{ background: fill }}
                />
                <strong id={id}>{surface.name}</strong>
              </label>
            )
          })}
        </div>
      </fieldset>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={setup.footer.enabled}
            onChange={event => setSetup({ ...setup, footer: { ...setup.footer, enabled: event.target.checked } })}
          />{' '}
          Show the site footer
        </label>
      </div>
      <div className="field">
        <label htmlFor="setup-footer-blurb">Footer introduction</label>
        <textarea
          id="setup-footer-blurb"
          value={setup.footer.brand.blurb}
          maxLength={500}
          onChange={event =>
            setSetup({
              ...setup,
              footer: { ...setup.footer, brand: { ...setup.footer.brand, blurb: event.target.value } },
            })
          }
        />
      </div>
      <div className="field">
        <label htmlFor="setup-copyright">Copyright line</label>
        <input
          type="text"
          id="setup-copyright"
          value={setup.footer.legal.copyright}
          maxLength={200}
          onChange={event =>
            setSetup({
              ...setup,
              footer: { ...setup.footer, legal: { ...setup.footer.legal, copyright: event.target.value } },
            })
          }
        />
      </div>
      <fieldset className="look-group wizard-partner" disabled={!setup.header.enabled}>
        <legend>Partner</legend>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!setup.header.partner}
            onChange={event =>
              setSetup({
                ...setup,
                header: {
                  ...setup.header,
                  partner: event.target.checked ? { label: 'In partnership with', name: '', url: null } : null,
                },
              })
            }
          />
          <span>
            Name a partner in the header
            <small>Shown beside the site name, as in “In partnership with …”, and hidden on phones.</small>
          </span>
        </label>
        {setup.header.partner && (
          <div className="wizard-link">
            <div className="field">
              <label htmlFor="setup-partner-label">Words before the name</label>
              <input
                type="text"
                id="setup-partner-label"
                value={setup.header.partner.label}
                maxLength={GLOBAL_ELEMENT_LIMITS.linkLabel}
                onChange={event =>
                  setSetup({
                    ...setup,
                    header: {
                      ...setup.header,
                      partner: { ...setup.header.partner!, label: event.target.value },
                    },
                  })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="setup-partner-name">Partner’s name</label>
              <input
                type="text"
                id="setup-partner-name"
                value={setup.header.partner.name}
                maxLength={GLOBAL_ELEMENT_LIMITS.siteName}
                onChange={event =>
                  setSetup({
                    ...setup,
                    header: {
                      ...setup.header,
                      partner: { ...setup.header.partner!, name: event.target.value },
                    },
                  })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="setup-partner-url">Web address (optional)</label>
              <input
                type="text"
                inputMode="url"
                id="setup-partner-url"
                placeholder="https://…"
                value={setup.header.partner.url ?? ''}
                onChange={event =>
                  setSetup({
                    ...setup,
                    header: {
                      ...setup.header,
                      partner: { ...setup.header.partner!, url: event.target.value.trim() || null },
                    },
                  })
                }
              />
            </div>
          </div>
        )}
      </fieldset>
      <SharedLinks
        id="setup-header-links"
        legend="Header links"
        add="Add a header link"
        max={GLOBAL_ELEMENT_LIMITS.utilityLinks}
        disabled={!setup.header.enabled}
        hint={`Small links above the menu on every page, such as Donate or Contact — up to ${GLOBAL_ELEMENT_LIMITS.utilityLinks}.`}
        links={setup.header.utilityLinks}
        onChange={utilityLinks => setSetup({ ...setup, header: { ...setup.header, utilityLinks } })}
      />
      <SharedLinks
        id="setup-footer-links"
        legend="Footer links"
        add="Add a footer link"
        max={GLOBAL_ELEMENT_LIMITS.footerGroupLinks}
        disabled={!setup.footer.enabled}
        hint={`A “Useful links” list in the footer of every page — up to ${GLOBAL_ELEMENT_LIMITS.footerGroupLinks}. Pages chosen for the footer are listed separately.`}
        links={setup.footer.groups[0]?.links ?? []}
        onChange={links =>
          setSetup({
            ...setup,
            footer: {
              ...setup.footer,
              groups: links.length ? [{ heading: setup.footer.groups[0]?.heading ?? 'Useful links', links }] : [],
            },
          })
        }
      />
      <p className="hint">
        Add logos, contact details, and links to the site’s own pages in Header & footer after the site is created.
      </p>
    </>
  )
}
