import type { SiteSetup } from '@cms/schema'
import { lookSummary } from '../../../lib/site-look.ts'
import { pageNotes, wizardPageTemplateLabel } from './wizard-page-order.ts'

export function WizardReviewStep({
  setup,
  managedStaging,
  stagingBase,
}: {
  setup: SiteSetup
  managedStaging: boolean
  stagingBase: string | null
}) {
  return (
    <>
      <p className="wizard-lede">
        This creates the site and its {setup.pages.length} pages as private drafts. Nothing is visible to the public
        yet.
      </p>
      <dl className="wizard-review">
        <div>
          <dt>Name</dt>
          <dd>{setup.name}</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>
            {managedStaging
              ? 'A secure test address will be assigned when you create the site.'
              : `${setup.slug}.${stagingBase || 'staging address pending'}`}
          </dd>
        </div>
        <div>
          <dt>Look</dt>
          <dd>{lookSummary(setup.theme)}</dd>
        </div>
        <div>
          <dt>Pages</dt>
          <dd>
            {setup.pages.length} {setup.pages.length === 1 ? 'page' : 'pages'}
          </dd>
        </div>
        {setup.header.partner && (
          <div>
            <dt>Partner</dt>
            <dd>
              {setup.header.partner.label} {setup.header.partner.name}
            </dd>
          </div>
        )}
        {(setup.header.utilityLinks.length > 0 || setup.footer.groups.length > 0) && (
          <div>
            <dt>Links on every page</dt>
            <dd>
              {[
                setup.header.utilityLinks.length
                  ? `Header: ${setup.header.utilityLinks.map(link => link.label).join(', ')}`
                  : '',
                setup.footer.groups.length
                  ? `Footer: ${setup.footer.groups
                      .flatMap(group => group.links)
                      .map(link => link.label)
                      .join(', ')}`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </dd>
          </div>
        )}
      </dl>
      <ul className="wizard-review-pages" aria-label="Planned pages">
        {setup.pages.map((page, index) => (
          <li key={index}>
            <strong>{page.title || 'Untitled page'}</strong> <code>/{page.slug}</code>
            <span>
              {wizardPageTemplateLabel(page)}
              {pageNotes(setup.pages, index)}
            </span>
          </li>
        ))}
      </ul>
      <p className="notice notice-info">
        <span className="notice-body">
          <strong>What happens next.</strong> The site is created privately. Open its home page, make it yours, and
          press Publish: the site goes live with everything you chose here. Until then only your team can see it.
        </span>
      </p>
    </>
  )
}
