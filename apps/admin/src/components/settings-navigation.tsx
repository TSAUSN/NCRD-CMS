import { GuardedLink } from './guarded-link.tsx'
import shared from './workspace.module.css'
export function SettingsNavigation({ siteId, current }: { siteId: string; current: string }) {
  const base = '/sites/' + siteId + '/settings'
  const items = [
    ['General', base],
    ['Publishing & approval', base + '?tab=publishing'],
    ['Review reminders', base + '?tab=reviews'],
    ['Search & sharing', base + '/search'],
    ['Social accounts', base + '/social'],
    ['Redirects', '/sites/' + siteId + '/redirects'],
    ['Advanced', base + '?tab=advanced'],
  ]
  return (
    <nav className={shared.workspaceRail} data-position="sticky" aria-label="Settings tabs">
      {items.map(([name, href]) => (
        <GuardedLink key={name} href={href!} aria-current={name === current ? 'page' : undefined}>
          {name}
        </GuardedLink>
      ))}
    </nav>
  )
}
