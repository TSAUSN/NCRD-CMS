'use client'
import { Disclosure } from './ui/index.ts'
import type { NationalSiteReview } from '../lib/national-template.ts'
import shared from './workspace.module.css'
/** Compact review scope; expanding retains every affected page name and count. */
export function TemplateUpdateSites({
  sites,
  selected,
  pending,
  onSelect,
}: {
  sites: readonly NationalSiteReview[]
  selected: readonly string[]
  pending: boolean
  onSelect: (id: string, checked: boolean) => void
}) {
  return (
    <ul className={shared.rowList} aria-label="Sites in this update">
      {sites.map(site => {
        const counts = new Map<string, number>()
        for (const title of site.changedPages) counts.set(title, (counts.get(title) ?? 0) + 1)
        return (
          <li key={site.id}>
            <div className={shared.rowCopy}>
              <label className={shared.checkRow}>
                <input
                  type="checkbox"
                  checked={selected.includes(site.id)}
                  disabled={pending}
                  onChange={event => onSelect(site.id, event.target.checked)}
                />
                <strong>{site.name}</strong>
              </label>
              <span className={shared.meta}>
                {!site.connected
                  ? 'Connect to the national template'
                  : site.themeChanged
                    ? 'National layout, colours and buttons'
                    : site.changedPages.length
                      ? 'Shared section update'
                      : 'Already up to date'}
              </span>
              <Disclosure
                title={`${site.changedPages.length} ${site.changedPages.length === 1 ? 'page' : 'pages'} with section updates`}
              >
                {site.changedPages.length ? (
                  <ul className={shared.rowList} aria-label={'Pages updated on ' + site.name}>
                    {[...counts].map(([title, count]) => (
                      <li key={title}>
                        {title}
                        {count > 1 ? ' (' + count + ' pages)' : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    {site.pages === 1
                      ? '1 page keeps its words and photos.'
                      : `${site.pages} pages keep their words and photos.`}
                  </p>
                )}
              </Disclosure>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
