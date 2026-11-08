import type { Dispatch, SetStateAction } from 'react'
import type { SiteSetup } from '@cms/schema'

export function WizardNameStep({
  setup,
  setSetup,
  slugTouched,
  setSlugTouched,
  managedStaging,
  stagingBase,
  describe,
  chooseKind,
}: {
  setup: SiteSetup
  setSetup: Dispatch<SetStateAction<SiteSetup>>
  slugTouched: boolean
  setSlugTouched: (value: boolean) => void
  managedStaging: boolean
  stagingBase: string | null
  describe: (text: string) => void
  chooseKind: (next: SiteSetup['kind']) => void
}) {
  return (
    <>
      <div className="field">
        <label htmlFor="site-name">Site name</label>
        <input
          type="text"
          id="site-name"
          value={setup.name}
          maxLength={120}
          onChange={event => {
            const name = event.target.value
            setSetup(old => ({
              ...old,
              name,
              slug: slugTouched
                ? old.slug
                : name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '')
                    .slice(0, 40)
                    .replace(/-$/, ''),
              header: {
                ...old.header,
                brand: {
                  ...old.header.brand,
                  siteName: old.header.brand.siteName === old.name ? name : old.header.brand.siteName,
                },
              },
              footer: {
                ...old.footer,
                brand: {
                  ...old.footer.brand,
                  siteName: old.footer.brand.siteName === old.name ? name : old.footer.brand.siteName,
                },
              },
            }))
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="site-slug">{managedStaging ? 'Short name' : 'Short address'}</label>
        <input
          type="text"
          id="site-slug"
          value={setup.slug}
          maxLength={40}
          onChange={event => {
            setSlugTouched(true)
            setSetup({ ...setup, slug: event.target.value })
          }}
        />
        <p className="hint">
          {managedStaging
            ? 'Used to identify this site. A secure test address will be assigned automatically.'
            : `${setup.slug || 'your-site'}.${stagingBase || 'staging address pending'}`}
        </p>
      </div>
      <div className="field">
        <label htmlFor="site-description">One line about the site</label>
        <input
          type="text"
          id="site-description"
          value={setup.pages.find(page => page.slug === '')?.intro ?? ''}
          maxLength={500}
          aria-describedby="site-description-hint"
          onChange={event => describe(event.target.value)}
        />
        <p className="hint" id="site-description-hint">
          Opens the home page and becomes its search description. It also starts the footer’s introduction. Each can be
          changed later.
        </p>
      </div>
      <fieldset className="site-kind">
        <legend>Starting point</legend>
        {(['resource', 'event'] as const).map(value => (
          <label key={value}>
            <input type="radio" name="starter-kind" checked={setup.kind === value} onChange={() => chooseKind(value)} />
            <span>
              <strong>{value === 'resource' ? 'Resource site' : 'Event site'}</strong>
              <small>
                {value === 'resource'
                  ? 'Resources, context, and project information'
                  : 'Speakers, program, and visitor information'}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="hint">
        The starter includes editable example text. Its lists begin empty so fictional entries are never mistaken for
        real information.
      </p>
    </>
  )
}
