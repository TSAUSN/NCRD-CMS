// The pieces every document screen inside the shell is built from.
//
// The application frame itself — the navy sidebar — is `app-shell.tsx`. What is
// here is what sits inside its main column: the trail that says where this
// screen is, and the header block that says what it is and what you most likely
// came to do.
//
// They are shared components rather than a shape each screen redraws, because
// the screens had drifted: one put its primary action beside the title, one put
// it under the description, one had no header at all, and a product whose header
// moves between screens reads as several products.
import { GuardedLink as Link } from './guarded-link.tsx'
import type { ReactNode } from 'react'
import { IconChevronRight } from './icons.tsx'

export type Crumb = { label: string; href?: string }

/**
 * The trail, as links to everything above this screen and plain text for the
 * screen itself.
 *
 * The last crumb is never a link: a link to where you already are is a promise
 * the browser cannot keep. Nothing here ever shows an identifier — every crumb
 * is the human name of the thing, because "8f3c…-a91b" is not a place anybody
 * recognises.
 */
export function Crumbs({ trail }: { trail: readonly Crumb[] }): ReactNode {
  if (trail.length === 0) return null
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {trail.map((crumb, index) => (
        <span key={`${crumb.label}-${index}`} style={{ display: 'contents' }}>
          {index > 0 && <IconChevronRight size={13} className="icon-svg sep" />}
          {crumb.href && index < trail.length - 1 ? (
            <Link href={['Sites', 'All sites'].includes(crumb.label) && crumb.href === '/' ? '/sites' : crumb.href}>
              {crumb.label === 'Sites' ? 'All sites' : crumb.label}
            </Link>
          ) : (
            <span aria-current="page">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

export type HeaderTab = { href: string; label: string; current?: boolean }

export { PageHeader } from './ui/page-header.tsx'

/** The sibling screens grouped under one sidebar destination. */
export function siteAreaTabs(siteId: string, area: 'media' | 'library' | 'settings', current: string): HeaderTab[] {
  const base = `/sites/${siteId}`
  const tabs = {
    media: [
      { href: `${base}/media`, label: 'Images' },
      { href: `${base}/documents`, label: 'Documents' },
    ],
    library: [
      { href: `${base}/sections`, label: 'Sections' },
      { href: `${base}/recipes`, label: 'Page templates' },
    ],
    settings: [
      { href: `${base}/settings`, label: 'General' },
      { href: `${base}/domains`, label: 'Domains' },
    ],
  }[area]
  return tabs.map(tab => ({ ...tab, current: tab.href === `${base}/${current}` }))
}
