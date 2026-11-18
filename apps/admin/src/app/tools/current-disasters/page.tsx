import { notFound } from 'next/navigation'
import { canUseTool } from '@cms/domain'
import { AppShell } from '../../../components/app-shell.tsx'
import { navigationFor } from '../../../components/nav.ts'
import { PageHeader } from '../../../components/shell.tsx'
import { EmptyState } from '../../../components/ui/index.ts'
import { currentSession } from '../../../lib/session.ts'
import { disasterItems, parseDisasterBody } from '../../../lib/disaster-cards.ts'
import { readDisasterItem, zestyConfig, ZestyError } from '../../../lib/zesty-disasters.ts'
import { DisasterEditor } from './disaster-editor.tsx'

export const dynamic = 'force-dynamic'

const LIVE_PAGE =
  'https://www.salvationarmyusa.org/disaster-relief/current-national-and-international-disaster-efforts/'

export default async function CurrentDisasters() {
  const session = await currentSession()
  if (!session || !canUseTool(session.principal, 'current_disasters')) notFound()
  const settings = zestyConfig()
  let content
  if (!settings.ok) {
    content = (
      <EmptyState title="Connect Zesty first">
        <p>An administrator needs to set these server settings before cards can be loaded:</p>
        <ul>
          {settings.missing.map(name => (
            <li key={name}>
              <code>{name}</code>
            </li>
          ))}
        </ul>
      </EmptyState>
    )
  } else {
    try {
      const item = await readDisasterItem(settings.config)
      content = (
        <DisasterEditor
          version={item.version}
          updatedAt={item.updatedAt}
          initialItems={disasterItems(parseDisasterBody(item.body))}
          livePage={LIVE_PAGE}
        />
      )
    } catch (error) {
      if (!(error instanceof ZestyError)) throw error
      content = (
        <EmptyState title="Couldn’t load the cards from Zesty">
          <p>{error.message}</p>
        </EmptyState>
      )
    }
  }
  return (
    <AppShell
      email={session.email}
      role={session.principal.isSuperAdmin ? 'Super admin' : 'Disaster Manager'}
      groups={navigationFor(undefined, session.principal)}
    >
      <main id="main" className="wrap">
        <PageHeader
          title="Current Disasters"
          crumbs={[{ label: 'Home', href: '/' }, { label: 'Current Disasters' }]}
          lede="Edit the disaster cards on salvationarmyusa.org, then push them. Pushing publishes the page in Zesty right away."
        />
        {content}
      </main>
    </AppShell>
  )
}
